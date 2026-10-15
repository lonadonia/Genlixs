import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { env } from "@/lib/server/env";
import { requireGateway } from "@/lib/billing";
import { adminClient } from "@/lib/supabase/admin";
import { kickWorker } from "@/lib/jobs/kick";
import { providerConfigured } from "@/lib/providers";
import { balanceReadable, readAndRecordBalance } from "@/lib/providers/balance";
import { supportedAdapters } from "@/lib/providers/kie/adapters";
import { pipelineConfig } from "@/lib/server/pipeline-config";

/**
 * Admin API (§19.3, §20.2): an explicit allowlist of reads and audited actions. Every RPC checks the caller's
 * staff capability on the server and writes its own audit row; this layer only validates input shape.
 * There is no generic SQL endpoint. The KIE key stays on the server: the balance is read here and only the
 * resulting number (or an error code) is returned.
 */
type Ctx = { req: NextRequest; db: SupabaseClient; user: User; rest: string[]; q: URLSearchParams };
type Handler = (c: Ctx) => Promise<unknown>;

const cursor = (q: URLSearchParams) => {
  const b = q.get("before");
  return b && !Number.isNaN(Date.parse(b)) ? b : null;
};
const limit = (q: URLSearchParams, max = 100) => input.int(q.get("limit") ?? undefined, "limit", { min: 1, max, optional: true }) ?? 50;
const reason = (v: unknown) => input.str(v, "Reason", { min: 3, max: 500 });
/** Routine actions are described automatically; a typed reason is optional (required only for exceptional overrides). */
const optionalReason = (v: unknown) => input.str(v, "Reason", { min: 3, max: 500, optional: true }) ?? null;
const opt = (v: string | null) => (v ? v.slice(0, 100) : null);

const STATES = ["enabled", "experimental", "maintenance", "disabled"] as const;
const BADGES = ["recommended", "premium", "budget", "fast", "long"] as const;
const modelId = (v: unknown) => {
  const s = input.str(v, "Model", { min: 2, max: 60 })!;
  if (!/^[a-z0-9-]+$/.test(s)) throw new ApiError("INVALID_INPUT", "Model is not valid.", 422);
  return s;
};
const modelIds = (v: unknown) => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 100) throw new ApiError("INVALID_INPUT", "Select between 1 and 100 models.", 422);
  return [...new Set(v.map(modelId))];
};
/** Optional decimal with bounded precision; null clears an assumption ("unknown"), it never means zero. */
function decimal(v: unknown, name: string, min: number, max: number, decimals: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || Math.round(n * 10 ** decimals) !== n * 10 ** decimals) {
    throw new ApiError("INVALID_INPUT", `${name} must be a number between ${min} and ${max} with at most ${decimals} decimals.`, 422);
  }
  return n;
}
/**
 * Exact decimal text (no binary floating point): "5", "5.00", "0.5". Money and credit quantities are passed to the
 * database as text and validated there again.
 */
function decimalText(v: unknown, name: string, decimals: number, optional = false): string | null {
  if ((v === undefined || v === null || v === "") && optional) return null;
  const t = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  const pattern = decimals > 0 ? new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`) : /^\d{1,9}$/;
  if (!pattern.test(t)) {
    throw new ApiError("INVALID_INPUT", `${name} must be a positive number${decimals > 0 ? ` with at most ${decimals} decimals` : " (whole)"}.`, 422);
  }
  return t;
}
/** Kept configurations per model for bulk pricing: {"<modelId>": ["<key>", â€¦]}. */
function keptMap(v: unknown): Record<string, string[]> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new ApiError("INVALID_INPUT", "Kept configurations are not valid.", 422);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 100) throw new ApiError("INVALID_INPUT", "Kept configurations are not valid.", 422);
  return Object.fromEntries(
    entries.map(([k, list]) => {
      if (!Array.isArray(list) || list.length > 200 || list.some((x) => typeof x !== "string" || x.length > 60)) {
        throw new ApiError("INVALID_INPUT", "Kept configurations are not valid.", 422);
      }
      return [modelId(k), list as string[]];
    }),
  );
}
/** {configuration key: number} maps for per-configuration prices and costs (keys are validated by the database). */
function numberMap(v: unknown, name: string): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ApiError("INVALID_INPUT", `${name} are required.`, 422);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 200) throw new ApiError("INVALID_INPUT", `${name} are required.`, 422);
  return Object.fromEntries(
    entries.map(([k, x]) => {
      const n = typeof x === "string" ? Number(x) : x;
      if (k.length > 60 || typeof n !== "number" || !Number.isFinite(n)) throw new ApiError("INVALID_INPUT", `${name}: "${k.slice(0, 60)}" is not a number.`, 422);
      return [k, n];
    }),
  );
}
const bulkScope = (b: Record<string, unknown>) => {
  const scope = input.oneOf(b.scope, "Scope", ["all", "images", "videos", "selected"] as const)!;
  const markup = typeof b.markupPercent === "string" ? Number(b.markupPercent) : b.markupPercent;
  if (typeof markup !== "number" || !Number.isFinite(markup)) throw new ApiError("INVALID_MARKUP", "Enter the markup above KIE cost as a percentage.", 422);
  return {
    p_scope: scope,
    p_model_ids: scope === "selected" ? modelIds(b.modelIds) : null,
    p_markup_percent: markup,
    p_include_overrides: input.bool(b.includeOverrides, "Include manual prices", true) ?? false,
  };
};
/** What this deployment can do, without revealing any secret value. */
const runtime = () => ({
  submitsEnabled: providerConfigured(),
  kieKeyPresent: Boolean(env.kieApiKey()),
  fakeProvider: env.fakeProvider(),
  balanceReadable: balanceReadable(),
  adaptersInCode: supportedAdapters(),
});
const credentialsMissing = () =>
  new ApiError(
    "CREDENTIALS_MISSING",
    "This deployment cannot send work to KIE (KIE_API_KEY is not set, or paid provider calls are disabled outside production). Add the key in Vercel first.",
    409,
  );

/** Fresh sign-in (and MFA when the account has a verified factor) for owner-level changes (§19.3). */
async function requireFreshAuth({ db, user }: Ctx) {
  const last = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
  if (Date.now() - last > 10 * 60 * 1000) throw new ApiError("REAUTH_REQUIRED", "Sign in again to change staff access.", 403);
  const { data } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data && data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
    throw new ApiError("MFA_REQUIRED", "Complete two-factor verification to change staff access.", 403);
  }
}

const GETS: Record<string, Handler> = {
  me: ({ db }) => rpc(db, "admin_me"),
  overview: ({ db }) => rpc(db, "admin_overview"),
  jobs: ({ db, q }) =>
    rpc(db, "admin_list_jobs", { p_state: opt(q.get("state")), p_model: opt(q.get("model")), p_q: opt(q.get("q")), p_before: cursor(q), p_limit: limit(q) }),
  "jobs/:id": ({ db, rest }) => rpc(db, "admin_job_detail", { p_job: input.str(rest[1], "Job", { min: 3, max: 64 }) }),
  users: ({ db, q }) => rpc(db, "admin_list_users", { p_q: opt(q.get("q")), p_before: cursor(q), p_limit: limit(q) }),
  payments: ({ db, q }) => rpc(db, "admin_list_payments", { p_state: opt(q.get("state")), p_before: cursor(q), p_limit: limit(q) }),
  affiliates: ({ db, q }) => rpc(db, "admin_list_affiliates", { p_state: opt(q.get("state")) }),
  "payout-batches": ({ db }) => rpc(db, "admin_list_payout_batches"),
  catalog: async ({ db }) => ({ ...(await rpc<Record<string, unknown>>(db, "admin_catalog")), runtime: runtime() }),
  "catalog/models/:id": async ({ db, rest }) => ({
    ...(await rpc<Record<string, unknown>>(db, "admin_model_detail", { p_model_id: modelId(rest[2]) })),
    runtime: runtime(),
  }),
  "catalog/batches": ({ db, q }) => rpc(db, "admin_pricing_batches", { p_limit: limit(q, 100) }),
  settings: ({ db }) => rpc(db, "admin_settings"),
  "catalog/tests/outputs/:id": async ({ db, rest }) => {
    // Staff-only signed link to a private test output (the RPC checks the capability and the asset's purpose).
    const loc = await rpc<{ bucket: string; path: string; mime: string }>(db, "admin_authorize_test_output", { p_asset_id: input.uuid(rest[3], "Output") });
    const { data, error } = await adminClient().storage.from(loc.bucket).createSignedUrl(loc.path, 600);
    if (error || !data) throw new ApiError("STORAGE_UNAVAILABLE", "The test file could not be opened right now.", 503);
    return { url: data.signedUrl, mime: loc.mime, expiresInSeconds: 600 };
  },
  "provider/summary": async ({ db }) => ({ ...(await rpc<Record<string, unknown>>(db, "admin_provider_summary")), configured: balanceReadable() }),
  // Pipeline health: database view (wake-ups, queues, outcomes, circuit breaker) plus this deployment's configuration.
  "generation/health": async ({ db }) => ({ ...(await rpc<Record<string, unknown>>(db, "admin_generation_health")), config: await pipelineConfig() }),
  staff: ({ db }) => rpc(db, "admin_list_staff"),
  audit: ({ db, q }) => rpc(db, "admin_audit_log", { p_before: cursor(q), p_limit: limit(q, 200) }),
  tickets: ({ db, q }) => rpc(db, "admin_list_tickets", { p_status: opt(q.get("status")) }),
  reconciliation: ({ db }) => rpc(db, "admin_reconciliation"),
};

const POSTS: Record<string, Handler> = {
  "jobs/:id/:action": async ({ req, db, rest }) => {
    const b = await readJson(req);
    const action = input.oneOf(rest[2], "Action", ["recheck", "retry_import", "attach_task", "release"] as const)!;
    const result = await rpc(db, "admin_job_action", {
      p_job_id: input.uuid(rest[1], "Job"),
      p_action: action,
      p_reason: reason(b.reason),
      p_payload: action === "attach_task" ? { taskId: input.str(b.taskId, "Task id", { min: 4, max: 120 }) } : {},
    });
    kickWorker(action === "retry_import" ? "media" : "control", 15_000);
    return result;
  },
  "users/:id/status": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_set_account_status", {
      p_user_id: input.uuid(rest[1], "User"),
      p_status: input.oneOf(b.status, "Status", ["active", "suspended"] as const),
      p_reason: reason(b.reason),
    });
  },
  "credits/adjustments": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_adjust_credits", {
      p_user_id: input.uuid(b.userId, "User"),
      p_units: input.int(b.units, "Units", { min: -1_000_000, max: 1_000_000 }),
      p_category: input.oneOf(b.category, "Category", ["goodwill", "correction", "promotion", "support"] as const),
      p_reason: reason(b.reason),
      p_idempotency_key: input.idempotencyKey(req),
    });
  },
  "billing/refunds": async ({ req, db }) => {
    const gateway = requireGateway();
    const b = await readJson(req);
    const prepared = await rpc<{ refundRequestId: string; replayed: boolean; gatewayPaymentId: string | null; currency: string }>(db, "admin_prepare_refund", {
      p_order_id: input.uuid(b.orderId, "Payment"),
      p_amount_minor: input.int(b.amountMinor, "Amount", { min: 1, max: 100_000_000 }),
      p_reason: reason(b.reason),
      p_idempotency_key: input.idempotencyKey(req),
    });
    if (prepared.replayed) return prepared;
    const admin = adminClient();
    const gatewayRefundId = await gateway
      .submitRefund({ refundRequestId: prepared.refundRequestId, gatewayPaymentId: prepared.gatewayPaymentId, amountMinor: String(b.amountMinor), currency: prepared.currency })
      .catch(() => null);
    // Unknown gateway outcome is recorded as such and reconciled — never retried blindly (§17.6).
    await rpc(admin, "record_refund_submission", {
      p_refund_request_id: prepared.refundRequestId,
      p_state: gatewayRefundId ? "submitting" : "submission_unknown",
      p_gateway_refund_id: gatewayRefundId,
    });
    if (gateway.name === "test" && gatewayRefundId) {
      await rpc(admin, "record_billing_receipt", {
        p_gateway: "test", p_event_id: `test_refund_${prepared.refundRequestId}`, p_event_type: "refund.succeeded",
        p_normalized: { orderId: b.orderId, refundId: gatewayRefundId, amountMinor: String(b.amountMinor), refundRequestId: prepared.refundRequestId },
      });
      kickWorker("events", 15_000);
    }
    return { ...prepared, submitted: Boolean(gatewayRefundId) };
  },
  "affiliates/:id/review": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_review_affiliate", {
      p_affiliate_id: input.uuid(rest[1], "Partner"),
      p_decision: input.oneOf(b.decision, "Decision", ["approve", "reject", "suspend", "reactivate"] as const),
      p_reason: reason(b.reason),
    });
  },
  "affiliates/:id/verify-destination": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_verify_payout_destination", { p_affiliate_id: input.uuid(rest[1], "Partner"), p_reason: reason(b.reason) });
  },
  "payout-batches": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_prepare_payout_batch", { p_currency: input.oneOf(b.currency ?? "USD", "Currency", ["USD", "EUR", "MAD"] as const) });
  },
  "payout-batches/:id/:action": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_payout_batch_action", {
      p_batch_id: input.uuid(rest[1], "Batch"),
      p_action: input.oneOf(rest[2], "Action", ["review", "submitting", "unknown", "paid", "failed", "cancel"] as const),
      p_reference: input.str(b.reference, "Transfer reference", { max: 120, optional: true }) ?? null,
      p_evidence: input.str(b.evidence, "Evidence", { max: 500, optional: true }) ?? null,
      p_reason: input.str(b.reason, "Reason", { max: 500, optional: true }) ?? null,
    });
  },
  // One availability control per model. Switching on also needs the server's KIE credentials, which only this layer
  // can see; the database enforces adapter, option schema, known KIE cost and a published price (no paid-test gate).
  "catalog/models/:id/availability": async ({ req, db, rest }) => {
    const b = await readJson(req);
    const state = input.oneOf(b.state, "Availability", STATES)!;
    if ((state === "enabled" || state === "experimental") && !providerConfigured()) throw credentialsMissing();
    return rpc(db, "admin_set_model_availability", {
      p_model_id: modelId(rest[2]),
      p_state: state,
      p_note: input.str(b.note, "Customer note", { max: 200, optional: true }) ?? null,
      p_accept_untested: false,
      p_publish_price_version_id: input.uuid(b.publishPriceVersionId, "Price draft", true) ?? null,
      p_reason: optionalReason(b.reason),
    });
  },
  "catalog/models/availability": async ({ req, db }) => {
    const b = await readJson(req);
    const state = input.oneOf(b.state, "Availability", STATES)!;
    if ((state === "enabled" || state === "experimental") && !providerConfigured()) throw credentialsMissing();
    return rpc(db, "admin_bulk_set_availability", {
      p_model_ids: modelIds(b.modelIds),
      p_state: state,
      p_accept_untested: false,
    });
  },
  "catalog/models/:id/display": async ({ req, db, rest }) => {
    const b = await readJson(req);
    const badges = Array.isArray(b.badges) ? b.badges.map((x) => input.oneOf(x, "Badge", BADGES)!) : [];
    return rpc(db, "admin_update_model_display", {
      p_model_id: modelId(rest[2]),
      p_name: input.str(b.name, "Display name", { min: 2, max: 60 }),
      p_purpose: input.str(b.purpose, "Description", { min: 5, max: 200 }),
      p_badges: badges,
    });
  },
  "catalog/models/:id/prices": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_save_price_draft", {
      p_model_id: modelId(rest[2]),
      p_units: numberMap(b.units, "Credit charges"),
      p_extra_reference_units: input.int(b.extraReferenceUnits, "Extra reference charge", { min: 0, max: 100000, optional: true }) ?? null,
      p_note: input.str(b.note, "Note", { max: 300, optional: true }) ?? null,
    });
  },
  // One-step price: a new immutable version, published at once (owner) or saved as a draft. The editor sends the
  // version it started from so a concurrent change is refused instead of overwritten.
  "catalog/models/:id/price": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_save_model_price", {
      p_model_id: modelId(rest[2]),
      p_units: numberMap(b.units, "Credit charges"),
      p_extra_reference_units: input.int(b.extraReferenceUnits, "Extra reference charge", { min: 1, max: 1_000_000, optional: true }) ?? null,
      p_publish: input.bool(b.publish, "Publish", true) ?? true,
      p_accept_loss: input.bool(b.acceptLoss, "Below-cost confirmation", true) ?? false,
      p_expected_price_version_id: input.uuid(b.expectedPriceVersionId, "Current price", true) ?? null,
      p_note: input.str(b.note, "Note", { max: 300, optional: true }) ?? null,
    });
  },
  "catalog/models/:id/costs": async ({ req, db, rest }) => {
    const b = await readJson(req);
    const checked = input.str(b.checkedAt, "Checked on", { min: 10, max: 40 })!;
    if (Number.isNaN(Date.parse(checked))) throw new ApiError("INVALID_INPUT", "Checked on is not a valid date.", 422);
    return rpc(db, "admin_save_supplier_cost", {
      p_model_id: modelId(rest[2]),
      p_rates: numberMap(b.rates, "KIE credit rates"),
      p_source_kind: input.oneOf(b.sourceKind, "Source", ["documented", "manual", "observed"] as const),
      p_source_url: input.str(b.sourceUrl, "Source link", { max: 300, optional: true }) ?? null,
      p_checked_at: new Date(checked).toISOString(),
      p_note: input.str(b.note, "Note", { max: 500, optional: true }) ?? null,
      p_extra_reference: null,
    });
  },
  "catalog/models/:id/evidence": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_record_model_verification", {
      p_model_id: modelId(rest[2]),
      p_evidence: input.str(b.evidence, "Evidence", { min: 10, max: 1000 }),
    });
  },
  // Private paid test through the normal durable pipeline. Refused up front when this deployment cannot submit,
  // so no job is created that could never be sent. The idempotency key makes a repeated click return the same job.
  "catalog/models/:id/tests": async ({ req, db, rest }) => {
    if (!providerConfigured()) throw credentialsMissing();
    const b = await readJson(req);
    const refs = Array.isArray(b.referenceAssetIds) ? b.referenceAssetIds.slice(0, 4).map((x) => input.uuid(x, "Reference")) : [];
    const result = await rpc(db, "admin_create_model_test", {
      p_model_id: modelId(rest[2]),
      p_prompt: input.str(b.prompt, "Prompt", { min: 1, max: 5000 }),
      p_options: b.options && typeof b.options === "object" && !Array.isArray(b.options) ? b.options : {},
      p_reference_asset_ids: refs,
      p_idempotency_key: input.idempotencyKey(req),
      p_confirm_spend: input.bool(b.confirmSpend, "Spend confirmation", true) ?? false,
    });
    kickWorker("control", 20_000);
    return result;
  },
  "catalog/prices/:id/publish": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_publish_price_version", { p_price_version_id: input.uuid(rest[2], "Price version"), p_reason: optionalReason(b.reason) });
  },
  "catalog/prices/:id/restore": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_restore_price_version", { p_price_version_id: input.uuid(rest[2], "Price version"), p_reason: optionalReason(b.reason) });
  },
  "catalog/bulk-pricing/preview": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_pricing_preview", { ...bulkScope(b) });
  },
  "catalog/bulk-pricing/apply": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_pricing_apply", {
      ...bulkScope(b),
      p_preview_revision: input.str(b.previewRevision, "Preview revision", { min: 32, max: 32 }),
      p_action: input.oneOf(b.action, "Action", ["draft", "publish"] as const),
      p_selected: modelIds(b.selected),
    });
  },
  // Bulk markup: one "Save changes" for every selected model (all or none), with configurations kept unchanged.
  "catalog/bulk-pricing/save": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_pricing_save", {
      ...bulkScope(b),
      p_preview_revision: input.str(b.previewRevision, "Preview revision", { min: 32, max: 32 }),
      p_selected: modelIds(b.selected),
      p_excluded: keptMap(b.kept),
      p_publish: input.bool(b.publish, "Publish", true) ?? true,
      p_accept_loss: input.bool(b.acceptLoss, "Below-cost confirmation", true) ?? false,
    });
  },
  // Reference values: the KIE purchase (USD per KIE credit) and the Genlixs credit value (USD per Genlixs credit).
  // Saving one never changes wallets, purchases, quotes, running jobs or published prices.
  "pricing/references": async ({ req, db }) => {
    const b = await readJson(req);
    const kind = input.oneOf(b.kind, "Reference", ["kie_purchase", "credit_value"] as const)!;
    return rpc(db, "admin_save_pricing_reference", {
      p_kind: kind,
      p_amount_usd: decimalText(b.amountUsd, "Amount", 2),
      p_credits: decimalText(b.credits, "Credits", kind === "credit_value" ? 0 : 2),
      p_bonus_credits: kind === "kie_purchase" ? decimalText(b.bonusCredits, "Bonus credits", 2, true) : null,
      p_source_url: input.str(b.sourceUrl, "Source link", { max: 300, optional: true }) ?? null,
      p_note: input.str(b.note, "Note", { max: 500, optional: true }) ?? null,
      p_expected_version_id: input.uuid(b.expectedVersionId, "Current value", true) ?? null,
    });
  },
  "pricing/references/impact": async ({ req, db }) => {
    const b = await readJson(req);
    const kind = input.oneOf(b.kind, "Reference", ["kie_purchase", "credit_value"] as const)!;
    return rpc(db, "admin_reference_impact", {
      p_kind: kind,
      p_amount_usd: decimalText(b.amountUsd, "Amount", 2),
      p_credits: decimalText(b.credits, "Credits", kind === "credit_value" ? 0 : 2),
    });
  },
  // One package at a time: a new version when its terms change; other packages are never touched.
  "packages/:key": async ({ req, db, rest }) => {
    const b = await readJson(req);
    const key = input.str(rest[1], "Package", { min: 2, max: 40 })!;
    if (!/^[a-z0-9-]+$/.test(key)) throw new ApiError("INVALID_INPUT", "Package is not valid.", 422);
    return rpc(db, "admin_save_package", {
      p_product_key: key,
      p_name: input.str(b.name, "Name", { min: 2, max: 60 }),
      p_amount_minor: input.int(b.amountMinor, "Price", { min: 1, max: 100_000_000 }),
      p_included_credits: input.int(b.includedCredits, "Included credits", { min: 1, max: 10_000_000 }),
      p_bonus_credits: input.int(b.bonusCredits, "Bonus credits", { min: 0, max: 10_000_000, optional: true }) ?? 0,
      p_offered: input.bool(b.offered, "Offered to customers"),
      p_expected_version_id: input.uuid(b.expectedVersionId, "Current version"),
    });
  },
  "catalog/assumptions": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_set_pricing_assumptions", {
      p_fee_bps: decimal(b.paymentFeeBps, "Payment fee", 0, 3000, 2),
      p_fixed_fee_usd: decimal(b.paymentFixedFeeUsd, "Fixed payment fee", 0, 100, 4),
      p_operating_cost_usd: decimal(b.operatingCostUsdPerJob, "Operating cost", 0, 100, 6),
    });
  },
  "provider/balance/refresh": async ({ req, db }) => {
    const b = await readJson(req);
    const source = input.oneOf(b.source ?? "admin", "Source", ["admin", "auto"] as const)!;
    // The database grants one live read per interval across all staff and tabs; others get the cached value.
    const slot = await rpc<{ proceed: boolean }>(db, "admin_begin_balance_refresh");
    if (slot.proceed) await readAndRecordBalance(source);
    return { ...(await rpc<Record<string, unknown>>(db, "admin_provider_summary")), configured: balanceReadable(), refreshed: slot.proceed };
  },
  "provider/low-balance": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_set_low_balance_threshold", { p_credits: decimal(b.credits, "Low-balance warning", 0, 100_000_000, 2) });
  },
  "catalog/products": async ({ req, db }) => {
    const b = await readJson(req);
    return rpc(db, "admin_save_product_draft", {
      p_product_key: input.str(b.productKey, "Product key", { min: 2, max: 40 }),
      p_kind: input.oneOf(b.kind, "Kind", ["credit_pack", "subscription"] as const),
      p_name: input.str(b.name, "Name", { min: 2, max: 60 }),
      p_currency: input.oneOf(b.currency, "Currency", ["USD", "EUR", "MAD"] as const),
      p_amount_minor: input.int(b.amountMinor, "Price", { min: 1, max: 100_000_000 }),
      p_credits: input.int(b.credits, "Credits", { min: 1, max: 10_000_000 }),
      p_interval: input.oneOf(b.interval, "Interval", ["month", "year"] as const, true) ?? null,
      p_credit_expiry_days: input.int(b.creditExpiryDays, "Credit expiry", { min: 1, max: 3650, optional: true }) ?? null,
      p_gateway_mapping: b.gatewayMapping && typeof b.gatewayMapping === "object" ? b.gatewayMapping : {},
      p_description: input.str(b.description, "Description", { max: 300, optional: true }) ?? null,
    });
  },
  "catalog/products/:id/publish": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_publish_product_version", { p_product_version_id: input.uuid(rest[2], "Product version"), p_reason: optionalReason(b.reason) });
  },
  "catalog/products/:id/retire": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_retire_product", { p_product_key: input.str(rest[2], "Product key", { min: 2, max: 40 }), p_reason: optionalReason(b.reason) ?? `Retired package ${rest[2]}` });
  },
  "agreements/:id/publish": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_publish_agreement", { p_agreement_id: input.uuid(rest[1], "Agreement"), p_reason: reason(b.reason) });
  },
  "settings/:id": async ({ req, db, rest }) => {
    const b = await readJson(req);
    if (!("value" in b)) throw new ApiError("INVALID_INPUT", "A value is required.", 422);
    return rpc(db, "admin_set_setting", { p_key: input.str(rest[1], "Setting", { min: 2, max: 60 }), p_value: b.value, p_reason: reason(b.reason) });
  },
  "staff/role": async (c) => {
    await requireFreshAuth(c);
    const b = await readJson(c.req);
    return rpc(c.db, "admin_set_staff_role", {
      p_email: input.str(b.email, "Email", { min: 3, max: 254 })!.toLowerCase(),
      p_role: input.oneOf(b.role, "Role", ["support", "operations", "finance", "owner"] as const),
      p_active: input.bool(b.active, "Active"),
      p_reason: reason(b.reason),
    });
  },
  "tickets/:id/reply": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_reply_ticket", {
      p_ticket_id: input.uuid(rest[1], "Request"),
      p_body: input.str(b.body, "Reply", { min: 1, max: 5000 }),
      p_status: input.oneOf(b.status, "Status", ["open", "waiting_for_customer", "in_progress", "resolved"] as const),
    });
  },
};

/** Matches `a/:id/b` style patterns against the request path (ids are validated by each handler). */
function match(table: Record<string, Handler>, path: string[]): Handler | null {
  for (const [pattern, h] of Object.entries(table)) {
    const parts = pattern.split("/");
    if (parts.length !== path.length) continue;
    if (parts.every((p, i) => p.startsWith(":") || p === path[i])) return h;
  }
  return null;
}

const handle = withUser<{ path: string[] }>(async (req, { supabase, user, params, requestId }) => {
  const path = params.path ?? [];
  const h = match(req.method === "GET" ? GETS : req.method === "POST" ? POSTS : {}, path);
  if (!h) throw new ApiError("NOT_FOUND", "Not found.", 404);
  const data = await h({ req, db: supabase, user, rest: path, q: req.nextUrl.searchParams });
  return ok(data, 200, requestId);
});

export { handle as GET, handle as POST };
