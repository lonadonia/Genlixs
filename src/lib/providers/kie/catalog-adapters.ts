import type { SubmitRequest } from "../types";

/**
 * Request builders for the full image/video catalog (docs.kie.ai, every page re-read on 22 Oct 2026). Same rules as
 * adapters.ts: the quote already validated options, slots and their combination; a builder still refuses anything
 * the documented request cannot carry, so a malformed job never reaches KIE. Each request shape has its own adapter
 * name; a changed shape gets a new name, never an in-place edit. Where a model offers `nsfw_checker` it is sent as
 * true (Genlixs acceptable-use policy). Which KIE model id a job uses (text- or image-to-video, for example) comes from
 * the catalog row and the job's input mode, not from these builders.
 */
type Input = Record<string, unknown>;
type Options = Record<string, string | number>;
type Builder = (req: SubmitRequest) => Input;

const opts = (req: SubmitRequest): Options => req.context.job.options;
const slot = (req: SubmitRequest, name: string): string[] => req.inputUrls?.[name] ?? [];
const one = (req: SubmitRequest, name: string): string | undefined => slot(req, name)[0];

/** The option's value from a fixed list; anything else is a configuration error, never a guess. */
function pick(o: Options, key: string, allowed: readonly (string | number)[]): string {
  const v = o[key];
  if (v === undefined || !allowed.map(String).includes(String(v))) throw new Error(`unsupported ${key}`);
  return String(v);
}

/** A whole number of seconds (or count) inside a documented range. */
function int(o: Options, key: string, min: number, max: number): number {
  const n = Number(o[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`unsupported ${key}`);
  return n;
}

const onOff = (o: Options, key: string): boolean => {
  if (o[key] !== "on" && o[key] !== "off") throw new Error(`unsupported ${key}`);
  return o[key] === "on";
};

/** Maps an option through a fixed table (null = leave the field out). */
function mapped(o: Options, key: string, table: Record<string, string | null>): string | null {
  const v = table[String(o[key])];
  if (v === undefined) throw new Error(`unsupported ${key}`);
  return v;
}

const prompt = (req: SubmitRequest): string => req.context.job.prompt;
const optionalPrompt = (req: SubmitRequest): Input => {
  const p = req.context.job.prompt.trim();
  return p ? { prompt: p } : {};
};

/** Image tools: an edit must carry its reference images (in the customer's order); text-to-image never sends any. */
function references(req: SubmitRequest, max: number): string[] {
  if (req.context.job.tool !== "edit") return [];
  if (req.referenceUrls.length < 1) throw new Error("reference image missing");
  if (req.referenceUrls.length > max) throw new Error("too many reference images");
  return req.referenceUrls;
}

/** Stable per job (seed fields some models require): a re-submission after a definite rejection repeats the request. */
function seedOf(req: SubmitRequest): number {
  let h = 0;
  for (const ch of req.context.job.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2147483647;
}

function frames(req: SubmitRequest): { first?: string; last?: string } {
  const first = one(req, "first_frame");
  const last = one(req, "last_frame");
  if (last && !first) throw new Error("end frame without start frame");
  return { first, last };
}

function noFramesWithReferences(req: SubmitRequest, refSlots: string[]) {
  if ((one(req, "first_frame") || one(req, "last_frame")) && refSlots.some((s) => slot(req, s).length)) {
    throw new Error("frames and references cannot be combined");
  }
}

// ---------------------------------------------------------------------------------------------------------- images

const ASPECT_PRESET_6: Record<string, string> = {
  "1:1": "square_hd", "3:4": "portrait_4_3", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "16:9": "landscape_16_9",
};
const ASPECT_PRESET_9: Record<string, string> = {
  ...ASPECT_PRESET_6, "2:3": "portrait_3_2", "3:2": "landscape_3_2", "21:9": "landscape_21_9",
};
const SPEED: Record<string, string> = { turbo: "TURBO", balanced: "BALANCED", quality: "QUALITY" };

const IMAGE: Record<string, Builder> = {
  // GPT Image 1.5: aspect_ratio 1:1/2:3/3:2, quality medium/high; input_urls (up to 16) for image-to-image.
  "kie-gpt-image-1-5": (req) => {
    const o = opts(req);
    const r = references(req, 16);
    return { prompt: prompt(req), ...(r.length ? { input_urls: r } : {}), aspect_ratio: pick(o, "aspect_ratio", ["1:1", "2:3", "3:2"]),
      quality: pick(o, "quality", ["medium", "high"]) };
  },
  // 4o Image (model 4o-image-api): size is the aspect ratio; files_url (up to 5) for edits.
  "kie-4o-image": (req) => {
    const r = references(req, 5);
    return { prompt: prompt(req), size: pick(opts(req), "aspect_ratio", ["1:1", "3:2", "2:3"]), ...(r.length ? { files_url: r } : {}) };
  },
  // Nano Banana (google/nano-banana, google/nano-banana-edit): aspect_ratio, PNG output; image_urls (up to 10) to edit.
  "kie-nano-banana-1": (req) => {
    const r = references(req, 10);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(opts(req).aspect_ratio), output_format: "png" };
  },
  // Nano Banana 2 Lite: aspect_ratio required, optional image_urls (up to 10); one size (1K).
  "kie-nano-banana-lite": (req) => {
    const r = references(req, 10);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(opts(req).aspect_ratio) };
  },
  // Imagen 4 Fast / Standard / Ultra: prompt and aspect_ratio.
  "kie-imagen-4": (req) => ({ prompt: prompt(req), aspect_ratio: pick(opts(req), "aspect_ratio", ["1:1", "16:9", "9:16", "3:4", "4:3"]) }),
  // FLUX 3 Klein: aspect_ratio, resolution 1K/2K/4K, one PNG; image_urls (1–10) for edits.
  "kie-flux-3-klein": (req) => {
    const o = opts(req);
    const r = references(req, 10);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(o.aspect_ratio),
      resolution: pick(o, "resolution", ["1K", "2K", "4K"]), output_format: "png", num_images: 1, nsfw_checker: true };
  },
  // FLUX.1 Kontext (model flux1-kontext): input.model is the tier; input_image (one) for edits, whose shape it keeps
  // unless an aspect ratio is chosen.
  "kie-flux-kontext": (req) => {
    const o = opts(req);
    const r = references(req, 1);
    const aspect = mapped(o, "aspect_ratio", { auto: null, "21:9": "21:9", "16:9": "16:9", "4:3": "4:3", "1:1": "1:1", "3:4": "3:4", "9:16": "9:16" });
    if (aspect === null && !r.length) throw new Error("automatic aspect ratio needs an input image");
    return { prompt: prompt(req), model: mapped(o, "tier", { pro: "flux-kontext-pro", max: "flux-kontext-max" }),
      ...(r.length ? { input_image: r[0] } : {}), ...(aspect ? { aspect_ratio: aspect } : {}), output_format: "png" };
  },
  // Seedream 3.0: image_size preset from the aspect ratio.
  "kie-seedream-3": (req) => ({ prompt: prompt(req), image_size: mapped(opts(req), "aspect_ratio", ASPECT_PRESET_6) }),
  // Seedream 4.0: image_size preset + image_resolution, one image (max_images 1); image_urls (up to 10) for edits.
  "kie-seedream-4": (req) => {
    const o = opts(req);
    const r = references(req, 10);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), image_size: mapped(o, "aspect_ratio", ASPECT_PRESET_9),
      image_resolution: pick(o, "resolution", ["1K", "2K", "4K"]), max_images: 1, nsfw_checker: true };
  },
  // Seedream 4.5: aspect_ratio + quality (basic = 2K, high = 4K); image_urls (up to 14) for edits; no format field.
  "kie-seedream-4-5": (req) => {
    const o = opts(req);
    const r = references(req, 14);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(o.aspect_ratio),
      quality: pick(o, "quality", ["basic", "high"]), nsfw_checker: true };
  },
  // Seedream 5.0 Lite (quality basic/high/ultra, up to 14 inputs) and 5.0 Pro (basic/high, up to 10): PNG output.
  "kie-seedream-5-quality": (req) => {
    const o = opts(req);
    const r = references(req, 14);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(o.aspect_ratio),
      quality: pick(o, "quality", ["basic", "high", "ultra"]), output_format: "png", nsfw_checker: true };
  },
  // Z-Image: prompt and aspect_ratio.
  "kie-z-image": (req) => ({ prompt: prompt(req), aspect_ratio: pick(opts(req), "aspect_ratio", ["1:1", "4:3", "3:4", "16:9", "9:16"]), nsfw_checker: true }),
  // Grok Imagine (text-to-image returns two images per task; speed mode) and image-to-image (image_urls 1–5).
  "kie-grok-image": (req) => {
    const r = references(req, 5);
    if (r.length) return { prompt: prompt(req), image_urls: r, nsfw_checker: true };
    return { prompt: prompt(req), aspect_ratio: pick(opts(req), "aspect_ratio", ["2:3", "3:2", "1:1", "16:9", "9:16"]), enable_pro: false, nsfw_checker: true };
  },
  // Grok Imagine Image 2.0: aspect_ratio; image_urls (1–5) for image edit, where "auto" follows the input.
  "kie-grok-image-2": (req) => {
    const r = references(req, 5);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(opts(req).aspect_ratio) };
  },
  // Ideogram V3 text-to-image and Remix (image_url = the first reference, one image per task).
  "kie-ideogram-v3": (req) => {
    const o = opts(req);
    const r = references(req, 1);
    return { prompt: prompt(req), ...(r.length ? { image_url: r[0], num_images: "1" } : {}), rendering_speed: mapped(o, "speed", SPEED),
      style: pick(o, "style", ["AUTO", "GENERAL", "REALISTIC", "DESIGN"]), image_size: mapped(o, "aspect_ratio", ASPECT_PRESET_6) };
  },
  // Ideogram Character: one character reference (reference_image_urls), rendering speed, style, image_size.
  "kie-ideogram-character": (req) => {
    const o = opts(req);
    const r = references(req, 1);
    if (!r.length) throw new Error("character reference missing");
    return { prompt: prompt(req), reference_image_urls: r, rendering_speed: mapped(o, "speed", SPEED),
      style: pick(o, "style", ["AUTO", "REALISTIC", "FICTION"]), image_size: mapped(o, "aspect_ratio", ASPECT_PRESET_6), num_images: "1" };
  },
  // Qwen Image 2: image_size is the aspect ratio; image_url (a list of up to 3) for edits; PNG output.
  "kie-qwen-2": (req) => {
    const r = references(req, 3);
    return { prompt: prompt(req), ...(r.length ? { image_url: r } : {}), image_size: String(opts(req).aspect_ratio), output_format: "png", nsfw_checker: true };
  },
  // Qwen Image 2.1: aspect_ratio + resolution 1K/2K; image_urls (1–10) for edits; PNG output.
  "kie-qwen-2-1": (req) => {
    const o = opts(req);
    const r = references(req, 10);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), aspect_ratio: String(o.aspect_ratio),
      resolution: pick(o, "resolution", ["1K", "2K"]), output_format: "png", nsfw_checker: true };
  },
  // Qwen Image 3.0 / 3.0 Pro: resolution 1K/2K, image_size is the aspect ratio; image_urls (1–3) for edits.
  "kie-qwen-3": (req) => {
    const o = opts(req);
    const r = references(req, 3);
    return { prompt: prompt(req), ...(r.length ? { image_urls: r } : {}), resolution: pick(o, "resolution", ["1K", "2K"]),
      image_size: String(o.aspect_ratio), output_format: "png", nsfw_checker: true };
  },
  // Qwen Image (v1) image-to-image: one image_url, PNG output.
  "kie-qwen-image-1": (req) => {
    const r = references(req, 1);
    if (!r.length) throw new Error("reference image missing");
    return { prompt: prompt(req), image_url: r[0], output_format: "png", nsfw_checker: true };
  },
  // Wan 2.7 Image / Image Pro: one image (n = 1); input_urls (up to 9) for edits, where the aspect ratio follows the input.
  "kie-wan-2-7-image": (req) => {
    const o = opts(req);
    const r = references(req, 9);
    return { prompt: prompt(req), ...(r.length ? { input_urls: r } : { aspect_ratio: String(o.aspect_ratio) }),
      resolution: pick(o, "resolution", r.length ? ["1K", "2K"] : ["1K", "2K", "4K"]), n: 1, watermark: false, nsfw_checker: true };
  },
  // Recraft Crisp Upscale and Remove Background: the image only (no prompt, no settings).
  "kie-recraft-image": (req) => {
    const r = references(req, 1);
    if (!r.length) throw new Error("image missing");
    return { image: r[0] };
  },
};

// ---------------------------------------------------------------------------------------------------------- videos

const VIDEO: Record<string, Builder> = {
  // Kling 3.0 Turbo (kling/v3-turbo-text-to-video | -image-to-video): duration "3"–"15", 720p/1080p; audio always on.
  "kie-kling-3-turbo": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    return { prompt: prompt(req), duration: String(int(o, "duration", 3, 15)), resolution: pick(o, "resolution", ["720p", "1080p"]),
      ...(first ? { image_urls: [first] } : { aspect_ratio: pick(o, "aspect_ratio", ["1:1", "9:16", "16:9"]) }) };
  },
  // Kling 3.0 Omni: text (aspect_ratio), start frame or start + end frame (image_urls, aspect auto), reference images
  // (up to 7, no video). audio is a boolean; resolution 720p/1080p/4k; duration 3–15 (integer).
  "kie-kling-3-omni": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images"]);
    const refs = slot(req, "reference_images");
    if (refs.length > 7) throw new Error("too many reference images");
    const base = { prompt: prompt(req), duration: int(o, "duration", 3, 15), resolution: pick(o, "resolution", ["720p", "1080p", "4k"]), audio: onOff(o, "audio") };
    if (first) return { ...base, image_urls: last ? [first, last] : [first], aspect_ratio: "auto" };
    const aspect = pick(o, "aspect_ratio", ["16:9", "9:16", "1:1"]);
    return refs.length ? { ...base, image_urls: refs, aspect_ratio: aspect } : { ...base, aspect_ratio: aspect };
  },
  // Kling 4.0: text or reference images (reference-to-video, image_urls up to 10) and keyframes (keyframe-to-video:
  // first, up to two middle keyframes, last). Four frames at most, within the 3-second cap of 4 frames.
  "kie-kling-4": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    const middle = slot(req, "keyframes");
    const refs = slot(req, "reference_images");
    noFramesWithReferences(req, ["reference_images"]);
    if (middle.length && !first) throw new Error("keyframes need a start frame");
    if (middle.length > 2 || refs.length > 10) throw new Error("too many images");
    const base = { prompt: prompt(req), duration: int(o, "duration", 3, 30), resolution: pick(o, "resolution", ["720p", "1080p"]) };
    if (first) return { ...base, first_frame_url: first, ...(middle.length ? { keyframe_urls: middle } : {}), ...(last ? { last_frame_url: last } : {}) };
    return { ...base, aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "21:9"]), ...(refs.length ? { image_urls: refs } : {}) };
  },
  // Kling 2.6 text / image to video: sound boolean, duration "5" | "10"; aspect only without an image.
  "kie-kling-2-6": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    return { prompt: prompt(req), sound: onOff(o, "audio"), duration: pick(o, "duration", [5, 10]),
      ...(first ? { image_urls: [first] } : { aspect_ratio: pick(o, "aspect_ratio", ["1:1", "16:9", "9:16"]) }) };
  },
  // Kling 2.5 Turbo Pro and 2.1 Master / Pro / Standard: duration "5" | "10"; image_url (+ tail_image_url) to animate.
  "kie-kling-2": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    return { prompt: prompt(req), duration: pick(o, "duration", [5, 10]),
      ...(first ? { image_url: first, ...(last ? { tail_image_url: last } : {}) } : { aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1"]) }) };
  },
  // Kling AI Avatar Standard / Pro: one portrait image and one speech audio; the prompt (required) directs expression.
  "kie-kling-avatar": (req) => {
    const image = one(req, "portrait_image");
    const audio = one(req, "speech_audio");
    if (!image || !audio) throw new Error("portrait image and speech audio are required");
    return { image_url: image, audio_url: audio, prompt: prompt(req) };
  },
  // OmniHuman 1.5: portrait + audio (under 60 s), optional prompt (up to 300 characters), output_resolution 720 | 1080.
  "kie-omnihuman": (req) => {
    const image = one(req, "portrait_image");
    const audio = one(req, "speech_audio");
    if (!image || !audio) throw new Error("portrait image and speech audio are required");
    return { image_url: image, audio_url: audio, ...optionalPrompt(req), output_resolution: mapped(opts(req), "resolution", { "720p": "720", "1080p": "1080" }) };
  },
  // Seedance 2.0 / 2.0 Mini: like the 2.x builder, plus reference videos (billed on reference + output seconds).
  "kie-seedance-2-v3": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images", "reference_videos", "reference_audio"]);
    const images = slot(req, "reference_images");
    const videos = slot(req, "reference_videos");
    const audio = slot(req, "reference_audio");
    return {
      prompt: prompt(req), resolution: pick(o, "resolution", ["480p", "720p", "1080p", "4k"]), generate_audio: onOff(o, "audio"),
      duration: int(o, "duration", 4, 15), aspect_ratio: pick(o, "aspect_ratio", ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"]),
      ...(first ? { first_frame_url: first, ...(last ? { last_frame_url: last } : {}) } : {}),
      ...(images.length ? { reference_image_urls: images } : {}),
      ...(videos.length ? { reference_video_urls: videos } : {}),
      ...(audio.length ? { reference_audio_urls: audio } : {}),
      nsfw_checker: true,
    };
  },
  // Seedance 1.0 Pro / Lite / Pro Fast: duration "5" | "10"; image_url (+ end_image_url on Lite) to animate.
  "kie-seedance-1": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    return { prompt: prompt(req), resolution: pick(o, "resolution", ["480p", "720p", "1080p"]), duration: pick(o, "duration", [5, 10]),
      ...(first ? { image_url: first, ...(last ? { end_image_url: last } : {}) } : { aspect_ratio: String(o.aspect_ratio) }), nsfw_checker: true };
  },
  // Hailuo 02 / 2.3: image_url (+ end_image_url on 02); duration "6" | "10" where the model has it. Only the
  // image-to-video endpoints take a resolution (Hailuo 02 Standard text-to-video is always 768P, Pro always 1080P).
  "kie-hailuo": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    return { prompt: prompt(req), ...(first ? { image_url: first, ...(last ? { end_image_url: last } : {}) } : {}),
      ...(o.duration !== undefined ? { duration: pick(o, "duration", [6, 10]) } : {}),
      ...(first && o.resolution !== undefined ? { resolution: pick(o, "resolution", ["512P", "768P", "1080P"]) } : {}), nsfw_checker: true };
  },
  // MiniMax H3: text (aspect required), first/last frame, or references (up to 5 images, 3 videos, 3 audios; audio
  // only with an image or video). Audio is always generated.
  "kie-minimax-h3": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images", "reference_videos", "reference_audio"]);
    const images = slot(req, "reference_images");
    const videos = slot(req, "reference_videos");
    const audio = slot(req, "reference_audio");
    if (audio.length && !images.length && !videos.length) throw new Error("reference audio needs an image or a video");
    const base = { prompt: prompt(req), duration: int(o, "duration", 4, 15), resolution: pick(o, "resolution", ["768P", "2K"]) };
    if (first) return { ...base, first_frame_url: first, ...(last ? { last_frame_url: last } : {}) };
    if (images.length || videos.length) {
      return { ...base, aspect_ratio: pick(o, "aspect_ratio", ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]),
        ...(images.length ? { reference_image_urls: images } : {}), ...(videos.length ? { reference_video_urls: videos } : {}),
        ...(audio.length ? { reference_audio_urls: audio } : {}) };
    }
    return { ...base, aspect_ratio: pick(o, "aspect_ratio", ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]) };
  },
  // Wan 2.5: duration "5" | "10", resolution; image_url to animate (aspect only for text).
  "kie-wan-2-5": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    return { prompt: prompt(req), duration: pick(o, "duration", [5, 10]), resolution: pick(o, "resolution", ["720p", "1080p"]),
      ...(first ? { image_url: first } : { aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1"]) }), nsfw_checker: true };
  },
  // Wan 2.6 text / image (image_urls) / reference videos (video_urls, up to 3, 5 or 10 s output); single shot.
  "kie-wan-2-6-v2": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const videos = slot(req, "reference_videos");
    if (first && videos.length) throw new Error("a start frame and reference videos cannot be combined");
    const duration = pick(o, "duration", videos.length ? [5, 10] : [5, 10, 15]);
    return { prompt: prompt(req), duration, resolution: pick(o, "resolution", ["720p", "1080p"]),
      ...(first ? { image_urls: [first] } : {}), ...(videos.length ? { video_urls: videos } : {}), multi_shots: false, nsfw_checker: true };
  },
  // Wan 2.6 Flash: image (image_urls, 5/10/15 s) or reference videos (video_urls, 5/10 s); audio is a priced choice.
  "kie-wan-2-6-flash": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const videos = slot(req, "reference_videos");
    if (!!first === !!videos.length) throw new Error("use a start frame or reference videos");
    return { prompt: prompt(req), duration: pick(o, "duration", videos.length ? [5, 10] : [5, 10, 15]),
      resolution: pick(o, "resolution", ["720p", "1080p"]), audio: onOff(o, "audio"),
      ...(first ? { image_urls: [first] } : { video_urls: videos }), multi_shots: false, nsfw_checker: true };
  },
  // Wan 2.7: text (ratio), first (+ last) frame, or reference images (reference_image, up to 5; 2–10 s).
  "kie-wan-2-7": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images"]);
    const refs = slot(req, "reference_images");
    const base = { prompt: prompt(req), resolution: pick(o, "resolution", ["720p", "1080p"]), watermark: false, nsfw_checker: true };
    if (first) return { ...base, duration: int(o, "duration", 2, 15), first_frame_url: first, ...(last ? { last_frame_url: last } : {}) };
    const aspect = pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "4:3", "3:4"]);
    if (refs.length) return { ...base, duration: int(o, "duration", 2, 10), reference_image: refs, aspect_ratio: aspect };
    return { ...base, duration: int(o, "duration", 2, 15), ratio: aspect };
  },
  // Wan 2.7 Video Edit: the whole source clip (duration 0), optional reference image, audio auto | keep original.
  "kie-wan-2-7-edit": (req) => {
    const o = opts(req);
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    const ref = one(req, "reference_image");
    return { prompt: prompt(req), video_url: source[0], ...(ref ? { reference_image: ref } : {}), resolution: pick(o, "resolution", ["720p", "1080p"]),
      duration: 0, audio_setting: pick(o, "audio_setting", ["auto", "origin"]), watermark: false, nsfw_checker: true };
  },
  // Wan 3.0 / 3.0 Prime: first (+ last) frame, or references (images, videos, audio); billed on output + reference video seconds.
  "kie-wan-3": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images", "reference_videos", "reference_audio"]);
    const images = slot(req, "reference_images");
    const videos = slot(req, "reference_videos");
    const audio = slot(req, "reference_audio");
    return {
      prompt: prompt(req), resolution: pick(o, "resolution", ["480P", "720P", "1080P"]), aspect_ratio: pick(o, "aspect_ratio", ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
      duration: int(o, "duration", 2, 30), audio: onOff(o, "audio"),
      ...(first ? { first_frame_url: first, ...(last ? { last_frame_url: last } : {}) } : {}),
      ...(images.length ? { reference_image_urls: images } : {}), ...(videos.length ? { reference_video_urls: videos } : {}),
      ...(audio.length ? { reference_audio_urls: audio } : {}), nsfw_checker: true,
    };
  },
  // PixVerse V6: text (aspect), image (first frame), transition (first + last), fusion references (up to 7 subjects
  // named ref1…ref7 for "@ref1" in the prompt); quality 360p–1080p, duration 1–15, audio switch.
  "kie-pixverse-6": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images"]);
    const refs = slot(req, "reference_images");
    if (refs.length > 7) throw new Error("too many reference images");
    const base = { prompt: prompt(req), quality: pick(o, "resolution", ["360p", "540p", "720p", "1080p"]), duration: int(o, "duration", 1, 15),
      generate_audio_switch: onOff(o, "audio") };
    const aspect = () => pick(o, "aspect_ratio", ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"]);
    if (first && last) return { ...base, first_frame_image_url: first, last_frame_image_url: last };
    if (first) return { ...base, image_urls: [first] };
    if (refs.length) return { ...base, aspect_ratio: aspect(), image_references: refs.map((url, i) => ({ image_url: url, type: "subject", ref_name: `ref${i + 1}` })) };
    return { ...base, aspect_ratio: aspect(), generate_multi_clip_switch: false };
  },
  // PixVerse V6 Extend: a source clip (video_url) continued by the prompt; seed is required.
  "kie-pixverse-extend": (req) => {
    const o = opts(req);
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    return { prompt: prompt(req), video_url: source[0], duration: int(o, "duration", 1, 15), quality: pick(o, "resolution", ["360p", "540p", "720p", "1080p"]),
      generate_audio_switch: onOff(o, "audio"), seed: seedOf(req) };
  },
  // Grok Imagine video: text (aspect, numeric duration) or images (image_urls 1–7, string duration; aspect only with
  // several images); mode normal | fun (spicy is not offered); audio is always generated.
  "kie-grok-video": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const refs = slot(req, "reference_images");
    if (first && refs.length) throw new Error("a start frame and reference images cannot be combined");
    const base = { prompt: prompt(req), mode: pick(o, "style", ["normal", "fun"]), resolution: pick(o, "resolution", ["480p", "720p", "1080p"]) };
    const duration = int(o, "duration", 6, 30);
    if (first) return { ...base, image_urls: [first], duration: String(duration) };
    if (refs.length) {
      if (refs.length < 2 || refs.length > 7) throw new Error("use 2 to 7 reference images");
      if (base.resolution === "1080p") throw new Error("several images are not supported at 1080p");
      return { ...base, image_urls: refs, duration: String(duration), aspect_ratio: pick(o, "aspect_ratio", ["2:3", "3:2", "1:1", "16:9", "9:16"]) };
    }
    return { ...base, duration, aspect_ratio: pick(o, "aspect_ratio", ["2:3", "3:2", "1:1", "16:9", "9:16"]), nsfw_checker: true };
  },
  // Grok Imagine Video 1.5 Preview: one image (image_urls, required), 480p/720p, 1–15 s.
  "kie-grok-video-1-5": (req) => {
    const o = opts(req);
    const image = one(req, "first_frame");
    if (!image) throw new Error("image missing");
    return { prompt: prompt(req), image_urls: [image], resolution: pick(o, "resolution", ["480p", "720p"]), duration: int(o, "duration", 1, 15), nsfw_checker: true };
  },
  // Runway: 5 or 10 s at 720p, 5 s at 1080p; image_url to animate (aspect only for text).
  "kie-runway": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const duration = Number(pick(o, "duration", [5, 10]));
    const quality = pick(o, "resolution", ["720p", "1080p"]);
    if (quality === "1080p" && duration === 10) throw new Error("10-second clips are 720p only");
    return { prompt: prompt(req), duration, quality, ...(first ? { image_url: first } : { aspect_ratio: pick(o, "aspect_ratio", ["16:9", "4:3", "1:1", "3:4", "9:16"]) }) };
  },
  // Runway Extend: the earlier Runway task id, the prompt and the quality.
  "kie-runway-extend": (req) => {
    const task = req.sourceTasks?.source_job?.[0];
    if (!task) throw new Error("source task missing");
    return { task_id: task, prompt: prompt(req), quality: pick(opts(req), "resolution", ["720p", "1080p"]) };
  },
  // HappyHorse 1.0 / 1.1: text (aspect), first frame (image_urls) or reference images (reference_image, 1–9); 3–15 s.
  "kie-happyhorse": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const refs = slot(req, "reference_images");
    if (first && refs.length) throw new Error("a start frame and reference images cannot be combined");
    const base = { resolution: pick(o, "resolution", ["720p", "1080p"]), duration: int(o, "duration", 3, 15) };
    if (first) return { ...optionalPrompt(req), ...base, image_urls: [first] };
    return { prompt: prompt(req), ...base, aspect_ratio: String(o.aspect_ratio), ...(refs.length ? { reference_image: refs } : {}) };
  },
  // HappyHorse 1.0 Video Edit: source clip (video_url), optional reference images (up to 5), audio auto | keep original.
  "kie-happyhorse-edit": (req) => {
    const o = opts(req);
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    const refs = slot(req, "reference_images");
    return { prompt: prompt(req), video_url: source[0], ...(refs.length ? { reference_image: refs } : {}), resolution: pick(o, "resolution", ["720p", "1080p"]),
      audio_setting: pick(o, "audio_setting", ["auto", "origin"]) };
  },
  // Gemini Omni Video / Omni Flash 1.1: duration "4"–"10", aspect, resolution; reference images (image_urls, up to 7)
  // or, on Flash 1.1, first (+ last) frame. No video, audio or character inputs.
  "kie-gemini-omni": (req) => {
    const o = opts(req);
    const { first, last } = frames(req);
    noFramesWithReferences(req, ["reference_images"]);
    const refs = slot(req, "reference_images");
    if (refs.length > 7) throw new Error("too many reference images");
    return { prompt: prompt(req), duration: pick(o, "duration", [4, 6, 8, 10]), aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16"]),
      resolution: pick(o, "resolution", ["360p", "720p", "1080p", "4k"]),
      ...(first ? { first_frame_url: first, ...(last ? { last_frame_url: last } : {}) } : {}), ...(refs.length ? { image_urls: refs } : {}) };
  },
  // Vidu Q4: first frame (image_url) or reference images (1–15, with up to 3 MP3 voice clips); audio boolean; 3–16 s.
  "kie-vidu-q4": (req) => {
    const o = opts(req);
    const first = one(req, "first_frame");
    const refs = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    if (first && (refs.length || audio.length)) throw new Error("a start frame and references cannot be combined");
    const base = { duration: int(o, "duration", 3, 16), resolution: pick(o, "resolution", ["540p", "720p", "1080p", "2k", "4k"]), audio: onOff(o, "audio") };
    if (first) return { ...optionalPrompt(req), ...base, image_url: first };
    if (!refs.length) throw new Error("reference images missing");
    return { prompt: prompt(req), ...base, reference_image_urls: refs, ...(audio.length ? { reference_audio_urls: audio } : {}),
      aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "4:3", "3:4"]) };
  },
  // Topaz Video Upscale: the source clip and the factor ("1", "2" or "4").
  "kie-topaz-video": (req) => {
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    return { video_url: source[0], upscale_factor: pick(opts(req), "factor", ["1", "2", "4"]) };
  },
  // Wan 2.2 Animate Move / Replace: the character image and the driving video; resolution per model.
  "kie-wan-animate": (req) => {
    const character = one(req, "character_image");
    const motion = one(req, "motion_video");
    if (!character || !motion) throw new Error("character image and motion video are required");
    return { video_url: motion, image_url: character, resolution: pick(opts(req), "resolution", ["480p", "580p", "720p"]), nsfw_checker: true };
  },
};

export const CATALOG_ADAPTERS: Record<string, Builder> = { ...IMAGE, ...VIDEO };
