import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Own support requests with visible replies. */
export const GET = withUser(async (_req, { supabase, requestId }) => ok(await rpc(supabase, "list_my_tickets"), 200, requestId));

/** New request with optional safe job/payment reference (ownership is checked in the database). */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "create_support_ticket", {
    p_subject: input.str(body.subject, "Subject", { min: 3, max: 140 }),
    p_category: input.oneOf(body.category, "Topic", ["generation", "billing", "account", "partner", "other"] as const),
    p_body: input.str(body.body, "Message", { min: 1, max: 5000 }),
    p_job_id: input.uuid(body.jobId, "Job", true) ?? null,
    p_order_id: input.uuid(body.orderId, "Payment", true) ?? null,
  });
  return ok(data, 201, requestId);
});
