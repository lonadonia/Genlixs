import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Own collections with member asset ids. */
export const GET = withUser(async (_req, { supabase, requestId }) => {
  const { data, error } = await supabase.from("collections").select("id, name, created_at, collection_assets(asset_id)").order("created_at");
  if (error) throw error;
  return ok(
    (data ?? []).map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at, assetIds: (c.collection_assets ?? []).map((a) => a.asset_id) })),
    200,
    requestId,
  );
});

/** Create or rename (with `id`) an own collection. */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "upsert_collection", {
    p_name: input.str(body.name, "Name", { min: 1, max: 60 }),
    p_collection_id: input.uuid(body.id, "Collection", true) ?? null,
  });
  return ok(data, 201, requestId);
});
