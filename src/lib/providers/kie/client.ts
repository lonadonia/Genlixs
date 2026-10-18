import "server-only";
import { ConfigError, env } from "@/lib/server/env";
import {
  TransientProviderError,
  type BalanceRead,
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
const RETRYABLE = new Set([429, 433, 455]);
/**
 * Refusals of our account (401 access, 402 credits): no task exists, but retrying quickly cannot help and the
 * customer must not be told the service is merely busy. The database pauses new quotes briefly and bounds the wait.
 */
const ACCOUNT = new Set([401, 402]);

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
  if (ACCOUNT.has(code)) return { kind: "rejected_account", code: `KIE_${code}`, message: msgOf(e) };
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

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : []);

/**
 * Deliverable URLs from a parsed resultJson. Most models return {resultUrls}; Veo 3.1 generated at 1080p/4K documents
 * the upgraded file under data.result_urls (with the 720p original in data.origin_urls), so the nested form wins when
 * present. Originals (origin_urls/originUrls) and extras such as Seedance's lastFrameUrl are never deliverables.
 */
export function resultUrlsOf(result: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? (result.data as Record<string, unknown>) : null;
  for (const candidate of [data?.result_urls, data?.resultUrls, result.resultUrls, result.result_urls]) {
    const urls = strings(candidate);
    if (urls.length) return urls;
  }
  return [];
}

/** Normalizes a recordInfo response (§12.4). Exported for contract tests. */
export function normalizeRecord(taskId: string, httpStatus: number, body: string): TaskDetail {
  const e = parseEnvelope(body);
  if (!e) {
    if (httpStatus >= 500 || httpStatus === 429) throw new TransientProviderError(`status read HTTP ${httpStatus}`);
    return { taskId, providerState: null, normalized: "unknown", resultUrls: [] };
  }
  const code = codeOf(e);
  // 404, and 422 "task does not exist or does not belong to your account" (Get Task Details docs): evidence only.
  if (code === 404 || code === 422) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
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
  const urls = resultUrlsOf(parseJsonString(d.resultJson));
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

  /** A key saved in Admin (Vault) for routed attempts; without one, the server's KIE_API_KEY is used as before. */
  constructor(private readonly apiKey?: string) {}

  private config() {
    const key = this.apiKey ?? env.kieApiKey();
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
    const r = await this.readBalance();
    return r.ok ? r.credits : null;
  }

  /** GET /api/v1/chat/credit (documented: Bearer key; {code, msg, data: number}). Errors carry a short code only. */
  async readBalance(): Promise<BalanceRead> {
    const { key, base } = this.config();
    try {
      const res = await fetch(`${base}/api/v1/chat/credit`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: "no-store",
      });
      return parseBalance(res.status, await readCapped(res, 64_000));
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, error: timeout ? "TIMEOUT" : "NETWORK" };
    }
  }
}

/**
 * A credit amount written as a number or as text ("1234.5", "1,234.5", " 100 "); anything else is not a balance.
 * A negative amount is a real reading (KIE reports an account that owes credits) and is kept as such.
 */
function creditAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Balance fields seen in credit replies besides the documented bare number. */
const BALANCE_KEYS = ["credits", "credit", "balance", "remainingCredits", "remaining_credits", "remainCredits", "remaining", "availableCredits", "available", "amount"];

/**
 * Parses the balance reply. Exported for contract tests. The documented shape is {code: 200, data: <number>}; a number
 * in text or one balance field of an object is accepted too. Anything else is an error, never zero. The error names
 * only the shape (type and field names, no values) so an unexpected reply can be recognised from the admin page.
 */
export function parseBalance(httpStatus: number, body: string): BalanceRead {
  const e = parseEnvelope(body);
  if (!e) return { ok: false, error: `HTTP_${httpStatus}` };
  const code = codeOf(e);
  if (code !== 200) return { ok: false, error: `KIE_${Number.isNaN(code) ? "NO_CODE" : code}` };
  const direct = creditAmount(e.data);
  if (direct !== null) return { ok: true, credits: direct };
  const data = e.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    for (const k of BALANCE_KEYS) {
      const n = creditAmount(record[k]);
      if (n !== null) return { ok: true, credits: n };
    }
    const keys = Object.keys(record)
      .map((k) => k.replace(/[^A-Za-z0-9_]/g, "").slice(0, 24))
      .filter(Boolean)
      .slice(0, 6);
    return { ok: false, error: `MALFORMED_OBJECT${keys.length ? `:${keys.join(",")}` : ""}` };
  }
  const kind = data === null ? "NULL" : data === undefined ? "MISSING" : Array.isArray(data) ? "ARRAY" : typeof data === "number" ? "NUMBER" : typeof data;
  return { ok: false, error: `MALFORMED_${String(kind).toUpperCase()}` };
}
