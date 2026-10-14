import { ApiError, input, ok, rpc, withUser } from "@/lib/server/http";

/** Own order state (used after returning from checkout; the wallet changes only via verified events). */
export const GET = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) => {
  const order = await rpc(supabase, "get_order", { p_order_id: input.uuid(params.id, "Order") });
  if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
  return ok(order, 200, requestId);
});
