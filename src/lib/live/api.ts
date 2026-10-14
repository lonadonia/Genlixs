"use client";

/**
 * Browser helper for the Genlixs API envelope ({ data } | { error: { code, message, details } }).
 * Business decisions stay on the server; this only transports and surfaces honest errors.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Options = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiClientError("NETWORK", "Connection problem. Check your connection and try again.", 0);
  }
  let json: { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } } | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.error) {
    const err = json?.error;
    throw new ApiClientError(err?.code ?? `HTTP_${res.status}`, err?.message ?? "Something went wrong. Please try again.", res.status, err?.details);
  }
  return json.data as T;
}

/** One key per user intent, reused for network retries of that same intent (§19.2). */
export const newIdempotencyKey = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

export const errorMessage = (e: unknown) => (e instanceof ApiClientError ? e.message : "Something went wrong. Please try again.");
