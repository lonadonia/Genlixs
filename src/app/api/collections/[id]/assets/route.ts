import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Adds or removes an own saved file from an own collection. */
export const POST = withUser<{ id: string }>(async (req, { supabase, params, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "set_collection_membership", {
    p_collection_id: input.uuid(params.id, "Collection"),
    p_asset_id: input.uuid(body.assetId, "File"),
    p_member: input.bool(body.member, "Member"),
  });
  return ok(data, 200, requestId);
});
