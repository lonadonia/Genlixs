import { upstreamFor } from "./model-id";
import { onOff } from "./http";
import type { RoutedSubmit } from "./types";

/**
 * APIMart request builders for the full catalog (docs.apimart.ai model pages, read 22 Oct 2026). Every model uses the
 * same task API (POST /v1/videos/generations or /v1/images/generations, polled at /v1/tasks/{id}); field names differ
 * per model family, so each family has its own builder. The offers' capabilities keep every request inside what the
 * page documents (for example PixVerse transitions and Seedream edits stay on KIE); a builder still refuses anything else.
 */
type Built = { path: string; body: Record<string, unknown> };
type Options = Record<string, string | number>;

const slot = (req: RoutedSubmit, name: string) => req.inputUrls?.[name] ?? [];
const one = (req: RoutedSubmit, name: string) => slot(req, name)[0];

function pick(o: Options, key: string, allowed: readonly (string | number)[]): string {
  const v = o[key];
  if (v === undefined || !allowed.map(String).includes(String(v))) throw new Error(`unsupported ${key}`);
  return String(v);
}
function int(o: Options, key: string, min: number, max: number): number {
  const n = Number(o[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`unsupported ${key}`);
  return n;
}
const prompt = (req: RoutedSubmit) => {
  const p = req.context.job.prompt.trim();
  return p ? { prompt: p } : {};
};
function noFramesWithReferences(req: RoutedSubmit, refSlots: string[]) {
  if ((one(req, "first_frame") || one(req, "last_frame")) && refSlots.some((s) => slot(req, s).length)) throw new Error("frames and references cannot be combined");
  if (one(req, "last_frame") && !one(req, "first_frame")) throw new Error("end frame without start frame");
}
const upper = (v: string) => v.toUpperCase();

/** Wan 2.6 (text; sound and frame shape left at the model's defaults, as on the KIE route), 2.6 Flash (start frame), 2.7 (text, frames), 2.7-R2V (reference images), 2.7 Video Edit, 3.0 / 3.0 Prime. */
function wan(req: RoutedSubmit, model: string, o: Options): Built {
  const path = "/v1/videos/generations";
  const first = one(req, "first_frame");
  const last = one(req, "last_frame");
  if (model === "wan2.6") {
    if (first || slot(req, "reference_videos").length) throw new Error("this route takes text only");
    return { path, body: { model, ...prompt(req), resolution: pick(o, "resolution", ["720p", "1080p"]), duration: Number(pick(o, "duration", [5, 10, 15])),
      watermark: false } };
  }
  if (model === "wan2.6-i2v-flash") {
    if (!first) throw new Error("start frame missing");
    return { path, body: { model, ...prompt(req), image_urls: [first], resolution: pick(o, "resolution", ["720p", "1080p"]), duration: int(o, "duration", 2, 15),
      audio: onOff(o.audio), watermark: false } };
  }
  if (model === "wan2.7") {
    noFramesWithReferences(req, ["reference_images"]);
    const frames = first ? [{ url: first, role: "first_frame" }, ...(last ? [{ url: last, role: "last_frame" }] : [])] : [];
    return { path, body: { model, ...prompt(req), resolution: upper(pick(o, "resolution", ["720p", "1080p"])), duration: int(o, "duration", 2, 15),
      ...(frames.length ? { image_with_roles: frames } : { size: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "4:3", "3:4"]) }), watermark: false } };
  }
  if (model === "wan2.7-r2v") {
    const refs = slot(req, "reference_images");
    if (!refs.length || refs.length > 5 || first) throw new Error("use 1 to 5 reference images");
    return { path, body: { model, ...prompt(req), image_with_roles: refs.map((url) => ({ url, role: "reference_image" })), resolution: upper(pick(o, "resolution", ["720p", "1080p"])),
      duration: int(o, "duration", 2, 10), size: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "4:3", "3:4"]), watermark: false } };
  }
  if (model === "wan2.7-videoedit") {
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    const ref = one(req, "reference_image");
    return { path, body: { model, ...prompt(req), video_urls: source, ...(ref ? { image_urls: [ref] } : {}), resolution: upper(pick(o, "resolution", ["720p", "1080p"])),
      duration: 0, metadata: { audio_setting: pick(o, "audio_setting", ["auto", "origin"]) }, watermark: false } };
  }
  if (model === "wan3.0-video" || model === "wan3.0-video-prime") {
    noFramesWithReferences(req, ["reference_images", "reference_videos", "reference_audio"]);
    const images = slot(req, "reference_images");
    const videos = slot(req, "reference_videos");
    const audio = slot(req, "reference_audio");
    const roles = first
      ? [{ url: first, role: "first_frame" }, ...(last ? [{ url: last, role: "last_frame" }] : [])]
      : images.map((url) => ({ url, role: "reference_image" }));
    const reference = !first && (images.length || videos.length || audio.length);
    return { path, body: { model, ...prompt(req), resolution: pick(o, "resolution", ["480P", "720P", "1080P"]),
      size: pick(o, "aspect_ratio", ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]), duration: int(o, "duration", 2, 30), audio: onOff(o.audio),
      ...(roles.length ? { image_with_roles: roles } : {}), ...(videos.length ? { video_urls: videos } : {}), ...(audio.length ? { audio_urls: audio } : {}),
      ...(reference ? { generation_type: "reference" } : first ? { generation_type: "frame" } : {}), watermark: false } };
  }
  throw new Error(`no APIMart Wan request for ${model}`);
}

/** PixVerse V6: text (size), image-to-video (image_urls), multi-reference fusion (img_references). Transitions stay on KIE. */
function pixverse(req: RoutedSubmit, model: string, o: Options): Built {
  const first = one(req, "first_frame");
  const refs = slot(req, "reference_images");
  if (one(req, "last_frame")) throw new Error("transitions are not sent to this route");
  if (first && refs.length) throw new Error("a start frame and reference images cannot be combined");
  if (refs.length > 7) throw new Error("too many reference images");
  const size = () => pick(o, "aspect_ratio", ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2"]);
  return { path: "/v1/videos/generations", body: { model, prompt: req.context.job.prompt, resolution: pick(o, "resolution", ["360p", "540p", "720p", "1080p"]),
    duration: int(o, "duration", 1, 15), audio: onOff(o.audio), motion_mode: "normal", watermark: false,
    ...(first ? { image_urls: [first], generate_multi_clip_switch: false } : refs.length ? { img_references: refs, size: size() } : { size: size(), generate_multi_clip_switch: false }) } };
}

/** HappyHorse 1.0: text, first frame (first_frame_image), references (image_urls 1–9) or video edit (video_url, up to 5 images). */
function happyhorse(req: RoutedSubmit, model: string, o: Options): Built {
  const path = "/v1/videos/generations";
  const resolution = upper(pick(o, "resolution", ["720p", "1080p"]));
  const source = slot(req, "source_video");
  if (source.length) {
    if (source.length !== 1) throw new Error("one source video");
    const refs = slot(req, "reference_images");
    if (refs.length > 5) throw new Error("too many reference images");
    return { path, body: { model, prompt: req.context.job.prompt, video_url: source[0], ...(refs.length ? { image_urls: refs } : {}), resolution,
      audio_setting: pick(o, "audio_setting", ["auto", "origin"]), watermark: false } };
  }
  const first = one(req, "first_frame");
  const refs = slot(req, "reference_images");
  if (first && refs.length) throw new Error("a start frame and reference images cannot be combined");
  if (refs.length > 9) throw new Error("too many reference images");
  const duration = int(o, "duration", 3, 15);
  if (first) return { path, body: { model, ...prompt(req), first_frame_image: first, resolution, duration, watermark: false } };
  return { path, body: { model, prompt: req.context.job.prompt, ...(refs.length ? { image_urls: refs } : {}), resolution, duration,
    size: pick(o, "aspect_ratio", ["16:9", "9:16", "1:1", "4:3", "3:4"]), watermark: false } };
}

/** Seedream 4.5 / 5.0 Pro set quality tiers through `resolution`; Seedream 4.0 and Qwen Image 3.0 take the resolution itself. */
const QUALITY: Record<string, Record<string, string>> = {
  "seedream-4.5": { basic: "2K", high: "4K" },
  "seedream-5-0-pro": { basic: "1K", high: "2K" },
};
const RESOLUTIONS: Record<string, string[]> = {
  "seedream-4.0": ["1K", "2K", "4K"],
  "qwen-image-3.0": ["1K", "2K"],
  "qwen-image-3.0-pro": ["1K", "2K"],
};

const KLEIN_RATIOS = ["auto", "21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16", "9:21"];

/**
 * Text-to-image of the catalog's Seedream and Qwen models (their edits stay on KIE: input charges are not published and
 * the Seedream pages accept JPEG/PNG only). FLUX 3 Klein also edits: references cost nothing extra on that page.
 */
function image(req: RoutedSubmit, model: string, o: Options): Built {
  if (model === "flux-3-image-klein") {
    const refs = req.context.job.tool === "edit" ? req.referenceUrls : [];
    if (req.context.job.tool === "edit" && (refs.length < 1 || refs.length > 10)) throw new Error("use 1 to 10 reference images");
    if (req.context.job.tool !== "edit" && req.referenceUrls.length) throw new Error("text-to-image takes no reference images");
    const ratio = pick(o, "aspect_ratio", KLEIN_RATIOS);
    if (ratio === "auto" && !refs.length) throw new Error("automatic ratio needs a reference image");
    return { path: "/v1/images/generations", body: { model, prompt: req.context.job.prompt, aspect_ratio: ratio,
      resolution: pick(o, "resolution", ["1K", "2K", "4K"]).toLowerCase(), n: 1, ...(refs.length ? { image_urls: refs } : {}) } };
  }
  if (req.context.job.tool !== "image" || req.referenceUrls.length) throw new Error("this route takes text-to-image only");
  const quality = QUALITY[model];
  const resolution = quality ? quality[String(o.quality)] : RESOLUTIONS[model]?.includes(String(o.resolution)) ? String(o.resolution) : undefined;
  if (!resolution) throw new Error("unsupported resolution");
  return { path: "/v1/images/generations", body: { model, prompt: req.context.job.prompt, size: String(o.aspect_ratio), resolution, n: 1 } };
}

const BUILDERS: Record<string, (req: RoutedSubmit, model: string, o: Options) => Built> = {
  "apimart-wan": wan,
  "apimart-pixverse": pixverse,
  "apimart-happyhorse": happyhorse,
  "apimart-image-v2": image,
};

export const APIMART_CATALOG_ADAPTERS = Object.keys(BUILDERS);

/** The request for one of the catalog adapters, or null when the route uses one of the original builders. */
export function buildApimartCatalog(req: RoutedSubmit): Built | null {
  const build = BUILDERS[req.route.adapter];
  if (!build) return null;
  return build(req, upstreamFor(req.route.upstreamModelId, req.context.job.mode), req.context.job.options);
}
