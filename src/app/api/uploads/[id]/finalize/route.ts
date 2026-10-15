import { ApiError, input, ok, rpc, withUser } from "@/lib/server/http";
import { adminClient } from "@/lib/supabase/admin";
import { verifyUpload } from "@/lib/media/verify-upload";

export const maxDuration = 120;

/**
 * Verifies the uploaded object from its bytes before it can be used in a quote (§16.2). The intent is read with the
 * customer's session first, so only the owner can finalize. A rejected file is deleted and never becomes an asset.
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
  const v = verifyUpload(intent.expected_mime, Number(intent.expected_bytes), bytes);
  if (!v.ok) {
    await admin.storage.from(intent.bucket).remove([intent.object_path]);
    await rpc(admin, "finalize_upload", { p_intent_id: id, p_verified: { ok: false, reason: v.reason } });
    throw new ApiError("UPLOAD_REJECTED", v.reason, 422);
  }
  const data = await rpc(admin, "finalize_upload", { p_intent_id: id, p_verified: v });
  return ok(data, 200, requestId);
});
