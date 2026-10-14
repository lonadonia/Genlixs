import type { SubmitRequest } from "../types";

/**
 * Per-adapter input builders (guide §12.2–12.3). The provider model id comes from the catalog row persisted with
 * the job; options were validated and frozen by the quote, so only documented fields are forwarded here.
 * A job keeps its adapter version: a new adapter shape must get a new adapter name, never an in-place change.
 */
type Input = Record<string, unknown>;

const pick = (opts: Record<string, string | number>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => opts[k] !== undefined && opts[k] !== null && opts[k] !== "").map((k) => [k, opts[k]]));

const ADAPTERS: Record<string, (req: SubmitRequest) => Input> = {
  "kie-market-image": ({ context }) => ({
    prompt: context.job.prompt,
    ...pick(context.job.options, ["aspect_ratio", "resolution"]),
  }),
  "kie-market-image-edit": ({ context, referenceUrls }) => {
    if (referenceUrls.length < 1) throw new Error("reference image missing");
    return {
      prompt: context.job.prompt,
      input_urls: referenceUrls,
      ...pick(context.job.options, ["aspect_ratio", "resolution"]),
    };
  },
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
};

export function buildInput(req: SubmitRequest): Input {
  const build = ADAPTERS[req.context.model.adapter];
  if (!build) throw new Error(`no adapter for ${req.context.model.adapter}`);
  return build(req);
}

export const supportedAdapters = () => Object.keys(ADAPTERS);
