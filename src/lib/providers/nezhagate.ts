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
  type UsageReport,
} from "./types";

/**
 * NezhaGate (nezhagate.com/v1, docs checked 18 Oct 2026). Bearer key; image and video jobs return HTTP 202 with a job
 * id and are polled. 502/503 replies are documented as not billed and safe to retry; failed jobs are refunded in full.
 * Reference images are never frames, and Seedance sound cannot be switched off (the offers' capabilities say so).
 */
const BASE = "https://nezhagate.com";
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;

const slot = (req: RoutedSubmit, name: string) => req.inputUrls?.[name] ?? [];

/** Request for one routed job. Exported for contract tests. */
export function buildNezhagate(req: RoutedSubmit): { path: string; body: Record<string, unknown> } {
  const { route, context } = req;
  const o = context.job.options;
  if (route.adapter === "nezhagate-video") {
    if (slot(req, "first_frame").length || slot(req, "last_frame").length) throw new Error("frames are not supported on this route");
    if (o.audio !== undefined && o.audio !== "on") throw new Error("sound cannot be switched off on this route");
    const images = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    if (audio.length && !images.length) throw new Error("reference audio needs a reference image");
    return {
      path: "/v1/videos/generations",
      body: {
        model: route.upstreamModelId,
        prompt: context.job.prompt,
        duration: Number(o.duration),
        // Documented as 480P / 720P / 1080P ("Keep the P").
        resolution: String(o.resolution).toUpperCase(),
        size: String(o.aspect_ratio),
        ...(images.length ? { images } : {}),
        ...(audio.length ? { audio_reference: audio } : {}),
      },
    };
  }
  if (route.adapter === "nezhagate-image") {
    if (context.job.tool === "edit" && req.referenceUrls.length < 1) throw new Error("reference image missing");
    const refs = context.job.tool === "edit" ? req.referenceUrls : [];
    if (refs.length > 8) throw new Error("at most 8 reference images");
    return {
      path: "/v1/images/generations",
      body: {
        model: route.upstreamModelId,
        prompt: context.job.prompt,
        size: String(o.aspect_ratio),
        resolution: String(o.resolution),
        ...(refs.length ? { images: refs } : {}),
      },
    };
  }
  throw new Error(`no NezhaGate adapter ${route.adapter}`);
}

const ACCOUNT = new Set(["missing_api_key", "invalid_api_key", "insufficient_quota", "permission_denied"]);

/** Classifies one create reply (documented codes). Exported for contract tests. */
export function classifyNezhagateCreate(r: Pick<JsonReply, "status" | "json">): SubmitOutcome {
  const j = obj(r.json);
  if ((r.status === 202 || r.status === 200) && j && !j.error) {
    const id = str(j.id, 160);
    if (id && safeId(id)) return { kind: "accepted", taskId: id };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid job id" };
  }
  const err = obj(j?.error);
  const code = str(err?.code, 60) ?? `HTTP_${r.status}`;
  const message = str(err?.message) ?? "";
  if (ACCOUNT.has(code) || r.status === 401 || r.status === 402 || r.status === 403) return { kind: "rejected_account", code: `NEZHA_${code}`, message };
  // 429, and 502/503 which are documented as not billed: nothing was created.
  if (r.status === 429 || r.status === 502 || r.status === 503) return { kind: "rejected_retryable", code: `NEZHA_${code}`, message };
  if (r.status === 400 || r.status === 404 || r.status === 422) {
    return { kind: "rejected_terminal", code: `NEZHA_${code}`, message, publicCode: "INVALID_REQUEST",
      publicMessage: "The generation service did not accept this prompt or these settings." };
  }
  return { kind: "unknown", code: `NEZHA_${code}`, message };
}

const STATE: Record<string, NormalizedState> = { queued: "pending", processing: "pending", succeeded: "success", failed: "fail" };

/** Normalizes GET /v1/{images|videos}/jobs/{id}. Exported for contract tests. */
export function normalizeNezhagateJob(taskId: string, r: Pick<JsonReply, "status" | "json">): TaskDetail {
  if (r.status === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
  if (r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403) throw new TransientProviderError(`status read HTTP ${r.status}`);
  const j = obj(r.json);
  if (r.status !== 200 || !j) return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  if (typeof j.id === "string" && j.id !== taskId) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "job id mismatch" };
  const state = str(j.status, 40);
  const err = obj(j.error);
  const urls = Array.isArray(j.data) ? j.data.map((x) => obj(x)?.url).filter((u): u is string => typeof u === "string" && u.startsWith("https://")) : [];
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE[state] ?? "unknown") : "unknown",
    resultUrls: state === "succeeded" ? urls : [],
    failCode: err ? str(err.code, 60) : null,
    failMsg: err ? str(err.message) : null,
    // The job reply carries counts (images, clips), not money: the estimate stays until the account usage reconciles it.
    creditsConsumed: null,
    progress: null,
  };
}

export function parseNezhagateUsage(r: Pick<JsonReply, "status" | "json">): ProviderBalance {
  if (r.status === 401 || r.status === 403) return { ok: false, error: `HTTP_${r.status}`, state: "unauthorized" };
  const j = obj(r.json);
  const total = decimal(obj(j?.balance)?.usd);
  if (r.status !== 200 || total === null) return { ok: false, error: r.status === 200 ? "MALFORMED_BALANCE" : `HTTP_${r.status}`, state: "failed" };
  return { ok: true, total, available: null, held: null, unit: "usd", scope: "wallet", note: "Every key of the account shares this balance." };
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

export const nezhagateClient: ProviderClient = {
  name: "nezhagate",
  adapters: ["nezhagate-video", "nezhagate-image"],
  resultHosts: ["img.nezhagate.com"],
  balanceSupport: "api",

  async submit(req) {
    const built = buildNezhagate(req);
    try {
      return classifyNezhagateCreate(await requestJson(BASE, built.path, { method: "POST", headers: auth(req.key), body: built.body, timeoutMs: CREATE_TIMEOUT_MS }));
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      return { kind: "unknown", code: e.timeout ? "TIMEOUT" : "NETWORK", message: e.message };
    }
  },

  async getTask(taskId, { route, key }) {
    if (!safeId(taskId)) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    const kind = route.adapter === "nezhagate-image" ? "images" : "videos";
    const r = await readWithRetry(() => requestJson(BASE, `/v1/${kind}/jobs/${encodeURIComponent(taskId)}`, { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    return normalizeNezhagateJob(taskId, r);
  },

  async readBalance(key) {
    try {
      return parseNezhagateUsage(await requestJson(BASE, "/v1/usage", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS }));
    } catch (e) {
      return { ok: false, error: e instanceof NetworkError && e.timeout ? "TIMEOUT" : "NETWORK", state: "failed" };
    }
  },

  // The usage endpoint reports today's and lifetime account spend; its day boundary is the provider's.
  async readUsage(key): Promise<UsageReport | null> {
    try {
      const r = await requestJson(BASE, "/v1/usage", { headers: auth(key), timeoutMs: READ_TIMEOUT_MS });
      const today = obj(obj(r.json)?.today);
      if (r.status !== 200 || !today) return null;
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return { scope: "account", from: start.toISOString(), to: now.toISOString(), timezone: "provider day",
        amountUsd: decimal(today.cost_usd), nativeAmount: decimal(today.cost_usd), nativeUnit: "usd",
        requests: typeof today.billed_requests === "number" ? today.billed_requests : null };
    } catch {
      return null;
    }
  },
};
