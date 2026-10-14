import "server-only";
import { hmacBase64, safeEqual } from "@/lib/server/crypto";

/**
 * KIE callback verification (guide §15.1): signature = base64(HMAC-SHA256(key, taskId + "." + timestamp)).
 * The signature does not cover the body, so the body is only a hint; the worker reads authoritative detail.
 */
export const REPLAY_WINDOW_SECONDS = 300;

export type CallbackCheck =
  | { ok: true; taskId: string; timestamp: string }
  | { ok: false; reason: "missing" | "stale" | "signature" | "task" };

export function extractTaskId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
  const v = data.taskId ?? data.task_id ?? b.taskId ?? b.task_id;
  return typeof v === "string" && /^[A-Za-z0-9_-]{4,120}$/.test(v) ? v : null;
}

export function verifyCallback(
  key: string,
  taskId: string | null,
  timestamp: string | null,
  signature: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): CallbackCheck {
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!taskId) return { ok: false, reason: "task" };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: "stale" };
  if (Math.abs(nowSeconds - Number(timestamp)) > REPLAY_WINDOW_SECONDS) return { ok: false, reason: "stale" };
  const expected = hmacBase64(key, `${taskId}.${timestamp}`);
  if (!safeEqual(expected, signature.trim())) return { ok: false, reason: "signature" };
  return { ok: true, taskId, timestamp };
}

/** Reads the attempt id and correlation token from a callBackUrl recorded with a task (binding evidence). */
export function parseCallbackUrl(url: string | null | undefined): { attempt: string | null; correlation: string | null } {
  if (!url) return { attempt: null, correlation: null };
  try {
    const u = new URL(url);
    const attempt = u.searchParams.get("attempt");
    return {
      attempt: attempt && /^[0-9a-f-]{36}$/i.test(attempt) ? attempt.toLowerCase() : null,
      correlation: u.searchParams.get("correlation"),
    };
  } catch {
    return { attempt: null, correlation: null };
  }
}
