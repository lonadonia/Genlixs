import "server-only";
import { scaleUp } from "./decimal";
import { decimal, NetworkError, obj, onOff, readWithRetry, requestJson, safeId, str, type JsonReply } from "./http";
import {
  TransientProviderError,
  type AttemptRoute,
  type NormalizedState,
  type ProviderBalance,
  type ProviderClient,
  type RoutedSubmit,
  type SubmitOutcome,
  type TaskDetail,
  type UsageReport,
} from "./types";

/**
 * Cuddler (api.cuddler.ai/v1, OpenAPI checked 18 Oct 2026). Bearer key; every create carries an Idempotency-Key, so
 * a lost response may be re-sent once with the same key (the documented contract returns the same job). Jobs carry
 * max_usd so a token-priced job can never be charged more than 15 % above the routed estimate.
 */
const BASE = "https://api.cuddler.ai";
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;
/** The charge ceiling sent with each job: the nominal estimate × 1.15. */
const MAX_USD_FACTOR: [bigint, bigint] = [BigInt(115), BigInt(100)];

const slot = (req: RoutedSubmit, name: string) => req.inputUrls?.[name] ?? [];

export function cuddlerMaxUsd(route: AttemptRoute): string | null {
  const n = route.estimate?.nominalUsd;
  return n === null || n === undefined ? null : scaleUp(String(n), MAX_USD_FACTOR[0], MAX_USD_FACTOR[1], 6);
}

/** Request for one routed job. Exported for contract tests. */
export function buildCuddler(req: RoutedSubmit): { path: "/v1/videos" | "/v1/images"; body: Record<string, unknown> } {
  const { route, context } = req;
  const o = context.job.options;
  const fixed = route.request ?? {};
  const maxUsd = cuddlerMaxUsd(route);
  const common = {
    model: route.upstreamModelId,
    ...(typeof fixed.variant === "string" ? { variant: fixed.variant } : {}),
    ...(maxUsd ? { max_usd: maxUsd } : {}),
    prompt: context.job.prompt,
    metadata: { genlixs_attempt: context.attempt?.id ?? null },
  };
  if (route.adapter === "cuddler-video") {
    const first = slot(req, "first_frame");
    const last = slot(req, "last_frame");
    const images = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    if (last.length && !first.length) throw new Error("last frame without first frame");
    if (first.length && (images.length || audio.length)) throw new Error("frames and references cannot be combined");
    const mode = first.length ? (last.length ? "first-last-frame" : "image") : images.length || audio.length ? "reference" : "text";
    return {
      path: "/v1/videos",
      body: {
        ...common,
        mode,
        duration: Number(o.duration),
        resolution: String(o.resolution),
        aspect_ratio: String(o.aspect_ratio),
        generate_audio: onOff(o.audio),
        ...(first.length ? { first_frame: first[0] } : {}),
        ...(last.length ? { last_frame: last[0] } : {}),
        ...(images.length ? { reference_images: images } : {}),
        ...(audio.length ? { reference_audios: audio } : {}),
      },
    };
  }
  if (route.adapter === "cuddler-image") {
    if (context.job.tool === "edit" && req.referenceUrls.length < 1) throw new Error("reference image missing");
    const refs = context.job.tool === "edit" ? req.referenceUrls : [];
    return {
      path: "/v1/images",
      body: {
        ...common,
        mode: refs.length ? "edit" : "text",
        resolution: String(o.resolution),
        aspect_ratio: String(o.aspect_ratio),
        ...(refs.length ? { reference_images: refs } : {}),
      },
    };
  }
  throw new Error(`no Cuddler adapter ${route.adapter}`);
}

const ACCOUNT = new Set(["unauthorized", "forbidden", "insufficient_balance", "organization_suspended", "daily_limit_reached", "model_not_enabled"]);
const RETRYABLE = new Set(["rate_limited", "queue_full", "unavailable"]);

/** Classifies one create reply (documented error codes). Exported for contract tests. */
export function classifyCuddlerCreate(r: Pick<JsonReply, "status" | "json">): SubmitOutcome {
  const j = obj(r.json);
  if ((r.status === 200 || r.status === 201 || r.status === 202) && j) {
    const id = str(j.id, 160);
    if (id && safeId(id)) return { kind: "accepted", taskId: id };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid job id" };
  }
  const code = str(j?.code, 60) ?? `HTTP_${r.status}`;
  const message = str(j?.message) ?? "";
  if (ACCOUNT.has(code) || r.status === 401 || r.status === 402 || r.status === 403) return { kind: "rejected_account", code: `CUDDLER_${code}`, message };
  if (RETRYABLE.has(code) || r.status === 429) return { kind: "rejected_retryable", code: `CUDDLER_${code}`, message };
  if (code === "content_blocked") {
    return { kind: "rejected_terminal", code: "CUDDLER_content_blocked", message, publicCode: "CONTENT_BLOCKED",
      publicMessage: "The generation service did not accept this prompt or these images." };
  }
  if (code === "invalid_request" || code === "not_found" || r.status === 400 || r.status === 404 || r.status === 422) {
    return { kind: "rejected_terminal", code: `CUDDLER_${code}`, message, publicCode: "INVALID_REQUEST",
      publicMessage: "The generation service did not accept this prompt or these settings." };
  }
  // internal_error, upstream_error, idempotency_conflict, anything unexplained: the job may exist.
  return { kind: "unknown", code: `CUDDLER_${code}`, message };
}

const STATE: Record<string, NormalizedState> = { queued: "pending", running: "pending", succeeded: "success", failed: "fail", canceled: "fail" };

/** Normalizes GET /v1/videos/{id} or /v1/images/{id}. Exported for contract tests. */
export function normalizeCuddlerJob(taskId: string, r: Pick<JsonReply, "status" | "json">): TaskDetail {
  if (r.status === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
  if (r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403) throw new TransientProviderError(`status read HTTP ${r.status}`);
  const j = obj(r.json);
  if (!j || r.status !== 200) return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  if (typeof j.id === "string" && j.id !== taskId) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "job id mismatch" };
  const state = str(j.status, 40);
  const out = obj(j.output);
  const url = typeof out?.url === "string" && out.url.startsWith("https://") ? out.url : null;
  const err = obj(j.error);
  const usage = obj(j.usage);
  const final = state === "succeeded" || state === "failed" || state === "canceled";
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE[state] ?? "unknown") : "unknown",
    resultUrls: state === "succeeded" && url ? [url] : [],
    failCode: str(err?.code, 60),
    failMsg: str(err?.message),
    // Charge in the account's unit (USD); only a final job's usage is a charge.
    creditsConsumed: final ? decimal(usage?.usd) : null,
    progress: null,
  };
}

export function parseCuddlerBalance(r: Pick<JsonReply, "status" | "json">): ProviderBalance {
  if (r.status === 401 || r.status === 403) return { ok: false, error: `HTTP_${r.status}`, state: "unauthorized" };
  const j = obj(r.json);
  if (r.status !== 200 || !j) return { ok: false, error: `HTTP_${r.status}`, state: "failed" };
  const total = decimal(j.total_usd);
  const available = decimal(j.available_usd);
  if (total === null && available === null) return { ok: false, error: "MALFORMED_BALANCE", state: "failed" };
  const limit = decimal(j.daily_limit_usd);
  return {
    ok: true, total, available, held: decimal(j.held_usd), unit: "usd", scope: "wallet",
    note: limit && Number(limit) > 0 ? `Daily limit ${limit} USD, spent today ${decimal(j.spent_today_usd) ?? "unknown"} USD` : null,
  };
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

export const cuddlerClient: ProviderClient = {
  name: "cuddler",
  adapters: ["cuddler-video", "cuddler-image"],
  // Not documented: confirm the output host with an authorised test and add it to MEDIA_FETCH_ALLOWED_HOSTS.
  resultHosts: [],
  balanceSupport: "api",

  async submit(req) {
    const built = buildCuddler(req);
    let outcome: SubmitOutcome = { kind: "unknown", code: "NOT_SENT", message: "not sent" };
    // At most two sends with the same Idempotency-Key: the second only after a lost or 5xx reply.
    for (let i = 0; i < 2; i++) {
      try {
        const r = await requestJson(BASE, built.path, {
          method: "POST", headers: { ...auth(req.key), "Idempotency-Key": req.idempotencyKey }, body: built.body, timeoutMs: CREATE_TIMEOUT_MS,
        });
        outcome = classifyCuddlerCreate(r);
        if (outcome.kind !== "unknown" || r.status < 500) return outcome;
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        outcome = { kind: "unknown", code: e.timeout ? "TIMEOUT" : "NETWORK", message: e.message };
      }
    }
    return outcome;
  },

  async getTask(taskId, { route, key }) {
    if (!safeId(taskId)) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    const path = route.adapter === "cuddler-image" ? `/v1/images/${encodeURIComponent(taskId)}` : `/v1/videos/${encodeURIComponent(taskId)}`;
    const r = await readWithRetry(() => requestJson(BASE, path, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    return normalizeCuddlerJob(taskId, r);
  },

  async readBalance(key) {
    try {
      return parseCuddlerBalance(await requestJson(BASE, "/v1/balance", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    } catch (e) {
      return { ok: false, error: e instanceof NetworkError && e.timeout ? "TIMEOUT" : "NETWORK", state: "failed" };
    }
  },

  async readUsage(key, { from, to }): Promise<UsageReport | null> {
    const q = `?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
    try {
      const r = await requestJson(BASE, `/v1/usage${q}`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS });
      const total = obj(obj(r.json)?.total);
      if (r.status !== 200 || !total) return null;
      return { scope: "account", from: from.toISOString(), to: to.toISOString(), timezone: "UTC", amountUsd: decimal(total.usd),
        nativeAmount: decimal(total.usd), nativeUnit: "usd", requests: null };
    } catch {
      return null;
    }
  },
};
