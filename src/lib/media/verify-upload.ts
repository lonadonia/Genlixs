/**
 * Upload verification from the stored bytes (guide §16.2): images by signature and size, video/audio by container,
 * length, picture size, frame rate and tracks. The declared type and size must match what was authorized.
 */
import { sha256Hex } from "@/lib/server/crypto";
import { imageDimensionsOk, sniff } from "./sniff";
import { probeMedia } from "./probe";

const MAX_BYTES: Record<string, number> = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 15 * 1024 * 1024, application: 10 * 1024 * 1024 };

type Verified = { ok: true; mime: string; bytes: number; width?: number; height?: number; durationMs?: number; sha256: string; media?: Record<string, unknown> };

export function verifyUpload(expectedMime: string, expectedBytes: number, bytes: Uint8Array): Verified | { ok: false; reason: string } {
  const kind = expectedMime.split("/")[0];
  if (bytes.byteLength === 0 || bytes.byteLength > (MAX_BYTES[kind] ?? MAX_BYTES.image)) return { ok: false, reason: "File size is not allowed." };
  if (bytes.byteLength !== expectedBytes) return { ok: false, reason: "The uploaded file does not match the requested upload." };
  if (kind === "video" || kind === "audio") {
    const p = probeMedia(bytes);
    if (!p || p.mime !== expectedMime) {
      return { ok: false, reason: kind === "video" ? "The file is not a readable MP4 or MOV video." : "The file is not a readable MP3, WAV or M4A audio file." };
    }
    if (kind === "video" && (!p.width || !p.height || !p.hasVideo)) return { ok: false, reason: "The video has no readable picture track." };
    if (p.durationMs < 500 || p.durationMs > 10 * 60 * 1000) return { ok: false, reason: "The length of this file is not supported." };
    return {
      ok: true, mime: p.mime, bytes: bytes.byteLength, width: p.width, height: p.height, durationMs: p.durationMs, sha256: sha256Hex(bytes),
      media: { fps: p.fps ?? null, hasAudio: p.hasAudio, hasVideo: p.hasVideo, codec: p.codec ?? null, rotation: p.rotation ?? 0 },
    };
  }
  const s = sniff(bytes);
  if (!s || s.mime !== expectedMime) return { ok: false, reason: "The file content is not a supported image." };
  if (!s.width || !s.height || !imageDimensionsOk(s, 8192) || s.width < 64 || s.height < 64) return { ok: false, reason: "Image dimensions are not supported." };
  return { ok: true, mime: s.mime, bytes: bytes.byteLength, width: s.width, height: s.height, sha256: sha256Hex(bytes) };
}
