import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { testGatewayActive } from "@/lib/billing";
import { adminClient } from "@/lib/supabase/admin";
import { kickWorker } from "@/lib/jobs/kick";

/**
 * TEST GATEWAY ONLY (BILLING_PROVIDER=test, never on a production deployment). Emits the same normalized event a
 * real gateway webhook would, through the same durable receipt → events queue → grant path (§17.3). It does not
 * show a simulated success: the wallet changes only when the events worker applies the receipt.
 */
export const POST = withUser<{ orderId: string }>(async (req, { supabase, params, requestId }) => {
  if (!testGatewayActive()) throw new ApiError("NOT_FOUND", "Not found.", 404);
  const orderId = input.uuid(params.orderId, "Order")!;
  const own = await rpc<{ id: string } | null>(supabase, "get_order", { p_order_id: orderId });
  if (!own) throw new ApiError("NOT_FOUND", "Order not found.", 404);
  const body = await readJson(req);
  const outcome = input.oneOf(body.outcome, "Outcome", ["paid", "failed"] as const)!;

  const admin = adminClient();
  const order = await rpc<{ amountMinor: string; currency: string; kind: string; state: string }>(admin, "get_order_for_checkout", {
    p_order_id: orderId,
  });
  if (order.kind !== "credit_pack") throw new ApiError("NOT_SUPPORTED", "The test gateway only simulates credit pack payments.", 422);
  const eventType = outcome === "paid" ? "payment.settled" : "payment.failed";
  const receipt = await rpc(admin, "record_billing_receipt", {
    p_gateway: "test",
    p_event_id: `test_${eventType}_${orderId}`,
    p_event_type: eventType,
    p_normalized: { orderId, paymentId: `test_pay_${orderId}`, amountMinor: order.amountMinor, currency: order.currency },
  });
  kickWorker("events", 15_000);
  return ok(receipt, 202, requestId);
});
