import type { SubmitRequest } from "../types";
import { CATALOG_ADAPTERS } from "./catalog-adapters";

/**
 * Per-adapter input builders (guide §12.2–12.3). The provider model id comes from the catalog row persisted with
 * the job; options were validated and frozen by the quote, so only documented fields are forwarded here.
 * A job keeps its adapter version: a new adapter shape must get a new adapter name, never an in-place change.
 * Field names and enums follow docs.kie.ai (checked 14 Oct 2026). Where a model offers `nsfw_checker`, it is sent
 * as true so the supplier's additional content filtering applies (Genlixs acceptable-use policy).
 */
type Input = Record<string, unknown>;
type Options = Record<string, string | number>;

const pick = (opts: Options, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => opts[k] !== undefined && opts[k] !== null && opts[k] !== "").map((k) => [k, opts[k]]));

/** Maps a frozen option value through a fixed table; an unmapped value is a configuration error, never a guess. */
function mapped(opts: Options, key: string, table: Record<string, string>): string {
  const v = table[String(opts[key])];
  if (v === undefined) throw new Error(`unsupported ${key}`);
  return v;
}

/** Edit tools must carry their reference image; text tools never send one. */
function refs(req: SubmitRequest): string[] {
  if (req.context.job.tool === "edit" && req.referenceUrls.length < 1) throw new Error("reference image missing");
  return req.context.job.tool === "edit" ? req.referenceUrls : [];
}

const onOff = (opts: Options, key: string) => {
  if (opts[key] !== "on" && opts[key] !== "off") throw new Error(`unsupported ${key}`);
  return opts[key] === "on";
};

const ADAPTERS: Record<string, (req: SubmitRequest) => Input> = {
  // GPT Image 2.5 Flare / Sunburst text-to-image (same request shape for both).
  "kie-market-image": ({ context }) => ({
    prompt: context.job.prompt,
    ...pick(context.job.options, ["aspect_ratio", "resolution"]),
  }),
  // GPT Image 2.5 Flare / Sunburst image-to-image: input_urls (up to 16; one offered).
  "kie-market-image-edit": ({ context, referenceUrls }) => {
    if (referenceUrls.length < 1) throw new Error("reference image missing");
    return {
      prompt: context.job.prompt,
      input_urls: referenceUrls,
      ...pick(context.job.options, ["aspect_ratio", "resolution"]),
    };
  },
  // Veo 3.1: input.model is the tier (from the catalog option); resolution is chosen at generation time (720p | 1080p | 4k).
  "kie-market-veo": ({ context }) => {
    const o = context.job.options;
    return {
      prompt: context.job.prompt,
      generation_type: "TEXT_2_VIDEO",
      ...(o.variant ? { model: String(o.variant) } : {}),
      ...pick(o, ["aspect_ratio", "resolution"]),
      // Documented as an integer enum (4, 6, 8).
      ...(o.duration !== undefined ? { duration: Number(o.duration) } : {}),
    };
  },
  // Nano Banana 2 / Pro: image_input carries references; output_format must be explicit for Pro.
  "kie-nano-banana": (req) => {
    const r = refs(req);
    return {
      prompt: req.context.job.prompt,
      ...(r.length ? { image_input: r } : {}),
      ...pick(req.context.job.options, ["aspect_ratio", "resolution"]),
      output_format: "png",
    };
  },
  // FLUX.2 Pro: aspect_ratio and resolution are required; input_urls (1–8) for image-to-image.
  "kie-flux-2": (req) => {
    const r = refs(req);
    const o = req.context.job.options;
    return {
      prompt: req.context.job.prompt,
      ...(r.length ? { input_urls: r } : {}),
      aspect_ratio: String(o.aspect_ratio),
      resolution: mapped(o, "resolution", { "1K": "1K", "2K": "2K" }),
      nsfw_checker: true,
    };
  },
  // Seedream 5.0: the size field takes the "resolution" option; image_urls for image-to-image.
  "kie-seedream-5": (req) => {
    const r = refs(req);
    const o = req.context.job.options;
    return {
      prompt: req.context.job.prompt,
      ...(r.length ? { image_urls: r } : {}),
      aspect_ratio: String(o.aspect_ratio),
      size: mapped(o, "resolution", { "1K": "1K", "1.5K": "1.5K", "2K": "2K" }),
      output_format: "png",
      nsfw_checker: true,
    };
  },
  // Kling 3.0 single-shot: mode std = 720p, pro = 1080p, 4K = 4K; sound is required; duration is a string.
  "kie-kling-3": ({ context }) => {
    const o = context.job.options;
    return {
      prompt: context.job.prompt,
      mode: mapped(o, "resolution", { "720p": "std", "1080p": "pro", "4K": "4K" }),
      sound: onOff(o, "audio"),
      duration: mapped(o, "duration", { "5": "5", "10": "10", "15": "15" }),
      aspect_ratio: String(o.aspect_ratio),
      multi_shots: false,
    };
  },
  // Seedance 2.5 / 2.0 Fast text-to-video: integer duration, generate_audio boolean; no reference media sent.
  "kie-seedance-2": ({ context }) => {
    const o = context.job.options;
    return {
      prompt: context.job.prompt,
      resolution: String(o.resolution),
      generate_audio: onOff(o, "audio"),
      duration: Number(o.duration),
      aspect_ratio: String(o.aspect_ratio),
      nsfw_checker: true,
    };
  },
  // Wan 2.6 text-to-video: duration "5" | "10" | "15", resolution 720p | 1080p; no aspect-ratio field exists.
  "kie-wan-2-6": ({ context }) => {
    const o = context.job.options;
    return {
      prompt: context.job.prompt,
      duration: mapped(o, "duration", { "5": "5", "10": "10", "15": "15" }),
      resolution: mapped(o, "resolution", { "720p": "720p", "1080p": "1080p" }),
      multi_shots: false,
      nsfw_checker: true,
    };
  },

  // ---- typed inputs (checked 15 Oct 2026). The quote already validated slots and combinations; these builders
  // still refuse an impossible combination so a malformed job can never reach the provider.

  // Veo 3.1: TEXT_2_VIDEO, FIRST_AND_LAST_FRAMES_2_VIDEO (1 image = start, 2 = start + end) or REFERENCE_2_VIDEO (1–3).
  "kie-veo-3-1": (req) => {
    const o = req.context.job.options;
    const first = slot(req, "first_frame");
    const last = slot(req, "last_frame");
    const refsIn = slot(req, "reference_images");
    if (last.length && !first.length) throw new Error("end frame without start frame");
    if (refsIn.length && first.length) throw new Error("frames and reference images cannot be combined");
    const base = {
      prompt: req.context.job.prompt,
      ...(o.variant ? { model: String(o.variant) } : {}),
      ...pick(o, ["aspect_ratio", "resolution"]),
      ...(o.duration !== undefined ? { duration: Number(o.duration) } : {}),
    };
    if (refsIn.length) {
      if (refsIn.length > 3) throw new Error("too many reference images");
      return { ...base, generation_type: "REFERENCE_2_VIDEO", image_urls: refsIn };
    }
    if (first.length) return { ...base, generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO", image_urls: [...first.slice(0, 1), ...last.slice(0, 1)] };
    return { ...base, generation_type: "TEXT_2_VIDEO" };
  },
  // Kling 3.0: image_urls = [start] or [start, end]; up to three elements of 2–4 images, named element1..3 so the
  // prompt's "@element1" refers to them. With a start frame the clip takes the frame's shape (aspect omitted).
  "kie-kling-3-v2": (req) => {
    const o = req.context.job.options;
    const first = slot(req, "first_frame");
    const last = slot(req, "last_frame");
    if (last.length && !first.length) throw new Error("end frame without start frame");
    const elements = [1, 2, 3]
      .map((n) => ({ n, urls: slot(req, `element_${n}`) }))
      .filter((e) => e.urls.length > 0)
      .map((e) => {
        if (e.urls.length < 2 || e.urls.length > 4) throw new Error("an element needs 2 to 4 images");
        return { name: `element${e.n}`, description: `element ${e.n}`, element_input_urls: e.urls };
      });
    return {
      prompt: req.context.job.prompt,
      mode: mapped(o, "resolution", { "720p": "std", "1080p": "pro", "4K": "4K" }),
      sound: onOff(o, "audio"),
      duration: mapped(o, "duration", { "5": "5", "10": "10", "15": "15" }),
      ...(first.length ? { image_urls: [...first.slice(0, 1), ...last.slice(0, 1)] } : { aspect_ratio: String(o.aspect_ratio) }),
      ...(elements.length ? { kling_elements: elements } : {}),
      multi_shots: false,
    };
  },
  // Seedance 2.x: first frame (+ last frame) OR multimodal references (images, audio) — mutually exclusive.
  "kie-seedance-2-v2": (req) => {
    const o = req.context.job.options;
    const first = slot(req, "first_frame");
    const last = slot(req, "last_frame");
    const images = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    if (last.length && !first.length) throw new Error("last frame without first frame");
    if (first.length && (images.length || audio.length)) throw new Error("frames and references cannot be combined");
    return {
      prompt: req.context.job.prompt,
      resolution: String(o.resolution),
      generate_audio: onOff(o, "audio"),
      duration: Number(o.duration),
      aspect_ratio: String(o.aspect_ratio),
      ...(first.length ? { first_frame_url: first[0], ...(last.length ? { last_frame_url: last[0] } : {}) } : {}),
      ...(images.length ? { reference_image_urls: images } : {}),
      ...(audio.length ? { reference_audio_urls: audio } : {}),
      nsfw_checker: true,
    };
  },
  // Seedance 2.5 video edit: the source clip as the reference video plus the written change; duration -1 keeps the
  // source length and the aspect follows the source. Optional reference images/audio guide the change.
  "kie-seedance-edit": (req) => {
    const o = req.context.job.options;
    const source = slot(req, "source_video");
    if (source.length !== 1) throw new Error("source video missing");
    const images = slot(req, "reference_images");
    const audio = slot(req, "reference_audio");
    return {
      prompt: req.context.job.prompt,
      reference_video_urls: source,
      ...(images.length ? { reference_image_urls: images } : {}),
      ...(audio.length ? { reference_audio_urls: audio } : {}),
      resolution: mapped(o, "resolution", { "480p": "480p", "720p": "720p" }),
      generate_audio: onOff(o, "audio"),
      duration: -1,
      aspect_ratio: "adaptive",
      nsfw_checker: true,
    };
  },
  // Kling 3.0 Motion Control: one character image, one motion video; orientation is "video" (follow the video) or
  // "image" (keep the image's orientation). There is no background-source parameter.
  "kie-kling-motion": (req) => {
    const o = req.context.job.options;
    const character = slot(req, "character_image");
    const motion = slot(req, "motion_video");
    if (character.length !== 1 || motion.length !== 1) throw new Error("character image and motion video are required");
    const prompt = req.context.job.prompt.trim();
    return {
      ...(prompt ? { prompt } : {}),
      input_urls: character,
      video_urls: motion,
      mode: mapped(o, "mode", { "720p": "720p", "1080p": "1080p" }),
      character_orientation: mapped(o, "orientation", { video: "video", image: "image" }),
    };
  },
  // Veo 3.1 Extend (model veo/extend): the earlier Veo task id, the prompt and the extension tier.
  "kie-veo-extend": (req) => {
    const o = req.context.job.options;
    const task = req.sourceTasks?.source_job?.[0];
    if (!task) throw new Error("source task missing");
    return { task_id: task, prompt: req.context.job.prompt, model: mapped(o, "tier", { fast: "fast", lite: "lite", quality: "quality" }) };
  },
};

/** Signed URLs of one typed input slot (empty when the slot is unused). */
function slot(req: SubmitRequest, name: string): string[] {
  return req.inputUrls?.[name] ?? [];
}

// The full image/video catalog (22 Oct 2026) adds its builders under new names; the ones above never change.
for (const [name, build] of Object.entries(CATALOG_ADAPTERS)) {
  if (ADAPTERS[name]) throw new Error(`adapter ${name} defined twice`);
  ADAPTERS[name] = build;
}

export function buildInput(req: SubmitRequest): Input {
  const build = ADAPTERS[req.context.model.adapter];
  if (!build) throw new Error(`no adapter for ${req.context.model.adapter}`);
  return build(req);
}

export const supportedAdapters = () => Object.keys(ADAPTERS);
