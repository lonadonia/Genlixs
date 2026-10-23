// Supplier offers of the full catalog (APIMart, NezhaGate, PoYo; documentation and public price lists read 22 Oct 2026).
// An offer is written only where the supplier's documented request covers a Genlixs model's settings exactly and its
// documented price is below the KIE reference for at least one setting (build.mjs checks both). Every offer is created
// switched off: the owner activates it in /admin/providers ("Documented, not live-tested") or verifies it with a live
// test. Customer prices never come from here: they follow the KIE reference under the global pricing policy.

const CHECKED = "2026-10-22";
const APIMART_DOCS = (path) => `https://docs.apimart.ai/en/api-reference/${path}`;
const APIMART_PRICES = "https://apimart.ai/pricing";
const POYO = (page) => ({ docs: `https://poyo.ai/models/${page}/llms.txt`, source: `https://poyo.ai/models/${page}` });
const NEZHA = (page) => ({ docs: `https://nezhagate.com/en/docs/${page}`, source: `https://nezhagate.com/model/${page}` });

/** APIMart sells in credits, 10 per USD at the Gold tier (the account's tier); rates below are written in credits. */
const apimart = (usd) => Math.round(usd * 10 * 1e7) / 1e7;
const rates = (dimsValues, fn) => Object.fromEntries(dimsValues.map((k) => [k, fn(k)]));

const AR5 = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const AR8 = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];
const AR10 = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"];
const KLEIN = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"];
const perSecond = (dims, r, seconds = "duration") => ({ basis: "output_second", dims, rates: r, seconds: { option: seconds } });
const perOutput = (dims, r) => ({ basis: "output", dims, rates: r });

const SEEDANCE_SLOTS = { first_frame: { max: 1 }, last_frame: { max: 1 }, reference_images: { max: 9 }, reference_audio: { max: 3, maxTotalSeconds: 15 } };
const SEEDANCE_DURATIONS = [4, 5, 6, 8, 10, 12, 15];
const SEEDANCE_AR = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const WAN3_SLOTS = { first_frame: { max: 1 }, last_frame: { max: 1 }, reference_images: { max: 10 }, reference_videos: { max: 5, maxTotalSeconds: 15 },
  reference_audio: { max: 5, maxTotalSeconds: 15 } };

export const OFFERS = [
  // ------------------------------------------------------------------------------------------------ APIMart video
  {
    provider: "apimart", key: "seedance-2-0", label: "Seedance 2.0", model: "seedance-2-0", tool: "video", operation: "create",
    upstream: "seedance-2.0", adapter: "apimart-video", docs: APIMART_DOCS("videos/seedance-2-0/generation"), source: APIMART_PRICES,
    caps: {
      options: { audio: ["on", "off"], resolution: ["480p", "720p", "1080p", "4k"], duration: SEEDANCE_DURATIONS, aspect_ratio: SEEDANCE_AR,
        with_video: ["no"], billed: { min: 4, max: 15 } },
      modes: ["text", "frames", "reference"], inputs: SEEDANCE_SLOTS, maxPromptChars: 4000,
      notes: ["Reference videos stay on KIE: the price of APIMart's video-input tier is per second of an undocumented total"],
    },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "480p": apimart(0.066), "720p": apimart(0.142), "1080p": apimart(0.3544), "4k": apimart(0.722) }),
    assumptions: "Gold tier, per output second; sound does not change the price. Requests with reference videos are not sent here.",
  },
  {
    provider: "apimart", key: "seedance-2-mini", label: "Seedance 2.0 Mini", model: "seedance-2-0-mini", tool: "video", operation: "create",
    upstream: "seedance-2.0-mini", adapter: "apimart-video", docs: APIMART_DOCS("videos/seedance-2-0/generation"), source: APIMART_PRICES,
    caps: {
      options: { audio: ["on", "off"], resolution: ["480p", "720p"], duration: SEEDANCE_DURATIONS, aspect_ratio: SEEDANCE_AR, with_video: ["no"], billed: { min: 4, max: 15 } },
      modes: ["text", "frames", "reference"], inputs: SEEDANCE_SLOTS,
      notes: ["Reference videos stay on KIE (video-input billing basis not documented)"],
    },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "480p": apimart(0.0181512), "720p": apimart(0.0390344) }),
    assumptions: "Gold tier, per output second. Requests with reference videos are not sent here.",
  },
  {
    provider: "apimart", key: "wan2.6", label: "Wan 2.6 text to video", model: "wan-2-6", tool: "video", operation: "create",
    upstream: "wan2.6", adapter: "apimart-wan", docs: APIMART_DOCS("videos/wan2.6/generation"), source: APIMART_PRICES,
    caps: { options: { duration: [5, 10, 15], resolution: ["720p", "1080p"] }, modes: ["text"],
      notes: ["Text to video only: the start-frame price on this page is not stated separately"] },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "720p": apimart(0.05), "1080p": apimart(0.084) }),
    assumptions: "Gold tier, per output second (720p is the page's default tier).",
    gap: "Whether sound is added when the audio field is left out is not documented (the KIE route's default is not documented either).",
  },
  {
    provider: "apimart", key: "wan-2.6-flash", label: "Wan 2.6 Flash image to video", model: "wan-2-6-flash", tool: "video", operation: "create",
    upstream: "wan2.6-i2v-flash", adapter: "apimart-wan", docs: APIMART_DOCS("videos/wan2.6/i2v-flash-generation"), source: APIMART_PRICES,
    caps: { options: { audio: ["off", "on"], resolution: ["720p", "1080p"], duration: [5, 10, 15] }, modes: ["image"], inputs: { first_frame: { max: 1 } },
      notes: ["Reference videos stay on KIE"] },
    unit: "apimart_credit",
    schedule: perSecond(["resolution", "audio"], { "720p|off": apimart(0.0168), "720p|on": apimart(0.0336), "1080p|off": apimart(0.028), "1080p|on": apimart(0.0552) }),
    assumptions: "Gold tier, per output second, sound priced separately.",
  },
  {
    provider: "apimart", key: "wan-2.7", label: "Wan 2.7 (text, frames, reference images)", model: "wan-2-7", tool: "video", operation: "create",
    upstream: "wan2.7;reference=wan2.7-r2v", adapter: "apimart-wan", docs: APIMART_DOCS("videos/wan2.7/generation"), source: APIMART_PRICES,
    caps: { options: { resolution: ["720p", "1080p"], duration: [2, 5, 8, 10, 15], aspect_ratio: AR5 }, modes: ["text", "frames", "reference"],
      inputs: { first_frame: { max: 1 }, last_frame: { max: 1 }, reference_images: { max: 5 } }, notes: ["Reference images use the wan2.7-r2v page (same price)"] },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "720p": apimart(0.0664), "1080p": apimart(0.1096) }),
    assumptions: "Gold tier, per output second; wan2.7 and wan2.7-r2v have the same price.",
  },
  {
    provider: "apimart", key: "wan2.7-videoedit", label: "Wan 2.7 video edit", model: "wan-2-7-edit", tool: "video", operation: "edit",
    upstream: "wan2.7-videoedit", adapter: "apimart-wan", docs: APIMART_DOCS("videos/wan2.7-videoedit/generation"), source: APIMART_PRICES,
    caps: { options: { resolution: ["720p", "1080p"], audio_setting: ["auto", "origin"], seconds: { min: 2, max: 10 } }, modes: ["edit"],
      inputs: { source_video: { max: 1 }, reference_image: { max: 1 } } },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "720p": apimart(0.0664), "1080p": apimart(0.1096) }, "seconds"),
    assumptions: "Gold tier; with duration 0 the output keeps the source length and is billed on it.",
  },
  ...[
    { model: "wan-3-0", key: "wan-3.0", label: "Wan 3.0", upstream: "wan3.0-video", usd: [0.03288, 0.065752, 0.131504] },
    { model: "wan-3-0-prime", key: "wan-3.0-prime", label: "Wan 3.0 Prime", upstream: "wan3.0-video-prime", usd: [0.0514288, 0.1028568, 0.2057144] },
  ].map((w) => ({
    provider: "apimart", key: w.key, label: w.label, model: w.model, tool: "video", operation: "create", upstream: w.upstream, adapter: "apimart-wan",
    docs: APIMART_DOCS("videos/wan3.0-video/generation"), source: APIMART_PRICES,
    caps: {
      options: { audio: ["on", "off"], resolution: ["480P", "720P", "1080P"], duration: [2, 5, 8, 10, 15, 20, 30], aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"],
        billed: { min: 2, max: 30 } },
      modes: ["text", "frames", "reference", "video", "audio"], inputs: WAN3_SLOTS,
      notes: ["Billed on the requested length only; reference videos are not billed on this route"],
    },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "480P": apimart(w.usd[0]), "720P": apimart(w.usd[1]), "1080P": apimart(w.usd[2]) }),
    assumptions: "Gold tier, per second of the requested length; the page states the price is the same with or without sound.",
  })),
  {
    provider: "apimart", key: "pixverse-v6", label: "PixVerse V6", model: "pixverse-v6", tool: "video", operation: "create",
    upstream: "pixverse-v6", adapter: "apimart-pixverse", docs: APIMART_DOCS("videos/pixverse-v6/generation"), source: APIMART_PRICES,
    caps: {
      options: { audio: ["off", "on"], resolution: ["360p", "540p", "720p", "1080p"], duration: [3, 5, 8, 10, 15], aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "2:3", "3:2"] },
      modes: ["text", "image", "reference"], inputs: { first_frame: { max: 1 }, reference_images: { max: 7 } },
      notes: ["Transitions stay on KIE (this page allows only 5 or 8 s)", "No 21:9"],
    },
    unit: "apimart_credit",
    schedule: perSecond(["resolution", "audio"], {
      "360p|off": apimart(0.016), "360p|on": apimart(0.024), "540p|off": apimart(0.024), "540p|on": apimart(0.032),
      "720p|off": apimart(0.032), "720p|on": apimart(0.04), "1080p|off": apimart(0.064), "1080p|on": apimart(0.08),
    }),
    assumptions: "Gold tier, per output second, sound priced separately.",
  },
  {
    provider: "apimart", key: "happyhorse-1.0", label: "HappyHorse 1.0", model: "happyhorse-1-0", tool: "video", operation: "create",
    upstream: "happyhorse-1.0", adapter: "apimart-happyhorse", docs: APIMART_DOCS("videos/happyhorse-1.0/generation"), source: APIMART_PRICES,
    caps: { options: { resolution: ["720p", "1080p"], duration: [3, 5, 8, 10, 15], aspect_ratio: AR5 }, modes: ["text", "image", "reference"],
      inputs: { first_frame: { max: 1 }, reference_images: { max: 9 } }, maxPromptChars: 2500 },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "720p": apimart(0.13), "1080p": apimart(0.23) }),
    assumptions: "Gold tier, per output second.",
  },
  {
    provider: "apimart", key: "happyhorse-1.0/edit", label: "HappyHorse 1.0 video edit", model: "happyhorse-1-0-edit", tool: "video", operation: "edit",
    upstream: "happyhorse-1.0", adapter: "apimart-happyhorse", docs: APIMART_DOCS("videos/happyhorse-1.0/generation"), source: APIMART_PRICES,
    caps: { options: { resolution: ["720p", "1080p"], audio_setting: ["auto", "origin"], seconds: { min: 3, max: 15 } }, modes: ["edit"],
      inputs: { source_video: { max: 1 }, reference_images: { max: 5 } }, maxPromptChars: 2500,
      notes: ["Sources over 15 s stay on KIE: this route truncates them to 15 s"] },
    unit: "apimart_credit", schedule: perSecond(["resolution"], { "720p": apimart(0.13), "1080p": apimart(0.23) }, "seconds"),
    assumptions: "Gold tier edit price, per second of the output (which follows the source).",
  },

  // ------------------------------------------------------------------------------------------------ APIMart images
  ...[
    { model: "seedream-4-image", key: "seedream-4", label: "Seedream 4.0", upstream: "seedream-4.0", page: "images/seedream-4/generation",
      options: { resolution: ["1K", "2K", "4K"], aspect_ratio: AR8 }, dims: ["resolution"], rates: { "1K": 0.0195, "2K": 0.0195, "4K": 0.0195 }, maxPromptChars: 1000 },
    { model: "seedream-4-5-image", key: "seedream-4.5", label: "Seedream 4.5", upstream: "seedream-4.5", page: "images/seedream-4.5/generation",
      options: { quality: ["basic", "high"], aspect_ratio: AR8 }, dims: ["quality"], rates: { basic: 0.026, high: 0.026 } },
    { model: "seedream-5-pro-image", key: "seedream-5-pro", label: "Seedream 5.0 Pro", upstream: "seedream-5-0-pro", page: "images/seedream-5-0-pro/generation",
      options: { quality: ["basic", "high"], aspect_ratio: AR8 }, dims: ["quality"], rates: { basic: 0.02925, high: 0.0585 } },
    { model: "qwen-image-3-image", key: "qwen-image-3", label: "Qwen Image 3.0", upstream: "qwen-image-3.0", page: "images/qwen-image-3.0/generation",
      options: { resolution: ["1K", "2K"], aspect_ratio: AR8.filter((r) => r !== "21:9") }, dims: ["resolution"], rates: { "1K": 0.0205712, "2K": 0.0205712 } },
    { model: "qwen-image-3-pro-image", key: "qwen-image-3-pro", label: "Qwen Image 3.0 Pro", upstream: "qwen-image-3.0-pro", page: "images/qwen-image-3.0/generation",
      options: { resolution: ["1K", "2K"], aspect_ratio: AR8.filter((r) => r !== "21:9") }, dims: ["resolution"], rates: { "1K": 0.0285712, "2K": 0.0571432 } },
    { model: "flux-3-klein-image", key: "flux-3-image-klein", label: "FLUX 3 Klein", upstream: "flux-3-image-klein", page: "images/flux-3-image-klein/generation",
      options: { resolution: ["1K", "2K", "4K"], aspect_ratio: KLEIN }, dims: ["resolution"], rates: { "1K": 0.0072, "2K": 0.0112, "4K": 0.0288 } },
  ].map((m) => ({
    provider: "apimart", key: m.key, label: m.label, model: m.model, tool: "image", operation: "text_to_image", upstream: m.upstream, adapter: "apimart-image-v2",
    docs: APIMART_DOCS(m.page), source: APIMART_PRICES,
    caps: { options: m.options, ...(m.maxPromptChars ? { maxPromptChars: m.maxPromptChars } : {}) },
    unit: "apimart_credit", schedule: perOutput(m.dims, rates(Object.keys(m.rates), (k) => apimart(m.rates[k]))),
    assumptions: "Gold tier, per image.",
  })),
  {
    provider: "apimart", key: "flux-3-image-klein/edit", label: "FLUX 3 Klein edit", model: "flux-3-klein-edit", tool: "edit", operation: "image_edit",
    upstream: "flux-3-image-klein", adapter: "apimart-image-v2", docs: APIMART_DOCS("images/flux-3-image-klein/generation"), source: APIMART_PRICES,
    caps: { options: { resolution: ["1K", "2K", "4K"], aspect_ratio: ["auto", ...KLEIN] }, inputs: { _references: { max: 10 } } },
    unit: "apimart_credit", schedule: perOutput(["resolution"], { "1K": apimart(0.0072), "2K": apimart(0.0112), "4K": apimart(0.0288) }),
    assumptions: "Gold tier, per image; the page states editing costs the same and reference images are free.",
  },

  // ------------------------------------------------------------------------------------------------ NezhaGate
  ...[
    { model: "nano-banana-2-image", key: "nano-banana-2", label: "Nano Banana 2", upstream: "nano-banana-2", tool: "image" },
    { model: "nano-banana-2-edit", key: "nano-banana-2/edit", label: "Nano Banana 2 edit", upstream: "nano-banana-2", tool: "edit" },
    { model: "nano-banana-2-1-image", key: "nano-banana-2.1", label: "Nano Banana 2.1", upstream: "nano-banana-2.1", tool: "image" },
    { model: "nano-banana-2-1-edit", key: "nano-banana-2.1/edit", label: "Nano Banana 2.1 edit", upstream: "nano-banana-2.1", tool: "edit" },
  ].map((m) => ({
    provider: "nezhagate", key: m.key, label: m.label, model: m.model, tool: m.tool, operation: m.tool === "edit" ? "image_edit" : "text_to_image",
    upstream: m.upstream, adapter: "nezhagate-image", ...NEZHA(m.upstream),
    caps: { options: { resolution: ["1K", "2K", "4K"], aspect_ratio: AR10 }, ...(m.tool === "edit" ? { inputs: { _references: { max: 8 } } } : {}),
      notes: m.tool === "edit" ? ["No automatic aspect ratio", "Up to 8 reference images"] : ["One image per job"] },
    unit: "usd", schedule: perOutput(["resolution"], { "1K": 0.015, "2K": 0.025, "4K": 0.04 }),
    assumptions: "Per image by tier; text-to-image and editing cost the same; failed jobs are refunded in full.",
  })),
  {
    provider: "nezhagate", key: "seedance-2.0", label: "Seedance 2.0", model: "seedance-2-0", tool: "video", operation: "create",
    upstream: "seedance-2.0", adapter: "nezhagate-video", ...NEZHA("seedance-2.0"),
    caps: {
      options: { audio: ["on"], resolution: ["480p", "720p", "1080p"], duration: [5, 6, 8, 10, 12, 15], aspect_ratio: AR5, with_video: ["no"], billed: { min: 5, max: 15 } },
      modes: ["text", "reference"], inputs: { reference_images: { max: 9 }, reference_audio: { max: 3, maxTotalSeconds: 15 } },
      notes: ["Sound is always on", "Reference images are never frames", "Reference videos stay on KIE (field not covered by this integration)"],
    },
    unit: "usd", schedule: perSecond(["resolution"], { "480p": 0.07, "720p": 0.15, "1080p": 0.2 }),
    assumptions: "Per output second; failed jobs are refunded in full. NezhaGate reports a 61 % success rate for this model over 30 days.",
  },

  // ------------------------------------------------------------------------------------------------ PoYo
  {
    provider: "poyo", key: "kling-2.6-motion-control", label: "Kling 2.6 Motion Control", model: "kling-2-6-motion", tool: "video", operation: "motion",
    upstream: "kling-2.6-motion-control", adapter: "poyo-kling-motion", ...POYO("kling-2-6-motion-control"),
    caps: {
      options: { mode: ["720p", "1080p"], orientation: ["video", "image"], seconds: { min: 3, max: 30 } }, modes: ["motion"],
      inputs: { motion_video: { max: 1, maxTotalSeconds: 30 }, character_image: { max: 1 } }, maxPromptChars: 2500,
    },
    unit: "poyo_credit", schedule: perSecond(["mode"], { "720p": 8, "1080p": 12 }, "seconds"),
    assumptions: "Per second of the motion video (the output follows its length), 200 credits per USD.",
  },
  {
    provider: "poyo", key: "wan-2.7", label: "Wan 2.7 (text, frames, reference images)", model: "wan-2-7", tool: "video", operation: "create",
    upstream: "wan2.7-text-to-video;frames=wan2.7-image-to-video;reference=wan2.7-reference-to-video", adapter: "poyo-wan-2-7", ...POYO("wan-2-7-video"),
    caps: { options: { resolution: ["720p", "1080p"], duration: [5, 10, 15], aspect_ratio: AR5 }, modes: ["text", "frames", "reference"],
      inputs: { first_frame: { max: 1 }, last_frame: { max: 1 }, reference_images: { max: 5 } },
      notes: ["5, 10 or 15 s: text to video takes only these lengths on PoYo"] },
    unit: "poyo_credit", schedule: perSecond(["resolution"], { "720p": 12, "1080p": 18 }),
    assumptions: "Per output second, 200 credits per USD.",
  },
  {
    provider: "poyo", key: "wan2.7-edit-video", label: "Wan 2.7 video edit", model: "wan-2-7-edit", tool: "video", operation: "edit",
    upstream: "wan2.7-edit-video", adapter: "poyo-wan-2-7", ...POYO("wan-2-7-video"),
    caps: { options: { resolution: ["720p", "1080p"], audio_setting: ["auto", "origin"], seconds: { min: 2, max: 10 } }, modes: ["edit"],
      inputs: { source_video: { max: 1 }, reference_image: { max: 1 } } },
    unit: "poyo_credit", schedule: perSecond(["resolution"], { "720p": 12, "1080p": 18 }, "seconds"),
    assumptions: "Per output second; with duration 0 PoYo uses the source length. 200 credits per USD.",
  },
  {
    provider: "poyo", key: "happy-horse", label: "HappyHorse 1.0", model: "happyhorse-1-0", tool: "video", operation: "create",
    upstream: "happy-horse", adapter: "poyo-happyhorse", ...POYO("happy-horse"),
    caps: { options: { resolution: ["720p", "1080p"], duration: [3, 5, 8, 10, 15], aspect_ratio: AR5 }, modes: ["text", "image", "reference"],
      inputs: { first_frame: { max: 1 }, reference_images: { max: 9 } }, maxPromptChars: 2500 },
    unit: "poyo_credit", schedule: perSecond(["resolution"], { "720p": 16, "1080p": 32 }),
    assumptions: "Per output second, 200 credits per USD.",
  },
  {
    provider: "poyo", key: "happy-horse/edit", label: "HappyHorse 1.0 video edit", model: "happyhorse-1-0-edit", tool: "video", operation: "edit",
    upstream: "happy-horse", adapter: "poyo-happyhorse", ...POYO("happy-horse"),
    caps: { options: { resolution: ["720p", "1080p"], audio_setting: ["auto", "origin"], seconds: { min: 3, max: 15 } }, modes: ["edit"],
      inputs: { source_video: { max: 1 }, reference_images: { max: 5 } }, maxPromptChars: 2500,
      notes: ["Sources over 15 s stay on KIE: PoYo truncates them to 15 s"] },
    unit: "poyo_credit", schedule: perSecond(["resolution"], { "720p": 32, "1080p": 64 }, "seconds"),
    assumptions: "Video-edit rate per output second (the output follows the source), 200 credits per USD.",
  },
  {
    provider: "poyo", key: "gemini-omni-1.1-flash", label: "Gemini Omni 1.1 Flash", model: "gemini-omni-flash-1-1", tool: "video", operation: "create",
    upstream: "gemini-omni-1.1-flash", adapter: "poyo-gemini-omni", ...POYO("gemini-omni-1-1-flash"),
    caps: { options: { resolution: ["360p", "720p", "1080p", "4k"], duration: [4, 6, 8, 10], aspect_ratio: ["16:9", "9:16"] }, modes: ["text", "frames", "reference"],
      inputs: { first_frame: { max: 1 }, last_frame: { max: 1 }, reference_images: { max: 7 } } },
    unit: "poyo_credit",
    schedule: perOutput(["resolution", "duration"], Object.fromEntries(["360p", "720p", "1080p", "4k"].flatMap((r) =>
      [[4, 45, 105], [6, 60, 120], [8, 75, 135], [10, 90, 150]].map(([d, std, uhd]) => [`${r}|${d}`, r === "4k" ? uhd : std])))),
    assumptions: "Per video without video input, by length (4K priced separately), 200 credits per USD.",
  },
];

/** Request builders added for these offers (descriptions without semicolons: the contract test splits on them). */
export const SUPPLIER_ADAPTERS = {
  "apimart-wan": ["apimart", "APIMart Wan 2.6 / 2.6 Flash / 2.7 / 2.7-R2V / 2.7 video edit / 3.0 / 3.0 Prime (videos/generations)"],
  "apimart-pixverse": ["apimart", "APIMart PixVerse V6: text, image and multi-reference (videos/generations)"],
  "apimart-happyhorse": ["apimart", "APIMart HappyHorse 1.0: text, first frame, references and video edit (videos/generations)"],
  "apimart-image-v2": ["apimart", "APIMart Seedream 4.0 / 4.5 / 5.0 Pro, Qwen Image 3.0 / Pro and FLUX 3 Klein (images/generations)"],
  "poyo-wan-2-7": ["poyo", "PoYo Wan 2.7: text, image, reference and edit models (generate/submit)"],
  "poyo-happyhorse": ["poyo", "PoYo HappyHorse: text, image, reference and video edit (generate/submit)"],
  "poyo-gemini-omni": ["poyo", "PoYo Gemini Omni 1.1 Flash: text, first/last frame and reference images (generate/submit)"],
};

/** Prices that changed since 18 Oct on offers that already exist (a new version; the earlier ones stay for history). */
export const PRICE_UPDATES = [
  ...["gpt-image-2.5-flare", "gpt-image-2.5-flare/edit", "gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst/edit"].map((key) => ({
    provider: "nezhagate", key, unit: "usd", schedule: perOutput(["resolution"], { "1K": 0.005, "2K": 0.03, "4K": 0.05 }),
    source: `https://nezhagate.com/model/${key.replace("/edit", "")}`,
    assumptions: "Model list of 22 Oct 2026: 2K and 4K went up from $0.025 / $0.04 to $0.03 / $0.05 per image; 1K unchanged.",
  })),
];

/**
 * Research entries of 18 Oct (supplier products with no Genlixs model at the time) whose product is now a catalog model
 * but which are not integrated as an offer: linked to the model with the reason, so the "Add models" list stops offering
 * them and the coverage report can account for every one. The price verdict of 18 Oct is kept (null) unless a new one is
 * given here. Duomi entries are preserved as they are (not expanded).
 */
const DEARER = (what) => `Not integrated: ${what} (checked ${CHECKED}).`;
export const LINKS = [
  ["apimart", "flux-kontext", "flux-kontext-image", "dominated", DEARER("$0.032 Pro / $0.064 Max per image, dearer than the KIE route ($0.025 / $0.05)")],
  ["apimart", "z-image-turbo", "z-image", "dominated", DEARER("$0.01 per image, dearer than the KIE route ($0.004)")],
  ["apimart", "grok-imagine-image/standard", "grok-imagine-image", "dominated", DEARER("$0.016 per image, dearer than the KIE route ($0.01 per image, two per request)")],
  ["apimart", "grok-imagine-image/quality", "grok-imagine-image", "dominated", DEARER("$0.04 per image, dearer than the KIE route")],
  ["apimart", "gemini-omni-1.1-flash-ext", "gemini-omni-flash-1-1", null, DEARER("sold as a separate non-official channel; equivalence with the model is not documented")],
  ["apimart", "grok-video-1.5/ext", "grok-imagine-video-1-5", null, DEARER("sold as a separate non-official channel; no per-setting price")],
  ["apimart", "gpt-image-1.5", "gpt-image-1-5-image", null, DEARER("quality and token pricing not published per image")],
  ["apimart", "gpt-image-2/medium", "gpt-image-2-image", null, DEARER("non-official channel; quality mapping and 2K/4K prices conflict")],
  ["apimart", "minimax-h3", "minimax-h3", null, DEARER("per-version and per-resolution prices not captured")],
  ["apimart", "minimax-hailuo", "hailuo-2-3-standard", null, DEARER("covers Hailuo 02 and 2.3; per-version prices not captured")],
  ["apimart", "vidu-q4", "vidu-q4", null, DEARER("preview page without a callable price")],
  ["cuddler", "gpt-image-2/low", "gpt-image-2-image", null, DEARER("Cuddler's result download host is not documented (a live test is needed) and the price is a token estimate")],
  ["cuddler", "happyhorse", "happyhorse-1-0", null, DEARER("Cuddler's result download host is not documented and per-operation prices are not captured")],
  ["cuddler", "kling-2.6-pro", "kling-2-6", null, DEARER("$0.049/s at 1080p is below KIE, but Cuddler's result download host is not documented (a live test is needed)")],
  ["cuddler", "pixverse-v6", "pixverse-v6", "dominated", DEARER("$0.0315/s at 720p becomes $0.0332 with Cuddler's 5.5 % card funding fee, above APIMart ($0.032); Cuddler's result download host is not documented either")],
  ["cuddler", "runway-gen4-turbo", "runway-gen-4-turbo", null, DEARER("prices not captured and Cuddler's result download host is not documented")],
  ["cuddler", "seedance-2-0", "seedance-2-0", null, DEARER("below KIE and APIMart, but Cuddler's result download host is not documented (a live test is needed)")],
  ["cuddler", "seedream-5-lite/2k", "seedream-5-lite-image", "dominated", DEARER("$0.0245 per image becomes $0.0258 with Cuddler's 5.5 % card funding fee, above PoYo ($0.025); Cuddler's result download host is not documented either")],
  ["cuddler", "vidu-q4-preview", "vidu-q4", null, DEARER("a preview model; equivalence with Vidu Q4 not documented")],
  ["cuddler", "wan-3.0-prime", "wan-3-0-prime", null, DEARER("full tier, reference billing and audio unresolved")],
  ["nezhagate", "gpt-image-2/medium", "gpt-image-2-image", null, DEARER("quality tier equivalence with the KIE route is not documented and 4K is resized")],
  ["nezhagate", "grok-imagine-image/standard", "grok-imagine-image", "incompatible", DEARER("one image per request, while the KIE route returns two")],
  ["nezhagate", "grok-imagine-image/quality", "grok-imagine-image", "incompatible", DEARER("one image per request, while the KIE route returns two")],
  ["nezhagate", "grok-video-1.5", "grok-imagine-video-1-5", null, DEARER("per-resolution and per-length prices not captured")],
  ["nezhagate", "minimax-h3", "minimax-h3", null, DEARER("marketing and comparison rates conflict")],
  ["nezhagate", "wan-3.0", "wan-3-0", null, DEARER("within 1 % of the integrated APIMart offer; the NezhaGate Wan 3.0 request format was not reviewed in this release")],
  ["nezhagate", "wan-3.0-prime", "wan-3-0-prime", null, DEARER("$0.054 / $0.112 / $0.20 per second; the NezhaGate Wan 3.0 request format was not reviewed in this release")],
  ["poyo", "kling-2.5-turbo-pro", "kling-2-5-turbo", "dominated", DEARER("$0.21 per 5 s, the same as the KIE route")],
  ["poyo", "kling-o3", "kling-3-0-omni", null, DEARER("below KIE, but PoYo sells standard/pro tiers and their mapping to 720p/1080p is not documented")],
  ["poyo", "nano-banana-2.1", "nano-banana-2-1-image", "dominated", DEARER("$0.02 / $0.03 / $0.05, not below the KIE route or the NezhaGate offer")],
  ["poyo", "qwen-image-3", "qwen-image-3-image", "dominated", DEARER("$0.024 per image, the same as the KIE route")],
  ["poyo", "seedream-4.5", "seedream-4-5-image", null, DEARER("$0.025 per image is below KIE, but the output size options are not documented in the PoYo schema")],
  ["poyo", "seedream-5-lite/2k", "seedream-5-lite-image", null, DEARER("$0.025 per image is below KIE, but only the 2K size is priced and its options are not documented")],
  ["poyo", "vidu-q4", "vidu-q4", "dominated", DEARER("9 / 19 / 24 credits per second, dearer than the KIE route")],
];
