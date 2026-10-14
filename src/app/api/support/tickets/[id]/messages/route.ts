import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Customer reply on an own request. */
export const POST = withUser<{ id: string }>(async (req, { supabase, params, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "add_support_message", {
    p_ticket_id: input.uuid(params.id, "Request"),
    p_body: input.str(body.body, "Message", { min: 1, max: 5000 }),
  });
  return ok(data, 201, requestId);
});
