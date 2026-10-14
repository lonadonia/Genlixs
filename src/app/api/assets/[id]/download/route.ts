import { ApiError, input, ok, rpc, withUser } from "@/lib/server/http";

const TTL_SECONDS = 300;

/**
 * Short-lived signed download for the owner's own file (§16.3). Signed with the customer's session, so the
 * Storage policy (own folder) is enforced in addition to the ownership RPC.
 */
export const POST = withUser<{ id: string }>(async (req, { supabase, params, requestId }) => {
  const id = input.uuid(params.id, "File")!;
  const loc = await rpc<{ bucket: string; path: string; mime: string } | null>(supabase, "authorize_asset_download", { p_asset_id: id });
  if (!loc) throw new ApiError("NOT_FOUND", "File not found.", 404);
  const attachment = req.nextUrl.searchParams.get("inline") !== "1";
  const ext = loc.path.split(".").pop();
  const { data, error } = await supabase.storage
    .from(loc.bucket)
    .createSignedUrl(loc.path, TTL_SECONDS, attachment ? { download: `genlixs-${id.slice(0, 8)}.${ext}` } : undefined);
  if (error || !data) throw new ApiError("NOT_FOUND", "File not found.", 404);
  return ok({ url: data.signedUrl, mime: loc.mime, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() }, 200, requestId);
});
