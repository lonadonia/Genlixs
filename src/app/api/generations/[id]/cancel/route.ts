import { input, ok, rpc, withUser } from "@/lib/server/http";

/** Owner cancellation; wins only while the submit work item is still unclaimed (§14). */
export const POST = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) =>
  ok(await rpc(supabase, "cancel_queued_generation", { p_job_id: input.uuid(params.id, "Job") }), 200, requestId),
);
