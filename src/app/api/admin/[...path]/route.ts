import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { requireGateway } from "@/lib/billing";
import { adminClient } from "@/lib/supabase/admin";
import { kickWorker } from "@/lib/jobs/kick";

/**
 * Admin API (§19.3, §20.2): an explicit allowlist of reads and audited actions. Every RPC checks the caller's
 * staff capability on the server and writes its own audit row; this layer only validates input shape.
 * There is no generic SQL, balance or status endpoint.
 */
type Ctx = { req: NextRequest; db: SupabaseClient; user: User; rest: string[]; q: URLSearchParams };
type Handler = (c: Ctx) => Promise<unknown>;

const cursor = (q: URLSearchParams) => {
  const b = q.get("before");
  return b && !Number.isNaN(Date.parse(b)) ? b : null;
};
const limit = (q: URLSearchParams, max = 100) => input.int(q.get("limit") ?? undefined, "limit", { min: 1, max, optional: true }) ?? 50;
const reason = (v: unknown) => input.str(v, "Reason", { min: 3, max: 500 });
const opt = (v: string | null) => (v ? v.slice(0, 100) : null);

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
  catalog: ({ db }) => rpc(db, "admin_catalog"),
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
  "catalog/models/:id/state": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_set_model_state", {
      p_model_id: input.str(rest[2], "Model", { min: 1, max: 60 }),
      p_state: input.oneOf(b.state, "State", ["enabled", "experimental", "maintenance", "disabled"] as const),
      p_note: input.str(b.note, "Customer note", { max: 200, optional: true }) ?? null,
      p_reason: reason(b.reason),
    });
  },
  "catalog/models/:id/verification": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_record_model_verification", {
      p_model_id: input.str(rest[2], "Model", { min: 1, max: 60 }),
      p_evidence: input.str(b.evidence, "Evidence", { min: 10, max: 2000 }),
    });
  },
  "catalog/prices": async ({ req, db }) => {
    const b = await readJson(req);
    if (!b.rules || typeof b.rules !== "object") throw new ApiError("INVALID_INPUT", "Price rules are required.", 422);
    return rpc(db, "admin_create_price_version", {
      p_model_id: input.str(b.modelId, "Model", { min: 1, max: 60 }),
      p_rules: b.rules,
      p_supplier_cost: b.supplierCost && typeof b.supplierCost === "object" ? b.supplierCost : {},
      p_evidence: input.str(b.evidence, "Cost evidence", { min: 10, max: 2000 }),
    });
  },
  "catalog/prices/:id/publish": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_publish_price_version", { p_price_version_id: input.uuid(rest[2], "Price version"), p_reason: reason(b.reason) });
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
    return rpc(db, "admin_publish_product_version", { p_product_version_id: input.uuid(rest[2], "Product version"), p_reason: reason(b.reason) });
  },
  "catalog/products/:id/retire": async ({ req, db, rest }) => {
    const b = await readJson(req);
    return rpc(db, "admin_retire_product", { p_product_key: input.str(rest[2], "Product key", { min: 2, max: 40 }), p_reason: reason(b.reason) });
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
