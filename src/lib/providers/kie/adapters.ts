import type { SubmitRequest } from "../types";

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
};

export function buildInput(req: SubmitRequest): Input {
  const build = ADAPTERS[req.context.model.adapter];
  if (!build) throw new Error(`no adapter for ${req.context.model.adapter}`);
  return build(req);
}

export const supportedAdapters = () => Object.keys(ADAPTERS);
