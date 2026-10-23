import "server-only";
import { APIMART_CATALOG_ADAPTERS, buildApimartCatalog } from "./apimart-catalog";
import { decimal, NetworkError, obj, onOff, readWithRetry, requestJson, safeId, str, type JsonReply } from "./http";
import {
  TransientProviderError,
  type NormalizedState,
  type ProviderBalance,
  type ProviderClient,
  type RoutedSubmit,
  type SubmitOutcome,
  type TaskDetail,
  type UsageReport,
} from "./types";

/**
 * APIMart (api.apimart.ai, docs checked 18 Oct 2026). Bearer key; async tasks polled at /v1/tasks/{id}. No submit
 * idempotency is documented, so an ambiguous create is reported as unknown and never re-sent. Charges are read from
 * the task's credits_cost (APIMart credits, 10 per USD at Gold).
 */
const BASE = "https://api.apimart.ai";
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;

const slot = (req: RoutedSubmit, name: string) => req.inputUrls?.[name] ?? [];

/** Request for one routed job. Exported for contract tests. */
export function buildApimart(req: RoutedSubmit): { path: string; body: Record<string, unknown> } {
  const catalog = buildApimartCatalog(req);
  if (catalog) return catalog;
  const { route, context } = req;
  const o = context.job.options;
  if (route.adapter === "apimart-video") {
    const first = slot(req, "first_frame");
    const last = slot(req, "last_frame");
    const images = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    if (last.length && !first.length) throw new Error("last frame without first frame");
    // Documented: image_urls and image_with_roles are exclusive; frames exclude reference video and audio.
    if (first.length && (images.length || audio.length)) throw new Error("frames and references cannot be combined");
    return {
      path: "/v1/videos/generations",
      body: {
        model: route.upstreamModelId,
        prompt: context.job.prompt,
        duration: Number(o.duration),
        resolution: String(o.resolution),
        size: String(o.aspect_ratio),
        generate_audio: onOff(o.audio),
        ...(first.length
          ? { image_with_roles: [{ url: first[0], role: "first_frame" }, ...(last.length ? [{ url: last[0], role: "last_frame" }] : [])] }
          : {}),
        ...(images.length ? { image_urls: images } : {}),
        ...(audio.length ? { audio_urls: audio } : {}),
      },
    };
  }
  if (route.adapter === "apimart-image") {
    if (context.job.tool === "edit" && req.referenceUrls.length < 1) throw new Error("reference image missing");
    const refs = context.job.tool === "edit" ? req.referenceUrls : [];
    return {
      path: "/v1/images/generations",
      body: {
        model: route.upstreamModelId,
        prompt: context.job.prompt,
        size: String(o.aspect_ratio),
        resolution: String(o.resolution),
        n: 1,
        ...(refs.length ? { image_urls: refs } : {}),
      },
    };
  }
  throw new Error(`no APIMart adapter ${route.adapter}`);
}

/** Classifies one create reply. Exported for contract tests. */
export function classifyApimartCreate(r: Pick<JsonReply, "status" | "json">): SubmitOutcome {
  const j = obj(r.json);
  if (r.status === 200 && j && Number(j.code) === 200) {
    const first = Array.isArray(j.data) ? obj(j.data[0]) : obj(j.data);
    const id = str(first?.task_id, 160);
    if (id && safeId(id)) return { kind: "accepted", taskId: id };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid task id" };
  }
  const err = obj(j?.error);
  const code = Number(err?.code ?? j?.code ?? r.status);
  const message = str(err?.message ?? j?.message) ?? "";
  if (!j) return r.status === 429 ? { kind: "rejected_retryable", code: "HTTP_429", message: "rate limited" } : { kind: "unknown", code: `HTTP_${r.status}_UNPARSEABLE`, message: "unparseable create response" };
  if (code === 401 || code === 402 || code === 403) return { kind: "rejected_account", code: `APIMART_${code}`, message };
  if (code === 429) return { kind: "rejected_retryable", code: "APIMART_429", message };
  if (code === 400 || code === 404 || code === 422) {
    return { kind: "rejected_terminal", code: `APIMART_${code}`, message, publicCode: "INVALID_REQUEST",
      publicMessage: "The generation service did not accept this prompt or these settings." };
  }
  return { kind: "unknown", code: `APIMART_${Number.isNaN(code) ? "NO_CODE" : code}`, message };
}

const STATE: Record<string, NormalizedState> = { pending: "pending", submitted: "pending", processing: "pending", completed: "success", failed: "fail", cancelled: "fail" };

/** Result URLs from result.images[] / result.videos[] (url as a string or a list). */
function resultUrls(result: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  for (const k of ["videos", "images"]) {
    const list = result?.[k];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const u = obj(item)?.url;
      for (const v of Array.isArray(u) ? u : [u]) if (typeof v === "string" && v.startsWith("https://")) out.push(v);
    }
  }
  return out;
}

/** Normalizes GET /v1/tasks/{id}. Exported for contract tests. */
export function normalizeApimartTask(taskId: string, r: Pick<JsonReply, "status" | "json">): TaskDetail {
  if (r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403) throw new TransientProviderError(`status read HTTP ${r.status}`);
  const j = obj(r.json);
  if (r.status === 400 || r.status === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
  const d = obj(j?.data);
  if (r.status !== 200 || !d) return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  if (typeof d.id === "string" && d.id !== taskId) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "task id mismatch" };
  const state = str(d.status, 40);
  const err = obj(d.error);
  const final = state === "completed" || state === "failed" || state === "cancelled";
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE[state] ?? "unknown") : "unknown",
    resultUrls: state === "completed" ? resultUrls(obj(d.result)) : [],
    failCode: err ? str(err.code, 40) : null,
    failMsg: err ? str(err.message) : null,
    creditsConsumed: final ? decimal(d.credits_cost) : null,
    progress: decimal(d.progress),
  };
}

export function parseApimartBalance(user: Pick<JsonReply, "status" | "json">, key: Pick<JsonReply, "status" | "json"> | null): ProviderBalance {
  if (user.status === 401 || user.status === 403) return { ok: false, error: `HTTP_${user.status}`, state: "unauthorized" };
  const u = obj(user.json);
  if (user.status !== 200 || !u || u.success !== true) return { ok: false, error: u?.success === false ? "APIMART_BALANCE_FAILED" : `HTTP_${user.status}`, state: "failed" };
  const total = decimal(u.remain_credits);
  if (total === null) return { ok: false, error: "MALFORMED_BALANCE", state: "failed" };
  const k = key && key.status === 200 ? obj(key.json) : null;
  const note =
    k?.success === true
      ? k.unlimited_quota === true
        ? "This API key has an unlimited allowance; spending is limited by the account balance."
        : `This API key's own allowance: ${decimal(k.remain_credits) ?? "unknown"} credits.`
      : null;
  return { ok: true, total, available: null, held: null, unit: "apimart_credit", scope: "wallet", note };
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

export const apimartClient: ProviderClient = {
  name: "apimart",
  adapters: ["apimart-video", "apimart-image", ...APIMART_CATALOG_ADAPTERS],
  resultHosts: ["upload.apimart.ai"],
  balanceSupport: "api",

  async submit(req) {
    const built = buildApimart(req);
    try {
      return classifyApimartCreate(await requestJson(BASE, built.path, { method: "POST", headers: auth(req.key), body: built.body, timeoutMs: CREATE_TIMEOUT_MS }));
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return { kind: "unknown", code: e.timeout ? "TIMEOUT" : "NETWORK", message: e.message };
    }
  },

  async getTask(taskId, { key }) {
    if (!safeId(taskId)) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    const r = await readWithRetry(() => requestJson(BASE, `/v1/tasks/${encodeURIComponent(taskId)}?language=en`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    return normalizeApimartTask(taskId, r);
  },

  async readBalance(key) {
    try {
      const user = await requestJson(BASE, "/v1/user/balance", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS });
      const k = await requestJson(BASE, "/v1/balance", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
      return parseApimartBalance(user, k);
    } catch (e) {
      return { ok: false, error: e instanceof NetworkError && e.timeout ? "TIMEOUT" : "NETWORK", state: "failed" };
    }
  },

  // Documented limit: at most 31 days per request; account scope; explicit UTC.
  async readUsage(key, { from, to }): Promise<UsageReport | null> {
    const start = Math.max(Math.floor(from.getTime() / 1000), Math.floor(to.getTime() / 1000) - 31 * 86400 + 60);
    const end = Math.floor(to.getTime() / 1000);
    try {
      const r = await requestJson(BASE, `/v1/usage?start=${start}&end=${end}&scope=account&tz=UTC`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS });
      const total = obj(obj(obj(r.json)?.data)?.total);
      if (r.status !== 200 || !total) return null;
      return { scope: "account", from: new Date(start * 1000).toISOString(), to: new Date(end * 1000).toISOString(), timezone: "UTC",
        amountUsd: decimal(total.amount_usd), nativeAmount: decimal(total.credits), nativeUnit: "apimart_credit",
        requests: typeof total.requests === "number" ? total.requests : null };
    } catch {
      return null;
    }
  },
};
