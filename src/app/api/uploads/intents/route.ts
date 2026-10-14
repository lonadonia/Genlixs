import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/**
 * Upload intent (§16.2): the database validates purpose/MIME/size and authorizes exactly one object path.
 * The browser then uploads to that path with its own session (Storage policy: pending intent, own folder).
 */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "create_upload_intent", {
    p_purpose: input.oneOf(body.purpose, "Purpose", ["reference", "support"] as const),
    p_mime: input.oneOf(body.mime, "File type", ["image/png", "image/jpeg", "image/webp"] as const),
    p_bytes: input.int(body.bytes, "File size", { min: 1, max: 10 * 1024 * 1024 }),
    p_name: input.str(body.name, "File name", { max: 200, optional: true }) ?? null,
  });
  return ok(data, 201, requestId);
});
