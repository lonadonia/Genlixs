import { ok, rpc, withUser } from "@/lib/server/http";
import { billingGateway } from "@/lib/billing";

/** Own orders + canonical subscription (maps the guide's /api/billing/orders and /subscription reads). */
export const GET = withUser(async (_req, { supabase, requestId }) => {
  const data = await rpc<Record<string, unknown>>(supabase, "get_billing_overview");
  let paymentsAvailable = false;
  try {
    paymentsAvailable = billingGateway() !== null;
  } catch {
    paymentsAvailable = false;
  }
  return ok({ ...data, paymentsAvailable }, 200, requestId);
});
