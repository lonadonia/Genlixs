import { input, ok, rpc, withUser } from "@/lib/server/http";

/** Owner deletion: access ends now; the stored object is removed by durable work (§16.6). */
export const DELETE = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) =>
  ok(await rpc(supabase, "request_asset_deletion", { p_asset_id: input.uuid(params.id, "File") }), 200, requestId),
);
