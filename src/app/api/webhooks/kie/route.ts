import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { sha256Hex } from "@/lib/server/crypto";
import { adminClient, adminConfigured } from "@/lib/supabase/admin";
import { extractTaskId, verifyCallback } from "@/lib/providers/kie/webhook";
import { kickWorker } from "@/lib/jobs/kick";

const MAX_BODY = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KIE completion callback (§15). Verifies HMAC(taskId + "." + timestamp) in constant time with a 5-minute replay
 * window, persists a receipt, and only schedules an authoritative status read. The unsigned body is never
 * trusted for state, result URLs or billing. Fails closed when the HMAC key is not configured.
 */
export async function POST(req: NextRequest) {
  const reply = (status: number, body: object = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const key = env.kieHmacKey();
  if (!key || !adminConfigured()) return reply(503, { error: "not_configured" });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "too_large" });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid_body" });
  }
  const timestamp = req.headers.get("x-webhook-timestamp");
  const signature = req.headers.get("x-webhook-signature");
  const check = verifyCallback(key, extractTaskId(body), timestamp, signature);
  if (!check.ok) {
    console.warn(`[kie-callback] rejected: ${check.reason}`);
    return reply(401, { error: "unverified" });
  }

  const attempt = req.nextUrl.searchParams.get("attempt");
  const correlation = req.nextUrl.searchParams.get("correlation");
  const { data, error } = await adminClient().rpc("provider_callback_receipt", {
    p_task_id: check.taskId,
    p_timestamp: check.timestamp,
    p_signature_fingerprint: sha256Hex(signature!),
    p_attempt_hint: attempt && UUID.test(attempt) ? attempt.toLowerCase() : null,
    p_correlation_hash: correlation ? sha256Hex(correlation) : null,
  });
  if (error) {
    console.error("[kie-callback] receipt failed", error.code);
    return reply(500, { error: "receipt_failed" });
  }
  if (!data?.duplicate) kickWorker("control", 15_000);
  return reply(200, { ok: true });
}
