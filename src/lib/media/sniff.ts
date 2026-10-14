/**
 * Content verification from bytes, not names or headers (guide §16.2, §16.4). Pure functions so they can be
 * contract-tested without network or storage.
 */
export type Sniffed = { mime: string; ext: string; width?: number; height?: number; durationMs?: number };

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

function png(b: Uint8Array): Sniffed | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !sig.every((v, i) => b[i] === v) || ascii(b, 12, 4) !== "IHDR") return null;
  return { mime: "image/png", ext: "png", width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): Sniffed | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) return { mime: "image/jpeg", ext: "jpg", height: u16be(b, o + 5), width: u16be(b, o + 7) };
    if (len < 2) break;
    o += 2 + len;
  }
  return { mime: "image/jpeg", ext: "jpg" };
}

function webp(b: Uint8Array): Sniffed | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { mime: "image/webp", ext: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L" && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { mime: "image/webp", ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { mime: "image/webp", ext: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return { mime: "image/webp", ext: "webp" };
}

/** ISO BMFF (MP4): `ftyp` first, duration from `mvhd` when present. */
function mp4(b: Uint8Array): Sniffed | null {
  if (b.length < 12 || ascii(b, 4, 4) !== "ftyp") return null;
  const brand = ascii(b, 8, 4);
  if (!/^(isom|iso[2-9]|mp4[12]|avc1|M4V |mp42|dash|MSNV)$/.test(brand)) return null;
  const out: Sniffed = { mime: "video/mp4", ext: "mp4" };
  const needle = [0x6d, 0x76, 0x68, 0x64]; // "mvhd"
  for (let i = 8; i + 32 < b.length; i++) {
    if (b[i] !== needle[0] || b[i + 1] !== needle[1] || b[i + 2] !== needle[2] || b[i + 3] !== needle[3]) continue;
    const v = b[i + 4];
    if (v === 0) {
      const scale = u32be(b, i + 16);
      const dur = u32be(b, i + 20);
      if (scale > 0) out.durationMs = Math.round((dur / scale) * 1000);
    } else if (v === 1) {
      const scale = u32be(b, i + 24);
      const dur = u32be(b, i + 28) * 2 ** 32 + u32be(b, i + 32);
      if (scale > 0) out.durationMs = Math.round((dur / scale) * 1000);
    }
    break;
  }
  return out;
}

export function sniff(bytes: Uint8Array): Sniffed | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes) ?? mp4(bytes);
}

/** Sanity bounds for images: rejects decompression-bomb dimensions and degenerate files. */
export function imageDimensionsOk(s: Sniffed, max = 12_000) {
  return !s.width || !s.height || (s.width >= 1 && s.height >= 1 && s.width <= max && s.height <= max && s.width * s.height <= 80_000_000);
}
