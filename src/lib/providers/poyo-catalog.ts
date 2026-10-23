import { upstreamFor } from "./model-id";
import type { RoutedSubmit } from "./types";

/**
 * PoYo request builders for the full catalog (poyo.ai/models/<page>/llms.txt, read 22 Oct 2026). Same envelope as every
 * PoYo model: {model, input} posted to /api/generate/submit. The public model id differs per workflow (Wan 2.7) or is
 * one id whose workflow follows the fields sent (HappyHorse, Gemini Omni). The offers' capabilities keep requests inside
 * what each page documents; a builder still refuses anything else.
 */
type Built = { path: string; body: Record<string, unknown> };
type Options = Record<string, string | number>;

const PATH = "/api/generate/submit";
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
function frames(req: RoutedSubmit, refSlots: string[]): string[] {
  const first = one(req, "first_frame");
  const last = one(req, "last_frame");
  if (last && !first) throw new Error("end frame without start frame");
  if (first && refSlots.some((s) => slot(req, s).length)) throw new Error("frames and references cannot be combined");
  return first ? [first, ...(last ? [last] : [])] : [];
}
const AR5 = ["16:9", "9:16", "1:1", "4:3", "3:4"];

/** Wan 2.7: text (5/10/15 s), start/end frames (2–15 s), reference images (2–10 s) and video edit (source length). */
function wan27(req: RoutedSubmit, model: string, o: Options): Built {
  const resolution = pick(o, "resolution", ["720p", "1080p"]);
  if (model === "wan2.7-edit-video") {
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    const ref = one(req, "reference_image");
    return { path: PATH, body: { model, input: { ...prompt(req), video_url: source[0], ...(ref ? { reference_image_url: ref } : {}), resolution, duration: 0,
      audio_setting: pick(o, "audio_setting", ["auto", "origin"]) } } };
  }
  const images = frames(req, ["reference_images"]);
  const refs = slot(req, "reference_images");
  if (model === "wan2.7-image-to-video") {
    if (!images.length) throw new Error("start frame missing");
    return { path: PATH, body: { model, input: { ...prompt(req), image_urls: images, resolution, duration: int(o, "duration", 2, 15) } } };
  }
  if (model === "wan2.7-reference-to-video") {
    if (!refs.length || refs.length > 5) throw new Error("use 1 to 5 reference images");
    return { path: PATH, body: { model, input: { prompt: req.context.job.prompt, reference_image_urls: refs, aspect_ratio: pick(o, "aspect_ratio", AR5),
      resolution, duration: int(o, "duration", 2, 10) } } };
  }
  if (model === "wan2.7-text-to-video") {
    if (images.length || refs.length) throw new Error("this route takes text only");
    return { path: PATH, body: { model, input: { prompt: req.context.job.prompt, aspect_ratio: pick(o, "aspect_ratio", AR5), resolution,
      duration: Number(pick(o, "duration", [5, 10, 15])) } } };
  }
  throw new Error(`no PoYo Wan 2.7 request for ${model}`);
}

/** HappyHorse: text, one start frame, 1–9 character images, or a video edit with up to 5 images (output follows the source). */
function happyhorse(req: RoutedSubmit, model: string, o: Options): Built {
  const resolution = pick(o, "resolution", ["720p", "1080p"]);
  const refs = slot(req, "reference_images");
  const source = slot(req, "source_video");
  if (source.length) {
    if (source.length !== 1) throw new Error("one source video");
    if (refs.length > 5) throw new Error("too many reference images");
    return { path: PATH, body: { model, input: { prompt: req.context.job.prompt, video_url: source[0], ...(refs.length ? { reference_image_urls: refs } : {}),
      resolution, audio_setting: pick(o, "audio_setting", ["auto", "origin"]) } } };
  }
  const first = one(req, "first_frame");
  if (first && refs.length) throw new Error("a start frame and reference images cannot be combined");
  if (refs.length > 9) throw new Error("too many reference images");
  const duration = int(o, "duration", 3, 15);
  if (first) return { path: PATH, body: { model, input: { ...prompt(req), image_urls: [first], resolution, duration } } };
  return { path: PATH, body: { model, input: { prompt: req.context.job.prompt, ...(refs.length ? { reference_image_urls: refs } : {}),
    aspect_ratio: pick(o, "aspect_ratio", AR5), resolution, duration } } };
}

/** Gemini Omni 1.1 Flash: text, first/last frame (image_urls) or up to 7 reference images; no video input on this route. */
function geminiOmni(req: RoutedSubmit, model: string, o: Options): Built {
  const images = frames(req, ["reference_images"]);
  const refs = slot(req, "reference_images");
  if (refs.length > 7) throw new Error("too many reference images");
  return { path: PATH, body: { model, input: { prompt: req.context.job.prompt, ...(images.length ? { image_urls: images } : {}),
    ...(refs.length ? { reference_image_urls: refs } : {}), resolution: pick(o, "resolution", ["360p", "720p", "1080p", "4k"]),
    duration: Number(pick(o, "duration", [4, 6, 8, 10])), aspect_ratio: pick(o, "aspect_ratio", ["16:9", "9:16"]) } } };
}

const BUILDERS: Record<string, (req: RoutedSubmit, model: string, o: Options) => Built> = {
  "poyo-wan-2-7": wan27,
  "poyo-happyhorse": happyhorse,
  "poyo-gemini-omni": geminiOmni,
};

export const POYO_CATALOG_ADAPTERS = Object.keys(BUILDERS);

/** The request for one of the catalog adapters, or null when the route uses one of the original builders. */
export function buildPoyoCatalog(req: RoutedSubmit): Built | null {
  const build = BUILDERS[req.route.adapter];
  if (!build) return null;
  return build(req, upstreamFor(req.route.upstreamModelId, req.context.job.mode), req.context.job.options);
}
