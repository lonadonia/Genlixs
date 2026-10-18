import "server-only";
import { decimal, NetworkError, obj, readWithRetry, requestJson, safeId, str, type JsonReply } from "./http";
import {
  TransientProviderError,
  type NormalizedState,
  type ProviderBalance,
  type ProviderClient,
  type RoutedSubmit,
  type SubmitOutcome,
  type TaskDetail,
} from "./types";

/**
 * Duomi (duomiapi.com, OpenAPI pages on apifox checked 18 Oct 2026). The key goes in the Authorization header as is
 * (no "Bearer"). Nano Banana generation and editing are async jobs; business errors arrive inside HTTP 200 with
 * {code, msg}. The balance is read from Duomi's documented host api.wike.cc (data.total, in points: 1,000 = CNY 1).
 * The deprecated used/day_used fields are never used for spending.
 */
const BASE = "https://duomiapi.com";
const BALANCE_BASE = "https://api.wike.cc";
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;

/** Request for one routed job. Exported for contract tests. */
export function buildDuomi(req: RoutedSubmit): { path: string; body: Record<string, unknown> } {
  const { route, context } = req;
  const o = context.job.options;
  if (route.adapter === "duomi-nano-banana") {
    if (context.job.tool === "edit" && req.referenceUrls.length < 1) throw new Error("reference image missing");
    const refs = context.job.tool === "edit" ? req.referenceUrls : [];
    const size = String(o.resolution);
    if (!["1K", "2K", "4K"].includes(size)) throw new Error("unsupported resolution");
    return {
      path: refs.length ? "/api/gemini/nano-banana-edit" : "/api/gemini/nano-banana",
      body: { model: route.upstreamModelId, prompt: context.job.prompt, aspect_ratio: String(o.aspect_ratio), image_size: size, ...(refs.length ? { image_urls: refs } : {}) },
    };
  }
  throw new Error(`no Duomi adapter ${route.adapter}`);
}

/** Classifies one create reply (business code inside HTTP 200). Exported for contract tests. */
export function classifyDuomiCreate(r: Pick<JsonReply, "status" | "json">): SubmitOutcome {
  const j = obj(r.json);
  if (!j) {
    if (r.status === 429) return { kind: "rejected_retryable", code: "HTTP_429", message: "rate limited" };
    return { kind: "unknown", code: `HTTP_${r.status}_UNPARSEABLE`, message: "unparseable create response" };
  }
  const code = Number(j.code ?? r.status);
  const message = str(j.msg) ?? "";
  if (code === 200) {
    const id = str(obj(j.data)?.task_id, 160);
    if (id && safeId(id)) return { kind: "accepted", taskId: id };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid task id" };
  }
  // Documented example: code 400 "API账户余额不足或没有权限" (balance too low or no permission).
  if (code === 401 || code === 403 || /余额|权限/.test(message)) return { kind: "rejected_account", code: `DUOMI_${code}`, message };
  if (code === 429 || r.status === 429) return { kind: "rejected_retryable", code: `DUOMI_${code}`, message };
  if (code === 400 || code === 404) {
    return { kind: "rejected_terminal", code: `DUOMI_${code}`, message, publicCode: "INVALID_REQUEST",
      publicMessage: "The generation service did not accept this prompt or these settings." };
  }
  return { kind: "unknown", code: `DUOMI_${Number.isNaN(code) ? "NO_CODE" : code}`, message };
}

const STATE: Record<string, NormalizedState> = { pending: "pending", running: "pending", succeeded: "success", error: "fail" };

/** Normalizes GET /api/gemini/nano-banana/{id}. Exported for contract tests. */
export function normalizeDuomiTask(taskId: string, r: Pick<JsonReply, "status" | "json">): TaskDetail {
  if (r.status === 429 || r.status >= 500) throw new TransientProviderError(`status read HTTP ${r.status}`);
  const j = obj(r.json);
  if (!j || Number(j.code) !== 200) {
    if (r.status === 404 || Number(j?.code) === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    throw new TransientProviderError(`status read code ${j?.code ?? r.status}`);
  }
  const d = obj(j.data);
  if (!d) return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  if (typeof d.task_id === "string" && d.task_id !== taskId) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "task id mismatch" };
  const state = str(d.state, 40);
  const images = obj(d.data)?.images;
  const urls = Array.isArray(images) ? images.map((x) => obj(x)?.url).filter((u): u is string => typeof u === "string" && u.startsWith("https://")) : [];
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE[state] ?? "unknown") : "unknown",
    resultUrls: state === "succeeded" ? urls : [],
    failMsg: state === "error" ? str(d.msg) : null,
    // The task reply has no charge; the estimate stays until reconciled from the account.
    creditsConsumed: null,
    progress: null,
  };
}

export function parseDuomiBalance(r: Pick<JsonReply, "status" | "json">): ProviderBalance {
  const j = obj(r.json);
  if (r.status === 401 || r.status === 403 || Number(j?.code) === 403) return { ok: false, error: `DUOMI_${j?.code ?? r.status}`, state: "unauthorized" };
  const total = decimal(obj(j?.data)?.total);
  if (r.status !== 200 || Number(j?.code) !== 200 || total === null) return { ok: false, error: j ? `DUOMI_${j.code}` : `HTTP_${r.status}`, state: "failed" };
  return { ok: true, total, available: null, held: null, unit: "duomi_point", scope: "wallet", note: "Points (1,000 points = CNY 1)." };
}

const auth = (key: string) => ({ Authorization: key });

export const duomiClient: ProviderClient = {
  name: "duomi",
  adapters: ["duomi-nano-banana"],
  resultHosts: ["cdn3.dmiapi.com"],
  balanceSupport: "api",

  async submit(req) {
    const built = buildDuomi(req);
    try {
      return classifyDuomiCreate(await requestJson(BASE, built.path, { method: "POST", headers: auth(req.key), body: built.body, timeoutMs: CREATE_TIMEOUT_MS }));
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return { kind: "unknown", code: e.timeout ? "TIMEOUT" : "NETWORK", message: e.message };
    }
  },

  async getTask(taskId, { key }) {
    if (!safeId(taskId)) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    const r = await readWithRetry(() => requestJson(BASE, `/api/gemini/nano-banana/${encodeURIComponent(taskId)}`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    return normalizeDuomiTask(taskId, r);
  },

  async readBalance(key) {
    try {
      return parseDuomiBalance(await requestJson(BALANCE_BASE, "/api/account/get", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    } catch (e) {
      return { ok: false, error: e instanceof NetworkError && e.timeout ? "TIMEOUT" : "NETWORK", state: "failed" };
    }
  },
};
