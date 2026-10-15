// Byte-level file verification used for uploads and provider imports (guide §16.2, §16.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { imageDimensionsOk, sniff } from "../../src/lib/media/sniff";

const media = new URL("../../public/media/client/", import.meta.url);
const first = (ext: string) => readdirSync(media).find((f) => f.endsWith(ext))!;

test("real WebP and MP4 files are recognized with dimensions and duration", () => {
  const webp = sniff(new Uint8Array(readFileSync(new URL(first(".webp"), media))));
  assert.equal(webp?.mime, "image/webp");
  assert.ok((webp?.width ?? 0) > 0 && (webp?.height ?? 0) > 0);
  const mp4 = sniff(new Uint8Array(readFileSync(new URL(first(".mp4"), media))));
  assert.equal(mp4?.mime, "video/mp4");
  assert.ok((mp4?.durationMs ?? 0) > 0, "duration from mvhd");
});

test("PNG and JPEG headers give dimensions", () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0, 0, 0, 3, 0]);
  assert.deepEqual(sniff(png), { mime: "image/png", ext: "png", width: 1024, height: 768 });
  // SOI, APP0 (len 16), SOF0 with height 600 / width 800
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0]);
  assert.deepEqual(sniff(jpg), { mime: "image/jpeg", ext: "jpg", width: 800, height: 600 });
});

test("renamed or unknown content is rejected; absurd dimensions fail the bound", () => {
  assert.equal(sniff(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniff(new TextEncoder().encode("GIF89a.......")), null);
  assert.equal(sniff(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null);
  assert.equal(imageDimensionsOk({ mime: "image/png", ext: "png", width: 50_000, height: 50_000 }), false);
  assert.equal(imageDimensionsOk({ mime: "image/png", ext: "png", width: 2048, height: 2048 }), true);
});

// ------------------------------------------------- video/audio references (15 Oct 2026)
import { probeMedia } from "../../src/lib/media/probe";
import { verifyUpload } from "../../src/lib/media/verify-upload";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/media/${name}`, import.meta.url)));

test("video references: length, picture size, frame rate and tracks are read from the container", () => {
  const mov = probeMedia(fixture("clip-3s-25fps.mov"));
  assert.equal(mov?.mime, "video/quicktime");
  assert.deepEqual([mov?.durationMs, mov?.width, mov?.height, mov?.fps, mov?.hasAudio], [3000, 160, 90, 25, true]);
  // The movie header after the media data (no "fast start") is still found.
  const tail = probeMedia(fixture("clip-2s-30fps-moov-end.mp4"));
  assert.deepEqual([tail?.mime, tail?.durationMs, tail?.fps, tail?.hasAudio], ["video/mp4", 2000, 30, false]);
  // A phone clip stored sideways reports the size people see.
  const rotated = probeMedia(fixture("clip-2s-rotated.mp4"));
  assert.deepEqual([rotated?.width, rotated?.height], [90, 160]);
  const real = probeMedia(new Uint8Array(readFileSync(new URL(first(".mp4"), media))));
  assert.deepEqual([real?.width, real?.height, real?.fps], [540, 960, 24]);
});

test("audio references: MP3, WAV and M4A lengths", () => {
  const mp3 = probeMedia(fixture("tone-2s.mp3"));
  assert.equal(mp3?.mime, "audio/mpeg");
  assert.ok(Math.abs((mp3?.durationMs ?? 0) - 2000) < 100, `mp3 ${mp3?.durationMs}`);
  assert.deepEqual([probeMedia(fixture("tone-2s.wav"))?.mime, probeMedia(fixture("tone-2s.wav"))?.durationMs], ["audio/wav", 2000]);
  const m4a = probeMedia(fixture("tone-2s.m4a"));
  assert.deepEqual([m4a?.mime, m4a?.kind, m4a?.durationMs], ["audio/mp4", "audio", 2000]);
});

test("upload verification: declared type, size and content must agree", () => {
  const mov = fixture("clip-3s-25fps.mov");
  const ok = verifyUpload("video/quicktime", mov.byteLength, mov);
  assert.ok(ok.ok && ok.durationMs === 3000 && ok.media?.fps === 25);
  // A MOV announced as MP4, a WAV announced as MP3, a size mismatch and an image renamed to .mp4 are refused.
  assert.equal(verifyUpload("video/mp4", mov.byteLength, mov).ok, false);
  const wav = fixture("tone-2s.wav");
  assert.equal(verifyUpload("audio/mpeg", wav.byteLength, wav).ok, false);
  assert.equal(verifyUpload("video/quicktime", mov.byteLength + 1, mov).ok, false);
  const png = new Uint8Array(readFileSync(new URL(first(".webp"), media)));
  assert.equal(verifyUpload("video/mp4", png.byteLength, png).ok, false);
  // Audio-only MP4 is not a video.
  const m4a = fixture("tone-2s.m4a");
  assert.equal(verifyUpload("video/mp4", m4a.byteLength, m4a).ok, false);
  assert.equal(verifyUpload("audio/mp4", m4a.byteLength, m4a).ok, true);
});
