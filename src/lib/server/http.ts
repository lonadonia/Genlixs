import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { PostgrestError, SupabaseClient, User } from "@supabase/supabase-js";
import { ConfigError } from "./env";
import { currentUser } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Stable API envelope (guide §20):
 *   success: { data, requestId }
 *   failure: { error: { code, message, details? }, requestId }
 * Internal exception stacks and raw supplier errors never reach the customer.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ACCOUNT_RESTRICTED: 403,
  EMAIL_NOT_VERIFIED: 403,
  NOT_AN_AFFILIATE: 403,
  AFFILIATE_NOT_ACTIVE: 403,
  AFFILIATE_SUSPENDED: 403,
  SEPARATION_OF_DUTIES: 403,
  NOT_FOUND: 404,
  QUOTE_NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  WALLET_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTE_ALREADY_USED: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_STALE: 409,
  CANCEL_TOO_LATE: 409,
  INVALID_TRANSITION: 409,
  INVALID_STATE: 409,
  CHECKOUT_CONFLICT: 409,
  SUBSCRIPTION_EXISTS: 409,
  PREVIEW_STALE: 409,
  ROW_NOT_APPLICABLE: 409,
  BULK_BLOCKED: 409,
  MODEL_UNTESTED: 409,
  UNTESTED_CONFIRMATION_REQUIRED: 409,
  LOSS_REASON_REQUIRED: 409,
  LOSS_CONFIRMATION_REQUIRED: 409,
  REFERENCE_CHANGED: 409,
  PRICE_CHANGED: 409,
  PACKAGE_CHANGED: 409,
  CREDIT_VALUE_REQUIRED: 409,
  SPEND_CONFIRMATION_REQUIRED: 409,
  TEST_IN_PROGRESS: 409,
  ADAPTER_NOT_IMPLEMENTED: 409,
  PROVIDER_PAUSED: 409,
  COST_UNKNOWN: 409,
  STALE_CAPABILITY: 409,
  PRICE_INCOMPLETE: 409,
  CREDENTIALS_MISSING: 409,
  RATE_LIMITED: 429,
  TOO_MANY_ACTIVE_JOBS: 429,
  GENERATION_PAUSED: 503,
  MODEL_UNAVAILABLE: 503,
  TOOL_UNAVAILABLE: 503,
  MODEL_NOT_PRICED: 503,
  PRODUCT_UNAVAILABLE: 503,
  BILLING_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
};

export const newRequestId = () => crypto.randomUUID();

function headers(extra?: HeadersInit) {
  const h = new Headers(extra);
  h.set("Cache-Control", "private, no-store");
  return h;
}

export function ok(data: unknown, status = 200, requestId = newRequestId()) {
  return NextResponse.json({ data, requestId }, { status, headers: headers() });
}

export function fail(code: string, message: string, status: number, details?: unknown, requestId = newRequestId()) {
  return NextResponse.json({ error: { code, message, ...(details === undefined ? {} : { details }) }, requestId }, { status, headers: headers() });
}

/** Maps a business error raised by app_private.fail() (message = CODE, detail = text, hint = JSON) to HTTP. */
export function fromPostgrest(e: PostgrestError): ApiError {
  if (e.code === "P0001" && /^[A-Z_]+$/.test(e.message)) {
    let details: unknown;
    try {
      details = e.hint ? JSON.parse(e.hint) : undefined;
      if (details && typeof details === "object" && Object.keys(details as object).length === 0) details = undefined;
    } catch {
      details = undefined;
    }
    return new ApiError(e.message, e.details || "The request could not be completed.", STATUS[e.message] ?? 422, details);
  }
  if (e.code === "42501") return new ApiError("FORBIDDEN", "This action is not allowed.", 403);
  return new ApiError("INTERNAL", "Something went wrong on our side. Please try again.", 500);
}

/** Calls an RPC and unwraps its result, converting business errors. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = unknown>(client: SupabaseClient<any>, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args ?? {});
  if (error) throw fromPostgrest(error);
  return data as T;
}

export function toResponse(e: unknown, requestId = newRequestId()) {
  if (e instanceof ApiError) return fail(e.code, e.message, e.status, e.details, requestId);
  if (e instanceof ConfigError) {
    console.error(`[config] ${e.feature} not configured`);
    return fail("NOT_CONFIGURED", `${e.feature} is not available yet on this deployment.`, 503, undefined, requestId);
  }
  console.error(`[api] ${requestId}`, e instanceof Error ? e.message : e);
  return fail("INTERNAL", "Something went wrong on our side. Please try again.", 500, undefined, requestId);
}

/** Session-cookie mutations must come from this site (CSRF defence in depth, §20.2). */
export function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new ApiError("FORBIDDEN", "Missing request origin.", 403);
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError("FORBIDDEN", "Invalid request origin.", 403);
  }
  if (originHost !== host) throw new ApiError("FORBIDDEN", "Cross-site request refused.", 403);
}

type Params = Record<string, string | string[]>;
type Ctx<P extends Params> = { supabase: SupabaseClient<Database>; user: User; requestId: string; params: P };
type RouteArg = { params: Promise<Params> };

/** Route wrapper: verified user, same-origin mutations, uniform errors. */
export function withUser<P extends Params = Params>(handler: (req: NextRequest, ctx: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, route: RouteArg) => {
    const requestId = newRequestId();
    try {
      assertSameOrigin(req);
      const { supabase, user } = await currentUser();
      if (!user) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.", 401);
      const params = ((await route?.params) ?? {}) as P;
      return await handler(req, { supabase, user, requestId, params });
    } catch (e) {
      return toResponse(e, requestId);
    }
  };
}

/** Route wrapper without a session requirement (public reads, auth entry points). */
export function withRequest<P extends Params = Params>(
  handler: (req: NextRequest, ctx: { requestId: string; params: P }) => Promise<Response>,
  { sameOrigin = true } = {},
) {
  return async (req: NextRequest, route: RouteArg) => {
    const requestId = newRequestId();
    try {
      if (sameOrigin) assertSameOrigin(req);
      const params = ((await route?.params) ?? {}) as P;
      return await handler(req, { requestId, params });
    } catch (e) {
      return toResponse(e, requestId);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest, maxBytes = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new ApiError("INVALID_JSON", "Request body must be a JSON object.", 400);
  }
}

/** Small typed readers for validated input. */
export const input = {
  str(v: unknown, name: string, { min = 0, max = 4000, optional = false } = {}): string | undefined {
    if (v === undefined || v === null || v === "") {
      if (optional) return undefined;
      throw new ApiError("INVALID_INPUT", `${name} is required.`, 422);
    }
    if (typeof v !== "string") throw new ApiError("INVALID_INPUT", `${name} must be text.`, 422);
    const s = v.trim();
    if (s.length < min || s.length > max) throw new ApiError("INVALID_INPUT", `${name} must be ${min}–${max} characters.`, 422);
    return s;
  },
  uuid(v: unknown, name: string, optional = false): string | undefined {
    if ((v === undefined || v === null || v === "") && optional) return undefined;
    if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
      throw new ApiError("INVALID_INPUT", `${name} is not a valid id.`, 422);
    return v.toLowerCase();
  },
  int(v: unknown, name: string, { min = -Infinity, max = Infinity, optional = false } = {}): number | undefined {
    if ((v === undefined || v === null || v === "") && optional) return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) throw new ApiError("INVALID_INPUT", `${name} is not a valid number.`, 422);
    return n;
  },
  bool(v: unknown, name: string, optional = false): boolean | undefined {
    if (v === undefined || v === null) {
      if (optional) return undefined;
      throw new ApiError("INVALID_INPUT", `${name} is required.`, 422);
    }
    if (typeof v !== "boolean") throw new ApiError("INVALID_INPUT", `${name} must be true or false.`, 422);
    return v;
  },
  oneOf<T extends string>(v: unknown, name: string, values: readonly T[], optional = false): T | undefined {
    if ((v === undefined || v === null || v === "") && optional) return undefined;
    if (typeof v !== "string" || !values.includes(v as T)) throw new ApiError("INVALID_INPUT", `${name} is not allowed.`, 422);
    return v as T;
  },
  idempotencyKey(req: NextRequest): string {
    const k = req.headers.get("idempotency-key");
    if (!k || !/^[A-Za-z0-9_-]{8,100}$/.test(k)) throw new ApiError("INVALID_IDEMPOTENCY_KEY", "Send an Idempotency-Key header (8–100 safe characters).", 422);
    return k;
  },
};
