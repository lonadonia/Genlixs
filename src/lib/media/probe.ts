/**
 * Video and audio facts read from the bytes of an uploaded reference (guide §16.2): container, length, picture size,
 * frame rate and tracks. Pure functions over the whole file (inputs are capped at 50 MB), so they can be
 * contract-tested on real files. Names, extensions and declared types are never trusted.
 */
export type MediaProbe = {
  kind: "video" | "audio";
  mime: "video/mp4" | "video/quicktime" | "audio/mp4" | "audio/mpeg" | "audio/wav";
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codec?: string;
  rotation?: number;
};

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const s32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

type Box = { type: string; start: number; body: number; end: number };

/** Child boxes of [from, to). Malformed sizes stop the walk instead of reading past the data. */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    const type = ascii(b, o + 4, 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = u64(b, o + 8);
      header = 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < header || o + size > to) break;
    out.push({ type, start: o, body: o + header, end: o + size });
    o += size;
  }
  return out;
}
const child = (b: Uint8Array, box: Box, type: string) => boxes(b, box.body, box.end).find((x) => x.type === type);

type Track = { handler?: string; width?: number; height?: number; timescale?: number; duration?: number; samples?: number; codec?: string; rotation?: number };

function readTrack(b: Uint8Array, trak: Box): Track {
  const t: Track = {};
  const tkhd = child(b, trak, "tkhd");
  if (tkhd) {
    const v = b[tkhd.body];
    const base = tkhd.body + (v === 1 ? 4 + 32 : 4 + 20);
    // base → reserved(8) layer(2) alt(2) volume(2) reserved(2) matrix(36) width(4) height(4)
    const matrix = base + 16;
    const w = u32(b, matrix + 36) / 65536;
    const h = u32(b, matrix + 40) / 65536;
    if (w > 0 && h > 0) {
      t.width = Math.round(w);
      t.height = Math.round(h);
    }
    const a = s32(b, matrix) / 65536;
    const c = s32(b, matrix + 4) / 65536;
    const deg = Math.round((Math.atan2(c, a) * 180) / Math.PI);
    t.rotation = ((deg % 360) + 360) % 360;
  }
  const mdia = child(b, trak, "mdia");
  if (!mdia) return t;
  const mdhd = child(b, mdia, "mdhd");
  if (mdhd) {
    const v = b[mdhd.body];
    if (v === 1) {
      t.timescale = u32(b, mdhd.body + 4 + 16);
      t.duration = u64(b, mdhd.body + 4 + 20);
    } else {
      t.timescale = u32(b, mdhd.body + 4 + 8);
      t.duration = u32(b, mdhd.body + 4 + 12);
    }
  }
  const hdlr = child(b, mdia, "hdlr");
  if (hdlr) t.handler = ascii(b, hdlr.body + 8, 4);
  const stbl = (() => {
    const minf = child(b, mdia, "minf");
    return minf ? child(b, minf, "stbl") : undefined;
  })();
  if (stbl) {
    const stsd = child(b, stbl, "stsd");
    if (stsd && u32(b, stsd.body + 4) > 0) t.codec = ascii(b, stsd.body + 8 + 4, 4).trim();
    const stts = child(b, stbl, "stts");
    if (stts) {
      const n = u32(b, stts.body + 4);
      let samples = 0;
      for (let i = 0; i < n && stts.body + 8 + i * 8 + 8 <= stts.end; i++) samples += u32(b, stts.body + 8 + i * 8);
      t.samples = samples;
    }
  }
  return t;
}

/** ISO BMFF / QuickTime (MP4, MOV, M4A). The movie header may sit before or after the media data. */
function isoBmff(b: Uint8Array): MediaProbe | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const brand = ascii(b, 8, 4);
  const top = boxes(b, 0, b.length);
  const moov = top.find((x) => x.type === "moov");
  if (!moov) return null;
  const mvhd = child(b, moov, "mvhd");
  let durationMs = 0;
  if (mvhd) {
    const v = b[mvhd.body];
    const scale = v === 1 ? u32(b, mvhd.body + 4 + 16) : u32(b, mvhd.body + 4 + 8);
    const dur = v === 1 ? u64(b, mvhd.body + 4 + 20) : u32(b, mvhd.body + 4 + 12);
    if (scale > 0) durationMs = Math.round((dur / scale) * 1000);
  }
  const tracks = boxes(b, moov.body, moov.end).filter((x) => x.type === "trak").map((t) => readTrack(b, t));
  const video = tracks.find((t) => t.handler === "vide");
  const audio = tracks.find((t) => t.handler === "soun");
  if (!durationMs) {
    const t = video ?? audio;
    if (t?.timescale && t.duration) durationMs = Math.round((t.duration / t.timescale) * 1000);
  }
  if (!durationMs || (!video && !audio)) return null;
  const isAudioOnly = !video;
  const mime: MediaProbe["mime"] = isAudioOnly ? "audio/mp4" : brand === "qt  " ? "video/quicktime" : "video/mp4";
  const out: MediaProbe = { kind: isAudioOnly ? "audio" : "video", mime, durationMs, hasVideo: Boolean(video), hasAudio: Boolean(audio) };
  if (video) {
    const quarter = video.rotation === 90 || video.rotation === 270;
    if (video.width && video.height) {
      out.width = quarter ? video.height : video.width;
      out.height = quarter ? video.width : video.height;
    }
    if (video.samples && video.timescale && video.duration) out.fps = Math.round((video.samples / (video.duration / video.timescale)) * 100) / 100;
    if (video.codec) out.codec = video.codec;
    if (video.rotation) out.rotation = video.rotation;
  } else if (audio?.codec) {
    out.codec = audio.codec;
  }
  return out;
}

/** RIFF/WAVE: length from the data chunk size and the byte rate of the fmt chunk. */
function wav(b: Uint8Array): MediaProbe | null {
  if (b.length < 44 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  let o = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (o + 8 <= b.length) {
    const id = ascii(b, o, 4);
    const size = le32(b, o + 4);
    if (id === "fmt " && o + 8 + 16 <= b.length) byteRate = le32(b, o + 8 + 8);
    if (id === "data") {
      dataSize = Math.min(size, b.length - (o + 8));
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) return null;
  return { kind: "audio", mime: "audio/wav", durationMs: Math.round((dataSize / byteRate) * 1000), hasVideo: false, hasAudio: true, codec: "pcm" };
}

const MP3_BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** MPEG audio layer III (MP3): Xing/Info or VBRI frame count when present, otherwise the constant-bitrate length. */
function mp3(b: Uint8Array): MediaProbe | null {
  let o = 0;
  if (b.length > 10 && ascii(b, 0, 3) === "ID3") {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    o = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  // First frame header within the first 64 KB after the tag.
  const limit = Math.min(b.length - 4, o + 65536);
  for (; o < limit; o++) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[o + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[o + 1] >> 1) & 3; // 1 = layer III
    const brIdx = (b[o + 2] >> 4) & 15;
    const srIdx = (b[o + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const mpeg1 = ver === 3;
    const bitrate = (mpeg1 ? MP3_BITRATES["1-3"] : MP3_BITRATES["2-2"])[brIdx] * 1000;
    const rate = MP3_RATES[ver][srIdx];
    const pad = (b[o + 2] >> 1) & 1;
    const frameLen = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + pad;
    // Validate with the next frame header so random 0xFFE bytes are not taken for audio.
    const next = o + frameLen;
    if (next + 1 < b.length && !(b[next] === 0xff && (b[next + 1] & 0xe0) === 0xe0)) continue;
    const samplesPerFrame = mpeg1 ? 1152 : 576;
    const mono = ((b[o + 3] >> 6) & 3) === 3;
    const side = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = o + 4 + side;
    let frames = 0;
    if (x + 12 <= b.length && (ascii(b, x, 4) === "Xing" || ascii(b, x, 4) === "Info") && (u32(b, x + 4) & 1)) frames = u32(b, x + 8);
    else if (o + 36 + 18 <= b.length && ascii(b, o + 36, 4) === "VBRI") frames = u32(b, o + 36 + 14);
    const durationMs = frames
      ? Math.round(((frames * samplesPerFrame) / rate) * 1000)
      : Math.round((((b.length - o) * 8) / bitrate) * 1000);
    if (!durationMs) return null;
    return { kind: "audio", mime: "audio/mpeg", durationMs, hasVideo: false, hasAudio: true, codec: "mp3" };
  }
  return null;
}

export function probeMedia(bytes: Uint8Array): MediaProbe | null {
  return isoBmff(bytes) ?? wav(bytes) ?? mp3(bytes);
}
