import { NextResponse, type NextRequest } from "next/server";
import { billingGateway } from "@/lib/billing";
import { adminClient } from "@/lib/supabase/admin";
import { kickWorker } from "@/lib/jobs/kick";
import { newRequestId } from "@/lib/server/http";

const MAX_BODY = 256 * 1024;

/**
 * Billing webhook (§17.3): verify the gateway signature over the raw body, persist one receipt per gateway
 * event id, then process through the events queue. Duplicate deliveries are acknowledged without effect.
 */
export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const reply = (status: number, body: object) => NextResponse.json({ ...body, requestId }, { status, headers: { "Cache-Control": "no-store" } });
  let gateway;
  try {
    gateway = billingGateway();
  } catch {
    return reply(503, { error: "not_configured" });
  }
  if (!gateway) return reply(503, { error: "not_configured" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "too_large" });
  let events;
  try {
    events = await gateway.verifyWebhook(req.headers, raw);
  } catch {
    return reply(400, { error: "invalid_signature" });
  }
  const admin = adminClient();
  for (const e of events) {
    const { error } = await admin.rpc("record_billing_receipt", {
      p_gateway: gateway.name, p_event_id: e.eventId, p_event_type: e.eventType, p_normalized: e.normalized,
    });
    // Not persisted → ask the gateway to retry; never acknowledge an event we did not store.
    if (error) return reply(500, { error: "receipt_failed" });
  }
  kickWorker("events", 15_000);
  return reply(200, { received: events.length });
}
