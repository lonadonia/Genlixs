import "server-only";
import { TransientProviderError } from "./types";

/**
 * HTTP helpers shared by the supplier adapters. Every call goes to a base URL fixed in the adapter's code (never an
 * Admin field), with TLS verification left on, a timeout and a response size cap. Keys go only in the header of that
 * fixed host and are never logged; errors carry short codes, not bodies or URLs.
 */
const MAX_RESPONSE_BYTES = 1_000_000;

export type JsonReply = { status: number; json: unknown; text: string; retryAfter: number | null };

export class NetworkError extends Error {
  constructor(public readonly timeout: boolean) {
    super(timeout ? "request timed out" : "connection lost");
    this.name = "NetworkError";
  }
}

async function readCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
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

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One request to `${base}${path}`. `base` must be one of the adapter's fixed origins; `path` is built by the adapter
 * from validated ids only. Network faults throw NetworkError (the caller decides whether the outcome is unknown).
 */
export async function requestJson(
  base: string,
  path: string,
  opts: { method?: "GET" | "POST"; headers: Record<string, string>; body?: unknown; timeoutMs: number },
): Promise<JsonReply> {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(base) || !path.startsWith("/") || path.includes("//") || path.includes("..")) {
    throw new Error("invalid provider endpoint");
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers: { ...opts.headers, ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"));
  }
  let text: string;
  try {
    text = await readCapped(res);
  } catch {
    throw new NetworkError(false);
  }
  const ra = Number(res.headers.get("retry-after"));
  return { status: res.status, json: parseJson(text), text, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
}

/** Safe status read with a couple of quick retries for network faults; anything else is returned to the caller. */
export async function readWithRetry(fn: () => Promise<JsonReply>): Promise<JsonReply> {
  let last = "status read failed";
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e instanceof Error ? e.message : "error";
      await new Promise((r) => setTimeout(r, 300 * (i + 1) + Math.floor(Math.random() * 200)));
    }
  }
  throw new TransientProviderError(last);
}

export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v ? v.slice(0, max) : typeof v === "number" ? String(v) : null);
/** Decimal text from a JSON number or numeric string ("12.5", 12.5); anything else is null (unknown). */
export function decimal(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return v.trim();
  return null;
}
/** A provider id we may put in a URL path: letters, digits and - _ . : only. */
export const safeId = (v: string) => /^[A-Za-z0-9_.:-]{3,160}$/.test(v);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)) : []);
export const onOff = (v: unknown) => {
  if (v !== "on" && v !== "off") throw new Error("unsupported audio setting");
  return v === "on";
};
