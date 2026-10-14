import "server-only";
import { ConfigError, env } from "@/lib/server/env";
import {
  TransientProviderError,
  type GenerationProvider,
  type NormalizedState,
  type SubmitOutcome,
  type SubmitRequest,
  type TaskDetail,
} from "../types";
import { buildInput } from "./adapters";

/**
 * KIE Market API client (guide §12). The bearer key is server-only and never sent to media hosts.
 * Create-task POSTs are never retried automatically: an ambiguous result becomes an unknown submission.
 */
const CREATE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type KieEnvelope = { code?: unknown; msg?: unknown; message?: unknown; data?: unknown };

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseEnvelope(text: string): KieEnvelope | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as KieEnvelope) : null;
  } catch {
    return null;
  }
}

const msgOf = (e: KieEnvelope) => String(e.msg ?? e.message ?? "").slice(0, 300);
const codeOf = (e: KieEnvelope) => (typeof e.code === "number" || typeof e.code === "string" ? Number(e.code) : NaN);

const TERMINAL: Record<number, [string, string]> = {
  400: ["INVALID_REQUEST", "The generation service did not accept this prompt or these settings."],
  422: ["INVALID_REQUEST", "The generation service did not accept this prompt or these settings."],
  404: ["MODEL_NOT_AVAILABLE", "This model is not available right now."],
  501: ["GENERATION_REJECTED", "The generation service could not start this request."],
  505: ["MODEL_NOT_AVAILABLE", "This model is not available right now."],
};
/** Explicit rejections documented as not entering the provider queue. */
const RETRYABLE = new Set([401, 402, 429, 433, 455]);

/** Classifies one create-task response (§12.5 table). Exported for contract tests. */
export function classifyCreate(httpStatus: number, body: string): SubmitOutcome {
  const e = parseEnvelope(body);
  if (!e) {
    if (httpStatus === 429) return { kind: "rejected_retryable", code: "HTTP_429", message: "rate limited" };
    return { kind: "unknown", code: `HTTP_${httpStatus}_UNPARSEABLE`, message: "unparseable create response" };
  }
  const code = codeOf(e);
  if (code === 200) {
    const data = e.data as { taskId?: unknown } | null | undefined;
    const taskId = typeof data?.taskId === "string" ? data.taskId.trim() : "";
    if (taskId && /^[A-Za-z0-9_-]{4,120}$/.test(taskId)) return { kind: "accepted", taskId };
    return { kind: "unknown", code: "MALFORMED_ACCEPTED", message: "accepted response without a valid task id" };
  }
  if (TERMINAL[code]) {
    const [publicCode, publicMessage] = TERMINAL[code];
    return { kind: "rejected_terminal", code: `KIE_${code}`, message: msgOf(e), publicCode, publicMessage };
  }
  if (RETRYABLE.has(code) || httpStatus === 429) return { kind: "rejected_retryable", code: `KIE_${code}`, message: msgOf(e) };
  // 500 and anything unexplained: the task may exist. Never resend blindly.
  return { kind: "unknown", code: `KIE_${Number.isNaN(code) ? "NO_CODE" : code}`, message: msgOf(e) };
}

const STATE_MAP: Record<string, NormalizedState> = {
  waiting: "pending",
  queuing: "pending",
  generating: "pending",
  success: "success",
  fail: "fail",
};

function parseJsonString(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v !== "string" || !v) return null;
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

const optStr = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, 500));

/** Normalizes a recordInfo response (§12.4). Exported for contract tests. */
export function normalizeRecord(taskId: string, httpStatus: number, body: string): TaskDetail {
  const e = parseEnvelope(body);
  if (!e) {
    if (httpStatus >= 500 || httpStatus === 429) throw new TransientProviderError(`status read HTTP ${httpStatus}`);
    return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  }
  const code = codeOf(e);
  if (code === 404) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
  if (code !== 200) {
    if (code === 429 || code === 455 || code === 500 || httpStatus >= 500) throw new TransientProviderError(`status read code ${code}`);
    return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failCode: String(code), failMsg: msgOf(e) };
  }
  const d = (e.data ?? {}) as Record<string, unknown>;
  if (typeof d.taskId === "string" && d.taskId !== taskId) {
    // A detail for a different task is never evidence for this one.
    return { taskId, providerState: null, normalized: "unknown", resultUrls: [], failMsg: "task id mismatch" };
  }
  const state = typeof d.state === "string" ? d.state : null;
  const result = parseJsonString(d.resultJson);
  const urls = Array.isArray(result?.resultUrls) ? (result!.resultUrls as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const param = parseJsonString(d.param);
  return {
    taskId,
    providerState: state,
    normalized: state ? (STATE_MAP[state] ?? "unknown") : "unknown",
    resultUrls: urls,
    failCode: optStr(d.failCode),
    failMsg: optStr(d.failMsg),
    creditsConsumed: optStr(d.creditsConsumed ?? d.costCredits),
    costTime: optStr(d.costTime),
    progress: optStr(d.progress),
    callBackUrl: typeof param?.callBackUrl === "string" ? param.callBackUrl : null,
  };
}

export class KieProvider implements GenerationProvider {
  readonly name = "kie";

  private config() {
    const key = env.kieApiKey();
    if (!key) throw new ConfigError("Generation provider", ["KIE_API_KEY"]);
    // Fixed allowlisted origin: the bearer key is only ever sent here.
    const base = env.kieBaseUrl().replace(/\/+$/, "");
    if (base !== "https://api.kie.ai") throw new ConfigError("Generation provider", ["KIE_API_BASE_URL"]);
    return { key, base };
  }

  async submit(req: SubmitRequest): Promise<SubmitOutcome> {
    const { key, base } = this.config();
    const body = {
      model: req.context.model.providerModelId,
      ...(req.callBackUrl ? { callBackUrl: req.callBackUrl } : {}),
      input: buildInput(req),
    };
    let res: Response;
    try {
      res = await fetch(`${base}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // The request may have reached the provider: unknown, never a blind resend (§12.5).
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { kind: "unknown", code: timeout ? "TIMEOUT" : "NETWORK", message: timeout ? "create timed out" : "connection lost" };
    }
    let text: string;
    try {
      text = await readCapped(res, MAX_RESPONSE_BYTES);
    } catch {
      return { kind: "unknown", code: "RESPONSE_READ_FAILED", message: "create response could not be read" };
    }
    return classifyCreate(res.status, text);
  }

  async getTask(taskId: string): Promise<TaskDetail> {
    const { key, base } = this.config();
    let lastError = "status read failed";
    // Safe read: a couple of quick retries for network faults only.
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
          cache: "no-store",
        });
        return normalizeRecord(taskId, res.status, await readCapped(res, MAX_RESPONSE_BYTES));
      } catch (e) {
        if (e instanceof TransientProviderError) throw e;
        lastError = e instanceof Error ? e.name : "error";
        await new Promise((r) => setTimeout(r, 300 * (i + 1) + Math.floor(Math.random() * 200)));
      }
    }
    throw new TransientProviderError(lastError);
  }

  /** Supplier balance (§12.5). A failed read is "unknown", never zero. */
  async balance(): Promise<number | null> {
    const { key, base } = this.config();
    try {
      const res = await fetch(`${base}/api/v1/chat/credit`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: "no-store",
      });
      const e = parseEnvelope(await readCapped(res, 64_000));
      if (!e || codeOf(e) !== 200) return null;
      const n = Number(e.data);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}
