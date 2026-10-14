import { input, ok, rpc, withUser } from "@/lib/server/http";

/** Owner revocation of a share link (future access ends). */
export const DELETE = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) =>
  ok(await rpc(supabase, "revoke_share_link", { p_share_id: input.uuid(params.id, "Share") }), 200, requestId),
);
