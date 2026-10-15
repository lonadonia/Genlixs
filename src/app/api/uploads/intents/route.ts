import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "audio/mpeg", "audio/wav", "audio/mp4"] as const;
const SUPPORT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;

/**
 * Upload intent (§16.2): the database validates purpose/MIME/size and authorizes exactly one object path.
 * The browser then uploads to that path with its own session (Storage policy: pending intent, own folder).
 * References may be images (10 MB), MP4/MOV video (50 MB) or MP3/WAV/M4A audio (15 MB).
 */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const purpose = input.oneOf(body.purpose, "Purpose", ["reference", "support"] as const)!;
  const mime = input.oneOf(body.mime, "File type", purpose === "reference" ? REFERENCE_TYPES : SUPPORT_TYPES)!;
  const data = await rpc(supabase, "create_upload_intent", {
    p_purpose: purpose,
    p_mime: mime,
    p_bytes: input.int(body.bytes, "File size", { min: 1, max: 50 * 1024 * 1024 }),
    p_name: input.str(body.name, "File name", { max: 200, optional: true }) ?? null,
  });
  return ok(data, 201, requestId);
});
