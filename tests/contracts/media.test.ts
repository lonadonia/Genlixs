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
