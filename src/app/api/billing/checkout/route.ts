import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { requireGateway, type CheckoutOrder } from "@/lib/billing";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/server/env";

/**
 * Server-priced, idempotent checkout (§17.2). The amount, currency and credits come from the published product
 * snapshot stored on the order — never from the browser. Without a configured gateway this answers 503.
 */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const gateway = requireGateway();
  const key = input.idempotencyKey(req);
  const body = await readJson(req);
  const order = await rpc<{ orderId: string; checkoutUrl?: string | null; replayed: boolean }>(supabase, "create_checkout_order", {
    p_product_key: input.str(body.productKey, "Product", { min: 1, max: 60 }),
    p_idempotency_key: key,
  });
  if (order.replayed && order.checkoutUrl) return ok({ orderId: order.orderId, checkoutUrl: order.checkoutUrl }, 200, requestId);

  const admin = adminClient();
  const snapshot = await rpc<CheckoutOrder & { gatewayCheckoutId: string | null; checkoutUrl: string | null }>(admin, "get_order_for_checkout", {
    p_order_id: order.orderId,
  });
  const base = env.appBaseUrl() ?? req.nextUrl.origin;
  const session = await gateway.createCheckout(snapshot, {
    successUrl: `${base}/studio/billing?order=${order.orderId}`,
    cancelUrl: `${base}/studio/billing?order=${order.orderId}&cancelled=1`,
  });
  const bound = await rpc<{ checkoutUrl: string }>(admin, "bind_checkout", {
    p_order_id: order.orderId,
    p_gateway: gateway.name,
    p_checkout_id: session.checkoutId,
    p_checkout_url: session.checkoutUrl,
  });
  return ok({ orderId: order.orderId, checkoutUrl: bound.checkoutUrl }, 201, requestId);
});
