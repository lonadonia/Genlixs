import { ApiError, input, ok, rpc, withUser } from "@/lib/server/http";
import { adminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/server/crypto";
import { imageDimensionsOk, sniff } from "@/lib/media/sniff";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Verifies the uploaded object from its bytes (magic number, size, dimensions, sha256) before it can be used
 * as a reference (§16.2). The intent is read with the customer's session first, so only the owner can finalize.
 */
export const POST = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) => {
  const id = input.uuid(params.id, "Upload id")!;
  const { data: intent } = await supabase
    .from("upload_intents")
    .select("id, bucket, object_path, expected_mime, expected_bytes, state, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!intent) throw new ApiError("NOT_FOUND", "Upload not found.", 404);
  if (intent.state === "validated") return ok(await rpc(adminClient(), "finalize_upload", { p_intent_id: id, p_verified: { ok: true } }), 200, requestId);
  if (intent.state !== "pending") throw new ApiError("UPLOAD_NOT_PENDING", "This upload can no longer be completed.", 409);

  const admin = adminClient();
  const { data: blob, error } = await admin.storage.from(intent.bucket).download(intent.object_path);
  if (error || !blob) throw new ApiError("UPLOAD_MISSING", "The file has not finished uploading. Try again.", 409);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const s = sniff(bytes);
  let reason: string | null = null;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) reason = "File size is not allowed.";
  else if (bytes.byteLength !== Number(intent.expected_bytes)) reason = "The uploaded file does not match the requested upload.";
  else if (!s || s.mime !== intent.expected_mime) reason = "The file content is not a supported image.";
  else if (!s.width || !s.height || !imageDimensionsOk(s, 8192) || s.width < 64 || s.height < 64) reason = "Image dimensions are not supported.";

  if (reason) {
    await admin.storage.from(intent.bucket).remove([intent.object_path]);
    await rpc(admin, "finalize_upload", { p_intent_id: id, p_verified: { ok: false, reason } });
    throw new ApiError("UPLOAD_REJECTED", reason, 422);
  }
  const data = await rpc(admin, "finalize_upload", {
    p_intent_id: id,
    p_verified: { ok: true, mime: s!.mime, bytes: bytes.byteLength, width: s!.width, height: s!.height, sha256: sha256Hex(bytes) },
  });
  return ok(data, 200, requestId);
});
