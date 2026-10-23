// Catalog source for the full image/video catalog (checked against docs.kie.ai and the KIE price list on 22 Oct 2026).
// One entry per Genlixs model row: its KIE original route (model id per input mode, adapter), capability specification
// and KIE reference price schedule in KIE credits ($0.005 each). build.mjs turns this into a repeatable migration and
// the coverage report. Customer prices are never written here: they follow the global pricing policy.
import { IMG, NO_REFS, aspect, imageOut, opt, perOutput, quality, refs, resolution } from "./lib.mjs";

const docs = (path) => `https://docs.kie.ai/${path}`;

// ------------------------------------------------------------------------------------------------ image helpers

const imageSpec = (o) => ({
  jobKind: "text_to_image",
  prompt: { min: 3, max: 4000, ...(o.prompt ?? {}) },
  options: o.options,
  references: NO_REFS,
  output: imageOut(o.count ?? 1),
  ...(o.exclude ? { exclude: o.exclude, excludeMessage: o.excludeMessage } : {}),
  ...(o.fixed ? { fixed: o.fixed } : {}),
});
const editSpec = (o) => ({
  jobKind: "image_edit",
  prompt: { min: 3, max: 4000, ...(o.prompt ?? {}) },
  options: o.options,
  references: refs(1, o.refs, o.mime ?? IMG),
  output: imageOut(1),
  ...(o.exclude ? { exclude: o.exclude, excludeMessage: o.excludeMessage } : {}),
  ...(o.fixed ? { fixed: o.fixed } : {}),
});

const AR10 = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"];
const AR8 = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];
const AR5 = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const SPEED = opt("Rendering", ["turbo", "balanced", "quality"], "balanced", { turbo: "Turbo", balanced: "Balanced", quality: "Quality" });
const res = (values, def) => resolution(values, def ?? values[0]);

export const IMAGE_MODELS = [
  // ---------------------------------------------------------------- OpenAI
  {
    id: "gpt-image-2-image", tool: "image", name: "GPT Image 2", family: "GPT Image 2", variant: null, badges: [], sort: 100,
    purpose: "OpenAI's GPT Image 2: precise prompt following and readable text in images, up to 4K.",
    kie: { model: "gpt-image-2-text-to-image", adapter: "kie-market-image", docs: docs("market/gpt/gpt-image-2-text-to-image") },
    spec: imageSpec({
      options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(AR10, "1:1") },
      exclude: [{ resolution: "2K", aspect_ratio: "5:4" }, { resolution: "2K", aspect_ratio: "4:5" }],
      excludeMessage: "5:4 and 4:5 are available at 1K and 4K only.",
    }),
    cost: { schedule: perOutput(["resolution"], { "1K": 6, "2K": 10, "4K": 16 }), note: "KIE price list: gpt image 2, text-to-image, 1k/2k/4k = 6/10/16 credits per image." },
  },
  {
    id: "gpt-image-2-edit", tool: "edit", name: "GPT Image 2 Edit", family: "GPT Image 2", variant: null, badges: [], sort: 200,
    purpose: "Edits or combines up to 16 images with GPT Image 2 from a written instruction.",
    kie: { model: "gpt-image-2-image-to-image", adapter: "kie-market-image-edit", docs: docs("market/gpt/gpt-image-2-image-to-image") },
    spec: editSpec({
      refs: 16,
      options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(["auto", ...AR10], "auto") },
      exclude: [{ resolution: "2K", aspect_ratio: "5:4" }, { resolution: "2K", aspect_ratio: "4:5" }],
      excludeMessage: "5:4 and 4:5 are available at 1K and 4K only.",
    }),
    cost: { schedule: perOutput(["resolution"], { "1K": 6, "2K": 10, "4K": 16 }), note: "KIE price list: gpt image 2, image-to-image, 1k/2k/4k = 6/10/16 credits per image." },
  },
  {
    id: "gpt-image-1-5-image", tool: "image", name: "GPT Image 1.5", family: "GPT Image 1.5", variant: null, badges: [], sort: 102,
    purpose: "OpenAI's GPT Image 1.5 in standard or high quality.",
    kie: { model: "gpt-image/1.5-text-to-image", adapter: "kie-gpt-image-1-5", docs: docs("market/gpt-image/1-5-text-to-image") },
    spec: imageSpec({ options: { quality: quality(["medium", "high"], "medium", { medium: "Standard", high: "High" }), aspect_ratio: aspect(["1:1", "3:2", "2:3"]) } }),
    cost: { schedule: perOutput(["quality"], { medium: 4, high: 22 }), note: "KIE price list: gpt image 1.5, text-to-image, medium/high = 4/22 credits per image." },
  },
  {
    id: "gpt-image-1-5-edit", tool: "edit", name: "GPT Image 1.5 Edit", family: "GPT Image 1.5", variant: null, badges: [], sort: 202,
    purpose: "Edits up to 16 images with GPT Image 1.5 in standard or high quality.",
    kie: { model: "gpt-image/1.5-image-to-image", adapter: "kie-gpt-image-1-5", docs: docs("market/gpt-image/1-5-image-to-image") },
    spec: editSpec({ refs: 16, options: { quality: quality(["medium", "high"], "medium", { medium: "Standard", high: "High" }), aspect_ratio: aspect(["1:1", "3:2", "2:3"]) } }),
    cost: { schedule: perOutput(["quality"], { medium: 4, high: 22 }), note: "KIE price list: gpt image 1.5, image-to-image, medium/high = 4/22 credits per image." },
  },
  {
    id: "gpt-4o-image", tool: "image", name: "GPT-4o Image", family: "GPT-4o Image", variant: null, badges: [], sort: 104,
    purpose: "OpenAI's GPT-4o image generation in square, landscape or portrait.",
    kie: { model: "4o-image-api", adapter: "kie-4o-image", docs: docs("4o-image-api/generate-4-o-image") },
    spec: imageSpec({ options: { aspect_ratio: aspect(["1:1", "3:2", "2:3"]) } }),
    cost: { schedule: perOutput([], { "": 6 }), note: "KIE price list: OpenAI 4o image, text-to-image = 6 credits per image." },
  },
  {
    id: "gpt-4o-image-edit", tool: "edit", name: "GPT-4o Image Edit", family: "GPT-4o Image", variant: null, badges: [], sort: 204,
    purpose: "Edits or builds on up to 5 images with GPT-4o image generation.",
    kie: { model: "4o-image-api", adapter: "kie-4o-image", docs: docs("4o-image-api/generate-4-o-image") },
    spec: editSpec({ refs: 5, options: { aspect_ratio: aspect(["1:1", "3:2", "2:3"]) } }),
    cost: { schedule: perOutput([], { "": 6 }), note: "KIE price list: OpenAI 4o image = 6 credits per image (files_url references are included)." },
  },

  // ---------------------------------------------------------------- Google
  {
    id: "nano-banana-image", tool: "image", name: "Nano Banana", family: "Nano Banana", variant: null, badges: ["budget"], sort: 110,
    purpose: "Google's original Nano Banana (Gemini 2.5 Flash Image): fast, low-cost images.",
    kie: { model: "google/nano-banana", adapter: "kie-nano-banana-1", docs: docs("market/google/nano-banana") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR10, "1:1") } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: Google nano banana, text-to-image = 4 credits per image." },
  },
  {
    id: "nano-banana-edit", tool: "edit", name: "Nano Banana Edit", family: "Nano Banana", variant: null, badges: ["budget"], sort: 210,
    purpose: "Edits up to 10 images with Google's original Nano Banana.",
    kie: { model: "google/nano-banana-edit", adapter: "kie-nano-banana-1", docs: docs("market/google/nano-banana-edit") },
    spec: editSpec({ refs: 10, options: { aspect_ratio: aspect(["auto", ...AR10], "auto") } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: Google nano banana edit, image-to-image = 4 credits per image." },
  },
  {
    id: "nano-banana-2-edit", tool: "edit", name: "Nano Banana 2 Edit", family: "Nano Banana", variant: "2", badges: [], sort: 211,
    purpose: "Edits up to 10 images with Nano Banana 2 at 1K, 2K or 4K.",
    kie: { model: "nano-banana-2", adapter: "kie-nano-banana", docs: docs("market/google/nanobanana2") },
    spec: editSpec({ refs: 10, options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(["auto", ...AR10], "auto") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 8, "2K": 12, "4K": 18 }), note: "KIE price list: Google nano banana 2, 1K/2K/4K = 8/12/18 credits per image (references included)." },
  },
  {
    id: "nano-banana-2-1-image", tool: "image", name: "Nano Banana 2.1", family: "Nano Banana", variant: "2.1", badges: [], sort: 112,
    purpose: "Google's Nano Banana 2.1 at 1K, 2K or 4K.",
    kie: { model: "nano-banana-2-1", adapter: "kie-nano-banana", docs: docs("market/google/nanobanana-2-1") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(AR10, "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4, "2K": 6, "4K": 9 }), note: "KIE price list: nano-banana-2-1, 1K/2K/4K = 4/6/9 credits per image." },
  },
  {
    id: "nano-banana-2-1-edit", tool: "edit", name: "Nano Banana 2.1 Edit", family: "Nano Banana", variant: "2.1", badges: [], sort: 212,
    purpose: "Edits up to 10 images with Nano Banana 2.1 at 1K, 2K or 4K.",
    kie: { model: "nano-banana-2-1", adapter: "kie-nano-banana", docs: docs("market/google/nanobanana-2-1") },
    spec: editSpec({ refs: 10, options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(["auto", ...AR10], "auto") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4, "2K": 6, "4K": 9 }), note: "KIE price list: nano-banana-2-1, 1K/2K/4K = 4/6/9 credits per image (references included)." },
  },
  {
    id: "nano-banana-2-lite-image", tool: "image", name: "Nano Banana 2 Lite", family: "Nano Banana", variant: "2 Lite", badges: ["budget"], sort: 113,
    purpose: "Google's Nano Banana 2 Lite: quick 1K images.",
    kie: { model: "nano-banana-2-lite", adapter: "kie-nano-banana-lite", docs: docs("market/google/nano-banana-2-lite") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR10, "1:1") }, fixed: { size: "Images are about 1K (1024 px on the long side)." } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: nano-banana-2-lite, 1k = 4 credits per image." },
  },
  {
    id: "nano-banana-2-lite-edit", tool: "edit", name: "Nano Banana 2 Lite Edit", family: "Nano Banana", variant: "2 Lite", badges: ["budget"], sort: 213,
    purpose: "Quick 1K edits of up to 10 images with Nano Banana 2 Lite.",
    kie: { model: "nano-banana-2-lite", adapter: "kie-nano-banana-lite", docs: docs("market/google/nano-banana-2-lite") },
    spec: editSpec({ refs: 10, options: { aspect_ratio: aspect(["auto", ...AR10], "auto") }, fixed: { size: "Images are about 1K (1024 px on the long side)." } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: nano-banana-2-lite, 1k = 4 credits per image (references included)." },
  },
  {
    id: "imagen-4-fast", tool: "image", name: "Imagen 4 Fast", family: "Imagen 4", variant: "Fast", badges: ["fast", "budget"], sort: 115,
    purpose: "Google Imagen 4 Fast: quick photorealistic images.",
    kie: { model: "google/imagen4-fast", adapter: "kie-imagen-4", docs: docs("market/google/imagen4-fast") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR5, "1:1") } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: google imagen4, text-to-image, Fast = 4 credits per request (one image)." },
  },
  {
    id: "imagen-4", tool: "image", name: "Imagen 4", family: "Imagen 4", variant: "Standard", badges: [], sort: 116,
    purpose: "Google Imagen 4: detailed photorealistic images.",
    kie: { model: "google/imagen4", adapter: "kie-imagen-4", docs: docs("market/google/imagen4") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR5, "1:1") } }),
    cost: { schedule: perOutput([], { "": 8 }), note: "KIE price list: google imagen4, text-to-image, default = 8 credits per request (one image)." },
  },
  {
    id: "imagen-4-ultra", tool: "image", name: "Imagen 4 Ultra", family: "Imagen 4", variant: "Ultra", badges: ["premium"], sort: 117,
    purpose: "Google Imagen 4 Ultra: the highest-fidelity Imagen 4 tier.",
    kie: { model: "google/imagen4-ultra", adapter: "kie-imagen-4", docs: docs("market/google/imagen4-ultra") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR5, "1:1") } }),
    cost: { schedule: perOutput([], { "": 12 }), note: "KIE price list: google imagen4, text-to-image, Ultra = 12 credits per image." },
  },

  // ---------------------------------------------------------------- Black Forest Labs
  {
    id: "flux-2-flex-image", tool: "image", name: "FLUX.2 Flex", family: "FLUX.2", variant: "Flex", badges: [], sort: 120,
    purpose: "FLUX.2 Flex: fine typography and detail control, 1K or 2K.",
    kie: { model: "flux-2/flex-text-to-image", adapter: "kie-flux-2", docs: docs("market/flux2/flex-text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"], "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 14, "2K": 24 }), note: "KIE price list: Flux 2 Flex, text to image, 1K/2K = 14/24 credits per image." },
  },
  {
    id: "flux-2-flex-edit", tool: "edit", name: "FLUX.2 Flex Edit", family: "FLUX.2", variant: "Flex", badges: [], sort: 220,
    purpose: "Edits or combines up to 8 images with FLUX.2 Flex.",
    kie: { model: "flux-2/flex-image-to-image", adapter: "kie-flux-2", docs: docs("market/flux2/flex-image-to-image") },
    spec: editSpec({ refs: 8, options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"], "auto") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 14, "2K": 24 }), note: "KIE price list: Flux 2 Flex, image to image, 1K/2K = 14/24 credits per image." },
  },
  {
    id: "flux-3-klein-image", tool: "image", name: "FLUX 3 Klein", family: "FLUX 3", variant: "Klein", badges: ["budget", "fast"], sort: 121,
    purpose: "FLUX 3 Klein: fast, inexpensive images up to 4K.",
    kie: { model: "flux-3/klein-text-to-image", adapter: "kie-flux-3-klein", docs: docs("market/flux3/klein-text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"], "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 1.6, "2K": 2.5, "4K": 6.5 }), note: "KIE price list: Flux 3 Klein, text to image, 1K/2K/4K = 1.6/2.5/6.5 credits per image." },
  },
  {
    id: "flux-3-klein-edit", tool: "edit", name: "FLUX 3 Klein Edit", family: "FLUX 3", variant: "Klein", badges: ["budget", "fast"], sort: 221,
    purpose: "Fast edits of up to 10 images with FLUX 3 Klein, up to 4K.",
    kie: { model: "flux-3/klein-edit-image", adapter: "kie-flux-3-klein", docs: docs("market/flux3/klein-edit-image") },
    spec: editSpec({ refs: 10, options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(["auto", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"], "auto") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 1.6, "2K": 2.5, "4K": 6.5 }), note: "KIE price list: Flux 3 Klein, image editing, 1K/2K/4K = 1.6/2.5/6.5 credits per image." },
  },
  {
    id: "flux-kontext-image", tool: "image", name: "FLUX.1 Kontext", family: "FLUX.1 Kontext", variant: null, badges: [], sort: 122,
    purpose: "FLUX.1 Kontext in Pro or Max quality.",
    kie: { model: "flux1-kontext", adapter: "kie-flux-kontext", docs: docs("flux-kontext-api/generate-or-edit-image") },
    spec: imageSpec({ options: { tier: opt("Tier", ["pro", "max"], "pro", { pro: "Pro", max: "Max" }), aspect_ratio: aspect(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], "1:1") } }),
    cost: { schedule: perOutput(["tier"], { pro: 5, max: 10 }), note: "KIE price list: flux1-kontext, Pro/Max = 5/10 credits per image." },
  },
  {
    id: "flux-kontext-edit", tool: "edit", name: "FLUX.1 Kontext Edit", family: "FLUX.1 Kontext", variant: null, badges: [], sort: 222,
    purpose: "Edits one image with FLUX.1 Kontext Pro or Max, keeping its shape unless you pick another.",
    kie: { model: "flux1-kontext", adapter: "kie-flux-kontext", docs: docs("flux-kontext-api/generate-or-edit-image") },
    spec: editSpec({ refs: 1, options: { tier: opt("Tier", ["pro", "max"], "pro", { pro: "Pro", max: "Max" }), aspect_ratio: aspect(["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "21:9"], "auto") } }),
    cost: { schedule: perOutput(["tier"], { pro: 5, max: 10 }), note: "KIE price list: flux1-kontext, Pro/Max = 5/10 credits per image (editing included)." },
  },

  // ---------------------------------------------------------------- ByteDance
  {
    id: "seedream-3-image", tool: "image", name: "Seedream 3.0", family: "Seedream 3.0", variant: null, badges: ["budget"], sort: 130,
    purpose: "ByteDance Seedream 3.0: inexpensive general-purpose images.",
    kie: { model: "bytedance/seedream", adapter: "kie-seedream-3", docs: docs("market/seedream/seedream") },
    spec: imageSpec({ options: { aspect_ratio: aspect(["1:1", "4:3", "3:4", "16:9", "9:16"], "1:1") } }),
    cost: { schedule: perOutput([], { "": 3.5 }), note: "KIE price list: seedream 3.0 = 3.5 credits per image." },
  },
  {
    id: "seedream-4-image", tool: "image", name: "Seedream 4.0", family: "Seedream 4.0", variant: null, badges: [], sort: 131,
    purpose: "ByteDance Seedream 4.0 at 1K, 2K or 4K.",
    kie: { model: "bytedance/seedream-v4-text-to-image", adapter: "kie-seedream-4", docs: docs("market/seedream/seedream-v4-text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 5, "2K": 5, "4K": 5 }), note: "KIE price list: seedream v4, text-to-image = 5 credits per image at any resolution." },
  },
  {
    id: "seedream-4-edit", tool: "edit", name: "Seedream 4.0 Edit", family: "Seedream 4.0", variant: null, badges: [], sort: 231,
    purpose: "Edits up to 10 images with Seedream 4.0 at 1K, 2K or 4K.",
    kie: { model: "bytedance/seedream-v4-edit", adapter: "kie-seedream-4", docs: docs("market/seedream/seedream-v4-edit") },
    spec: editSpec({ refs: 10, options: { resolution: res(["1K", "2K", "4K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 5, "2K": 5, "4K": 5 }), note: "KIE price list: seedream v4, edit = 5 credits per image." },
  },
  {
    id: "seedream-4-5-image", tool: "image", name: "Seedream 4.5", family: "Seedream 4.5", variant: null, badges: [], sort: 132,
    purpose: "ByteDance Seedream 4.5 at 2K or 4K.",
    kie: { model: "seedream/4.5-text-to-image", adapter: "kie-seedream-4-5", docs: docs("market/seedream/4-5-text-to-image") },
    spec: imageSpec({ options: { quality: quality(["basic", "high"], "basic", { basic: "2K", high: "4K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { max: 3000 } }),
    cost: { schedule: perOutput(["quality"], { basic: 6.5, high: 6.5 }), note: "KIE price list: seedream 4.5, text-to-image = 6.5 credits per image (2K or 4K)." },
  },
  {
    id: "seedream-4-5-edit", tool: "edit", name: "Seedream 4.5 Edit", family: "Seedream 4.5", variant: null, badges: [], sort: 232,
    purpose: "Edits up to 14 images with Seedream 4.5 at 2K or 4K.",
    kie: { model: "seedream/4.5-edit", adapter: "kie-seedream-4-5", docs: docs("market/seedream/4-5-edit") },
    spec: editSpec({ refs: 14, options: { quality: quality(["basic", "high"], "basic", { basic: "2K", high: "4K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { max: 3000 } }),
    cost: { schedule: perOutput(["quality"], { basic: 6.5, high: 6.5 }), note: "KIE price list: seedream 4.5, image-to-image = 6.5 credits per image." },
  },
  {
    id: "seedream-5-lite-image", tool: "image", name: "Seedream 5.0 Lite", family: "Seedream 5.0", variant: "Lite", badges: [], sort: 133,
    purpose: "ByteDance Seedream 5.0 Lite at 2K, 3K or 4K.",
    kie: { model: "seedream/5-lite-text-to-image", adapter: "kie-seedream-5-quality", docs: docs("market/seedream/5-lite-text-to-image") },
    spec: imageSpec({ options: { quality: quality(["basic", "high", "ultra"], "basic", { basic: "2K", high: "3K", ultra: "4K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { min: 4, max: 2995 } }),
    cost: { schedule: perOutput(["quality"], { basic: 5.5, high: 5.5, ultra: 5.5 }), note: "KIE price list: seedream 5.0 Lite, text-to-image = 5.5 credits per image." },
  },
  {
    id: "seedream-5-lite-edit", tool: "edit", name: "Seedream 5.0 Lite Edit", family: "Seedream 5.0", variant: "Lite", badges: [], sort: 233,
    purpose: "Edits up to 14 images with Seedream 5.0 Lite at 2K, 3K or 4K.",
    kie: { model: "seedream/5-lite-image-to-image", adapter: "kie-seedream-5-quality", docs: docs("market/seedream-5-lite-image-to-image") },
    spec: editSpec({ refs: 14, options: { quality: quality(["basic", "high", "ultra"], "basic", { basic: "2K", high: "3K", ultra: "4K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { min: 4, max: 2995 } }),
    cost: { schedule: perOutput(["quality"], { basic: 5.5, high: 5.5, ultra: 5.5 }), note: "KIE price list: seedream 5.0 Lite, image-to-image = 5.5 credits per image." },
  },
  {
    id: "seedream-5-pro-image", tool: "image", name: "Seedream 5.0 Pro", family: "Seedream 5.0", variant: "Pro", badges: ["premium"], sort: 134,
    purpose: "ByteDance Seedream 5.0 Pro at 1K or 2K.",
    kie: { model: "seedream/5-pro-text-to-image", adapter: "kie-seedream-5-quality", docs: docs("market/seedream/5-pro-text-to-image") },
    spec: imageSpec({ options: { quality: quality(["basic", "high"], "basic", { basic: "1K", high: "2K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { min: 4 } }),
    cost: { schedule: perOutput(["quality"], { basic: 7, high: 14 }), note: "KIE price list: seedream 5 Pro, text-to-image, 1K/2K = 7/14 credits per image." },
  },
  {
    id: "seedream-5-pro-edit", tool: "edit", name: "Seedream 5.0 Pro Edit", family: "Seedream 5.0", variant: "Pro", badges: ["premium"], sort: 234,
    purpose: "Edits up to 10 images with Seedream 5.0 Pro at 1K or 2K.",
    kie: { model: "seedream/5-pro-image-to-image", adapter: "kie-seedream-5-quality", docs: docs("market/seedream/5-pro-image-to-image") },
    spec: editSpec({ refs: 10, options: { quality: quality(["basic", "high"], "basic", { basic: "1K", high: "2K" }), aspect_ratio: aspect(AR8, "1:1") }, prompt: { min: 4 } }),
    cost: {
      schedule: perOutput(["quality"], { basic: 7, high: 14 }, { extraReference: { free: 1, credits: 0.5 } }),
      note: "KIE price list: seedream 5 Pro, image-to-image, 1K/2K = 7/14 credits per image; input images 0.5 credits each, first image free.",
    },
  },

  // ---------------------------------------------------------------- others
  {
    id: "z-image", tool: "image", name: "Z-Image", family: "Z-Image", variant: null, badges: ["budget", "fast"], sort: 135,
    purpose: "Tongyi's Z-Image: very fast, very low-cost images.",
    kie: { model: "z-image", adapter: "kie-z-image", docs: docs("market/z-image/z-image") },
    spec: imageSpec({ options: { aspect_ratio: aspect(AR5, "1:1") }, prompt: { max: 1000 } }),
    cost: { schedule: perOutput([], { "": 0.8 }), note: "KIE price list: Qwen z-image, text-to-image = 0.8 credits per image." },
  },
  {
    id: "grok-imagine-image", tool: "image", name: "Grok Imagine", family: "Grok Imagine", variant: null, badges: ["budget"], sort: 140,
    purpose: "xAI Grok Imagine: two images per generation.",
    kie: { model: "grok-imagine/text-to-image", adapter: "kie-grok-image", docs: docs("market/grok-imagine/text-to-image") },
    spec: imageSpec({ options: { aspect_ratio: aspect(["1:1", "2:3", "3:2", "16:9", "9:16"], "1:1") }, count: 2, fixed: { count: "Each generation returns two images." } }),
    cost: { schedule: perOutput([], { "": 2 }), note: "KIE price list: grok-imagine, text-to-image = 4 credits per 2 images (speed mode); a task always returns 2 images." },
  },
  {
    id: "grok-imagine-edit", tool: "edit", name: "Grok Imagine Edit", family: "Grok Imagine", variant: null, badges: ["budget"], sort: 240,
    purpose: "Transforms up to 5 images with xAI Grok Imagine.",
    kie: { model: "grok-imagine/image-to-image", adapter: "kie-grok-image", docs: docs("market/grok-imagine/image-to-image") },
    spec: editSpec({ refs: 5, options: {} }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: grok-imagine, image-to-image = 4 credits per generation." },
  },
  {
    id: "grok-image-2-image", tool: "image", name: "Grok Imagine Image 2.0", family: "Grok Imagine", variant: "Image 2.0", badges: [], sort: 141,
    purpose: "xAI Grok Imagine Image 2.0.",
    kie: { model: "grok-imagine-image-2-0/text-to-image", adapter: "kie-grok-image-2", docs: docs("market/grok-imagine-image-2-0/text-to-image") },
    spec: imageSpec({ options: { aspect_ratio: aspect(["1:1", "2:3", "3:2", "16:9", "9:16"], "1:1") } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: grok-imagine-image-2-0, Text to Image = 4 credits per image." },
  },
  {
    id: "grok-image-2-edit", tool: "edit", name: "Grok Imagine Image 2.0 Edit", family: "Grok Imagine", variant: "Image 2.0", badges: [], sort: 241,
    purpose: "Edits up to 5 images with xAI Grok Imagine Image 2.0.",
    kie: { model: "grok-imagine-image-2-0/image-edit", adapter: "kie-grok-image-2", docs: docs("market/grok-imagine-image-2-0/image-to-image") },
    spec: editSpec({ refs: 5, options: { aspect_ratio: aspect(["auto", "1:1", "2:3", "3:2", "16:9", "9:16"], "auto") } }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: grok-imagine-image-2-0, Image Edit = 4 credits per image." },
  },
  {
    id: "ideogram-v3-image", tool: "image", name: "Ideogram V3", family: "Ideogram", variant: "V3", badges: [], sort: 145,
    purpose: "Ideogram V3: strong typography and graphic design, three rendering speeds.",
    kie: { model: "ideogram/v3-text-to-image", adapter: "kie-ideogram-v3", docs: docs("market/ideogram/v3-text-to-image") },
    spec: imageSpec({
      options: { speed: SPEED, style: opt("Style", ["AUTO", "GENERAL", "REALISTIC", "DESIGN"], "AUTO", { AUTO: "Auto", GENERAL: "General", REALISTIC: "Realistic", DESIGN: "Design" }),
        aspect_ratio: aspect(["1:1", "4:3", "3:4", "16:9", "9:16"], "1:1") },
    }),
    cost: { schedule: perOutput(["speed"], { turbo: 3.5, balanced: 7, quality: 10 }), note: "KIE price list: ideogram v3, text-to-image, TURBO/BALANCED/QUALITY = 3.5/7/10 credits per image." },
  },
  {
    id: "ideogram-v3-remix", tool: "edit", name: "Ideogram V3 Remix", family: "Ideogram", variant: "V3", badges: [], sort: 245,
    purpose: "Re-creates one image in a new style or scene with Ideogram V3.",
    kie: { model: "ideogram/v3-remix", adapter: "kie-ideogram-v3", docs: docs("market/ideogram/v3-remix") },
    spec: editSpec({
      refs: 1,
      options: { speed: SPEED, style: opt("Style", ["AUTO", "GENERAL", "REALISTIC", "DESIGN"], "AUTO", { AUTO: "Auto", GENERAL: "General", REALISTIC: "Realistic", DESIGN: "Design" }),
        aspect_ratio: aspect(["1:1", "4:3", "3:4", "16:9", "9:16"], "1:1") },
    }),
    cost: { schedule: perOutput(["speed"], { turbo: 3.5, balanced: 7, quality: 10 }), note: "KIE price list: ideogram v3-remix, TURBO/BALANCED/QUALITY = 3.5/7/10 credits per image." },
  },
  {
    id: "ideogram-character", tool: "edit", name: "Ideogram Character", family: "Ideogram", variant: "Character", badges: [], sort: 246,
    purpose: "Puts the character from one photo into new scenes with Ideogram Character.",
    kie: { model: "ideogram/character", adapter: "kie-ideogram-character", docs: docs("market/ideogram/character") },
    spec: editSpec({
      refs: 1,
      options: { speed: SPEED, style: opt("Style", ["AUTO", "REALISTIC", "FICTION"], "AUTO", { AUTO: "Auto", REALISTIC: "Realistic", FICTION: "Fiction" }),
        aspect_ratio: aspect(["1:1", "4:3", "3:4", "16:9", "9:16"], "1:1") },
      fixed: { reference: "The reference image is the character to keep (one image)." },
    }),
    cost: { schedule: perOutput(["speed"], { turbo: 12, balanced: 18, quality: 24 }), note: "KIE price list: ideogram character, TURBO/BALANCED/QUALITY = 12/18/24 credits per image." },
  },
  {
    id: "qwen-image-2-image", tool: "image", name: "Qwen Image 2", family: "Qwen Image", variant: "2", badges: [], sort: 150,
    purpose: "Alibaba Qwen Image 2.",
    kie: { model: "qwen2/text-to-image", adapter: "kie-qwen-2", docs: docs("market/qwen2/text-to-image") },
    spec: imageSpec({ options: { aspect_ratio: aspect(["1:1", "3:4", "4:3", "9:16", "16:9"], "1:1") } }),
    cost: { schedule: perOutput([], { "": 5.6 }), note: "KIE price list: Qwen Image 2, text-to-image = 5.6 credits per image." },
  },
  {
    id: "qwen-image-2-edit", tool: "edit", name: "Qwen Image 2 Edit", family: "Qwen Image", variant: "2", badges: [], sort: 250,
    purpose: "Edits up to 3 images with Alibaba Qwen Image 2.",
    kie: { model: "qwen2/image-edit", adapter: "kie-qwen-2", docs: docs("market/qwen2/image-edit") },
    spec: editSpec({ refs: 3, options: { aspect_ratio: aspect(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"], "1:1") }, prompt: { max: 800 } }),
    cost: { schedule: perOutput([], { "": 5.6 }), note: "KIE price list: Qwen Image 2, image-to-image = 5.6 credits per image." },
  },
  {
    id: "qwen-image-2-1-image", tool: "image", name: "Qwen Image 2.1", family: "Qwen Image", variant: "2.1", badges: [], sort: 151,
    purpose: "Alibaba Qwen Image 2.1 at 1K or 2K.",
    kie: { model: "qwen2-1/text-to-image", adapter: "kie-qwen-2-1", docs: docs("market/qwen2-1/text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"], "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4, "2K": 8 }), note: "KIE price list: Qwen-Image-2.1, text to image, 1K/2K = 4/8 credits per image." },
  },
  {
    id: "qwen-image-2-1-edit", tool: "edit", name: "Qwen Image 2.1 Edit", family: "Qwen Image", variant: "2.1", badges: [], sort: 251,
    purpose: "Edits up to 10 images with Alibaba Qwen Image 2.1 at 1K or 2K.",
    kie: { model: "qwen2-1/image-to-image", adapter: "kie-qwen-2-1", docs: docs("market/qwen2-1/image-to-image") },
    spec: editSpec({ refs: 10, options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(["auto", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"], "auto") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4, "2K": 8 }), note: "KIE price list: Qwen-Image-2.1, image to image, 1K/2K = 4/8 credits per image." },
  },
  {
    id: "qwen-image-3-image", tool: "image", name: "Qwen Image 3.0", family: "Qwen Image", variant: "3.0", badges: [], sort: 152,
    purpose: "Alibaba Qwen Image 3.0 at 1K or 2K.",
    kie: { model: "qwen3/text-to-image", adapter: "kie-qwen-3", docs: docs("market/qwen3/text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4.8, "2K": 4.8 }), note: "KIE price list: Qwen image 3.0, text to image, 1K/2K = 4.8 credits per image." },
  },
  {
    id: "qwen-image-3-edit", tool: "edit", name: "Qwen Image 3.0 Edit", family: "Qwen Image", variant: "3.0", badges: [], sort: 252,
    purpose: "Edits up to 3 images with Alibaba Qwen Image 3.0.",
    kie: { model: "qwen3/image-to-image", adapter: "kie-qwen-3", docs: docs("market/qwen3/image-to-image") },
    spec: editSpec({ refs: 3, options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: {
      schedule: perOutput(["resolution"], { "1K": 4.8, "2K": 4.8 }, { extraReference: { free: 0, credits: 0.5 } }),
      note: "KIE price list: Qwen image 3.0, output 1K/2K = 4.8 credits per image, input 0.5 credits per image.",
    },
  },
  {
    id: "qwen-image-3-pro-image", tool: "image", name: "Qwen Image 3.0 Pro", family: "Qwen Image", variant: "3.0 Pro", badges: ["premium"], sort: 153,
    purpose: "Alibaba Qwen Image 3.0 Pro at 1K or 2K.",
    kie: { model: "qwen3/pro-text-to-image", adapter: "kie-qwen-3", docs: docs("market/qwen3-pro/text-to-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 6.4, "2K": 12 }), note: "KIE price list: Qwen image 3.0 Pro, text to image, 1K/2K = 6.4/12 credits per image." },
  },
  {
    id: "qwen-image-3-pro-edit", tool: "edit", name: "Qwen Image 3.0 Pro Edit", family: "Qwen Image", variant: "3.0 Pro", badges: ["premium"], sort: 253,
    purpose: "Edits up to 3 images with Alibaba Qwen Image 3.0 Pro.",
    kie: { model: "qwen3/pro-image-to-image", adapter: "kie-qwen-3", docs: docs("market/qwen3-pro/image-to-image") },
    spec: editSpec({ refs: 3, options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(AR8, "1:1") } }),
    cost: {
      schedule: perOutput(["resolution"], { "1K": 6.4, "2K": 12 }, { extraReference: { free: 0, credits: 0.5 } }),
      note: "KIE price list: Qwen image 3.0 Pro, output 1K/2K = 6.4/12 credits per image, input 0.5 credits per image.",
    },
  },
  {
    id: "qwen-image-edit", tool: "edit", name: "Qwen Image Remix", family: "Qwen Image", variant: "1.0", badges: ["budget"], sort: 254,
    purpose: "Re-creates one image from your prompt with the original Qwen Image (image-to-image).",
    kie: { model: "qwen/image-to-image", adapter: "kie-qwen-image-1", docs: docs("market/qwen/image-to-image") },
    spec: editSpec({ refs: 1, options: {} }),
    cost: { schedule: perOutput([], { "": 4 }), note: "KIE price list: Qwen Image, image-to-image = 4 credits per image." },
  },
  {
    id: "wan-2-7-image", tool: "image", name: "Wan 2.7 Image", family: "Wan 2.7 Image", variant: null, badges: [], sort: 155,
    purpose: "Alibaba Wan 2.7 Image at 1K or 2K.",
    kie: { model: "wan/2-7-image", adapter: "kie-wan-2-7-image", docs: docs("market/wan/2-7-image") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K"]), aspect_ratio: aspect(["1:1", "16:9", "4:3", "21:9", "3:4", "9:16"], "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4.8, "2K": 4.8 }), note: "KIE price list: wan 2.7 image = 4.8 credits per image." },
  },
  {
    id: "wan-2-7-image-edit", tool: "edit", name: "Wan 2.7 Image Edit", family: "Wan 2.7 Image", variant: null, badges: [], sort: 255,
    purpose: "Edits up to 9 images with Alibaba Wan 2.7 Image; the result keeps the input's shape.",
    kie: { model: "wan/2-7-image", adapter: "kie-wan-2-7-image", docs: docs("market/wan/2-7-image") },
    spec: editSpec({ refs: 9, options: { resolution: res(["1K", "2K"]) } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 4.8, "2K": 4.8 }), note: "KIE price list: wan 2.7 image = 4.8 credits per image." },
  },
  {
    id: "wan-2-7-image-pro", tool: "image", name: "Wan 2.7 Image Pro", family: "Wan 2.7 Image", variant: "Pro", badges: ["premium"], sort: 156,
    purpose: "Alibaba Wan 2.7 Image Pro up to 4K.",
    kie: { model: "wan/2-7-image-pro", adapter: "kie-wan-2-7-image", docs: docs("market/wan/2-7-image-pro") },
    spec: imageSpec({ options: { resolution: res(["1K", "2K", "4K"], "2K"), aspect_ratio: aspect(["1:1", "16:9", "4:3", "21:9", "3:4", "9:16"], "1:1") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 12, "2K": 12, "4K": 12 }), note: "KIE price list: wan 2.7 image pro = 12 credits per image." },
  },
  {
    id: "wan-2-7-image-pro-edit", tool: "edit", name: "Wan 2.7 Image Pro Edit", family: "Wan 2.7 Image", variant: "Pro", badges: ["premium"], sort: 256,
    purpose: "Edits up to 9 images with Alibaba Wan 2.7 Image Pro; the result keeps the input's shape.",
    kie: { model: "wan/2-7-image-pro", adapter: "kie-wan-2-7-image", docs: docs("market/wan/2-7-image-pro") },
    spec: editSpec({ refs: 9, options: { resolution: res(["1K", "2K"], "2K") } }),
    cost: { schedule: perOutput(["resolution"], { "1K": 12, "2K": 12 }), note: "KIE price list: wan 2.7 image pro = 12 credits per image." },
  },
  {
    id: "recraft-upscale", tool: "edit", name: "Recraft Crisp Upscale", family: "Recraft", variant: "Crisp Upscale", badges: ["budget"], sort: 270,
    purpose: "Sharpens and enlarges one image (no prompt needed).",
    kie: { model: "recraft/crisp-upscale", adapter: "kie-recraft-image", docs: docs("market/recraft/crisp-upscale") },
    spec: editSpec({ refs: 1, options: {}, prompt: { min: 0, max: 0 }, fixed: { tool: "Upscales the image; no prompt is used." } }),
    cost: { schedule: perOutput([], { "": 0.5 }), note: "KIE price list: Recraft Crisp Upscale = 0.5 credits per image." },
  },
  {
    id: "recraft-remove-background", tool: "edit", name: "Recraft Remove Background", family: "Recraft", variant: "Remove Background", badges: ["budget"], sort: 271,
    purpose: "Removes the background of one image and returns a transparent PNG (no prompt needed).",
    kie: { model: "recraft/remove-background", adapter: "kie-recraft-image", docs: docs("market/recraft/remove-background") },
    spec: { ...editSpec({ refs: 1, options: {}, prompt: { min: 0, max: 0 }, fixed: { tool: "Removes the background; no prompt is used. Images up to 5 MB and 4096 px." } }),
      references: { min: 1, max: 1, mime: IMG, maxBytes: 5 * 1024 * 1024 } },
    cost: { schedule: perOutput([], { "": 1 }), note: "KIE price list: Recraft Remove Background = 1 credit per image." },
  },
];
