import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { randomToken, sha256Hex } from "@/lib/server/crypto";

/** Explicit, expiring, revocable share. Only the token hash is stored; the plain link is shown once. */
export const POST = withUser<{ id: string }>(async (req, { supabase, params, requestId }) => {
  const body = await readJson(req);
  const days = input.int(body.expiresInDays, "Expiry", { min: 1, max: 30, optional: true }) ?? 7;
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const data = await rpc<{ shareId: string }>(supabase, "create_share_link", {
    p_asset_id: input.uuid(params.id, "File"),
    p_token_hash: sha256Hex(token),
    p_expires_at: expiresAt,
  });
  return ok({ shareId: data.shareId, url: `${req.nextUrl.origin}/s/${token}`, expiresAt }, 201, requestId);
});
