import { ApiError, input, ok, rpc, withUser } from "@/lib/server/http";
import { adminClient } from "@/lib/supabase/admin";
import { probeMedia } from "@/lib/media/probe";
import { sniff } from "@/lib/media/sniff";

export const maxDuration = 120;
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Reads picture size, length and frame rate of one of the caller's own files that was saved before these facts were
 * recorded, so it can be reused as an input. Ownership is checked with the caller's session first; only missing
 * facts are filled in.
 */
export const POST = withUser<{ id: string }>(async (_req, { supabase, user, params, requestId }) => {
  const id = input.uuid(params.id, "File")!;
  const loc = await rpc<{ bucket: string; path: string; mime: string; bytes: string } | null>(supabase, "authorize_asset_download", { p_asset_id: id });
  if (!loc) throw new ApiError("NOT_FOUND", "File not found.", 404);
  if (Number(loc.bytes) > MAX_BYTES) throw new ApiError("FILE_TOO_LARGE", "This file is larger than 50 MB and cannot be reused as an input.", 422);
  const { data: blob, error } = await adminClient().storage.from(loc.bucket).download(loc.path);
  if (error || !blob) throw new ApiError("NOT_FOUND", "File not found.", 404);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const p = loc.mime.startsWith("video/") || loc.mime.startsWith("audio/") ? probeMedia(bytes) : null;
  const s = p ? null : sniff(bytes);
  const facts = p
    ? { width: p.width ?? null, height: p.height ?? null, durationMs: p.durationMs, media: { fps: p.fps ?? null, hasAudio: p.hasAudio, hasVideo: p.hasVideo, codec: p.codec ?? null } }
    : { width: s?.width ?? null, height: s?.height ?? null, durationMs: null, media: {} };
  const data = await rpc(adminClient(), "record_asset_media", { p_asset_id: id, p_user_id: user.id, p_facts: facts });
  return ok(data, 200, requestId);
});
