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
 * PoYo (api.poyo.ai, docs checked 18 Oct 2026): one async envelope {model, input, callback_url?} posted to
 * /api/generate/submit and polled at /api/generate/status/{task_id}; balance at /api/user/balance (credits, 200 per
 * USD). Failed tasks are not charged. No submit idempotency is documented.
 */
const BASE = "https://api.poyo.ai";
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;

const slot = (req: RoutedSubmit, name: string) => req.inputUrls?.[name] ?? [];

/** Request for one routed job. Exported for contract tests. */
export function buildPoyo(req: RoutedSubmit): { path: string; body: Record<string, unknown> } {
  const { route, context } = req;
  const o = context.job.options;
  if (route.adapter === "poyo-kling-motion") {
    const character = slot(req, "character_image");
    const motion = slot(req, "motion_video");
    if (character.length !== 1 || motion.length !== 1) throw new Error("character image and motion video are required");
    const orientation = String(o.orientation);
    const resolution = String(o.mode);
    if (orientation !== "video" && orientation !== "image") throw new Error("unsupported orientation");
    if (resolution !== "720p" && resolution !== "1080p") throw new Error("unsupported resolution");
    const prompt = context.job.prompt.trim();
    return {
      path: "/api/generate/submit",
      body: {
        model: route.upstreamModelId,
        input: { ...(prompt ? { prompt } : {}), image_urls: character, video_urls: motion, character_orientation: orientation, resolution },
      },
    };
  }
  throw new Error(`no PoYo adapter ${route.adapter}`);
}

/** Classifies one submit reply. Exported for contract tests. */
export function classifyPoyoSubmit(r: Pick<JsonReply, "status" | "json">): SubmitOutcome {
  const j = obj(r.json);
  if (r.status === 200 && j && Number(j.code) === 200) {
    const id = str(obj(j.data)?.task_id, 160);
    if (id && safeId(id)) return { kind: "accepted", taskId: id };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid task id" };
  }
  if (!j) return r.status === 429 ? { kind: "rejected_retryable", code: "HTTP_429", message: "rate limited" } : { kind: "unknown", code: `HTTP_${r.status}_UNPARSEABLE`, message: "unparseable submit response" };
  const code = Number(j.code ?? r.status);
  const message = str(obj(j.error)?.message ?? j.message) ?? "";
  if (code === 401 || code === 402 || code === 403) return { kind: "rejected_account", code: `POYO_${code}`, message };
  if (code === 429) return { kind: "rejected_retryable", code: "POYO_429", message };
  if (code === 400 || code === 404 || code === 422) {
    return { kind: "rejected_terminal", code: `POYO_${code}`, message, publicCode: "INVALID_REQUEST",
      publicMessage: "The generation service did not accept this prompt or these settings." };
  }
  return { kind: "unknown", code: `POYO_${Number.isNaN(code) ? "NO_CODE" : code}`, message };
}

const STATE: Record<string, NormalizedState> = { not_started: "pending", running: "pending", finished: "success", failed: "fail" };

/** Normalizes GET /api/generate/status/{id}. Exported for contract tests. */
export function normalizePoyoStatus(taskId: string, r: Pick<JsonReply, "status" | "json">): TaskDetail {
  if (r.status === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
  if (r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403) throw new TransientProviderError(`status read HTTP ${r.status}`);
  const d = obj(obj(r.json)?.data);
  if (r.status !== 200 || !d) return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  if (typeof d.task_id === "string" && d.task_id !== taskId) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "task id mismatch" };
  const state = str(d.status, 40);
  const files = Array.isArray(d.files) ? d.files.map((f) => obj(f)) : [];
  const urls = files
    .filter((f) => f && (f.file_type === "video" || f.file_type === "image"))
    .map((f) => f!.file_url)
    .filter((u): u is string => typeof u === "string" && u.startsWith("https://"));
  const final = state === "finished" || state === "failed";
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE[state] ?? "unknown") : "unknown",
    resultUrls: state === "finished" ? urls : [],
    failMsg: str(d.error_message),
    creditsConsumed: final ? decimal(d.credits_amount) : null,
    progress: null,
  };
}

export function parsePoyoBalance(r: Pick<JsonReply, "status" | "json">): ProviderBalance {
  if (r.status === 401 || r.status === 403) return { ok: false, error: `HTTP_${r.status}`, state: "unauthorized" };
  const j = obj(r.json);
  const total = decimal(obj(j?.data)?.credits_amount);
  if (r.status !== 200 || Number(j?.code) !== 200 || total === null) return { ok: false, error: r.status === 200 ? "MALFORMED_BALANCE" : `HTTP_${r.status}`, state: "failed" };
  return { ok: true, total, available: null, held: null, unit: "poyo_credit", scope: "wallet", note: null };
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

export const poyoClient: ProviderClient = {
  name: "poyo",
  adapters: ["poyo-kling-motion"],
  resultHosts: ["storage.poyo.ai"],
  balanceSupport: "api",

  async submit(req) {
    const built = buildPoyo(req);
    try {
      return classifyPoyoSubmit(await requestJson(BASE, built.path, { method: "POST", headers: auth(req.key), body: built.body, timeoutMs: CREATE_TIMEOUT_MS }));
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return { kind: "unknown", code: e.timeout ? "TIMEOUT" : "NETWORK", message: e.message };
    }
  },

  async getTask(taskId, { key }) {
    if (!safeId(taskId)) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    const r = await readWithRetry(() => requestJson(BASE, `/api/generate/status/${encodeURIComponent(taskId)}`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    return normalizePoyoStatus(taskId, r);
  },

  async readBalance(key) {
    try {
      return parsePoyoBalance(await requestJson(BASE, "/api/user/balance", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    } catch (e) {
      return { ok: false, error: e instanceof NetworkError && e.timeout ? "TIMEOUT" : "NETWORK", state: "failed" };
    }
  },
};
