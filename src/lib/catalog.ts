import type { MediaKey } from "./media";

/**
 * Catalog preview.
 *
 * The verified model catalog, prices and capability limits belong to the
 * Genlixs Project Blueprint v2.1, which was not supplied with this design
 * brief. Model slots below are capability-named placeholders so the UI can
 * be designed around real data shapes without inventing supplier names.
 * Replace this module with the server catalog before launch.
 */

export type ToolId = "image" | "edit" | "video";

export type Tool = {
  id: ToolId;
  label: string;
  railLabel: string;
  studioTitle: string;
  href: string;
  guestAction: string;
  summary: string;
  promptLabel: string;
  promptPlaceholder: string;
  starters: string[];
};

export const TOOLS: Record<ToolId, Tool> = {
  image: {
    id: "image",
    label: "Image",
    railLabel: "Image",
    studioTitle: "Image studio",
    href: "/studio/image",
    guestAction: "Open image studio",
    summary: "Turn a written idea into a still image.",
    promptLabel: "Describe the image",
    promptPlaceholder: "A quiet desert at dusk, layered dunes, low sun, soft film grain…",
    starters: [
      "Product on a cream pedestal, soft studio light",
      "Layered dunes at dusk, wide frame",
      "Glossy spheres on a pale floor, calm composition",
    ],
  },
  edit: {
    id: "edit",
    label: "Edit image",
    railLabel: "Edit",
    studioTitle: "Edit studio",
    href: "/studio/edit",
    guestAction: "Open edit studio",
    summary: "Change a reference image with a written instruction.",
    promptLabel: "Describe the change",
    promptPlaceholder: "Change the scene to a warm dusk with a low sun…",
    starters: ["Change the time of day to dusk", "Replace the background with a plain studio wall", "Make the colors warmer"],
  },
  video: {
    id: "video",
    label: "Video",
    railLabel: "Video",
    studioTitle: "Video studio",
    href: "/studio/video",
    guestAction: "Open video studio",
    summary: "Generate a short clip from a written scene.",
    promptLabel: "Describe the clip",
    promptPlaceholder: "Aurora curtains drift slowly over a dark ridge, still lake reflection…",
    starters: ["Slow drift over a night landscape", "Product turntable, soft light", "Clouds moving over dunes"],
  },
};

export const TOOL_ORDER: ToolId[] = ["image", "edit", "video"];

export type Availability = "available" | "experimental" | "maintenance";

export type ModelSlot = {
  id: string;
  tool: ToolId;
  name: string;
  purpose: string;
  availability: Availability;
  availabilityNote?: string;
  ratios: string[];
  qualities?: string[];
  durations?: number[];
  resolutions?: string[];
  audio?: boolean;
  /** Demo pricing inputs — replaced by the server quote in production. */
  baseCredits: number;
};

export const MODELS: ModelSlot[] = [
  {
    id: "img-standard",
    tool: "image",
    name: "Standard image",
    purpose: "Fast drafts and social posts. Good first choice for exploring an idea.",
    availability: "available",
    ratios: ["1:1", "3:2", "2:3", "16:9", "9:16"],
    qualities: ["Standard", "High"],
    baseCredits: 4,
  },
  {
    id: "img-detail",
    tool: "image",
    name: "High-detail image",
    purpose: "Product shots and close-ups where texture and edges matter.",
    availability: "available",
    ratios: ["1:1", "3:2", "2:3", "4:5"],
    qualities: ["Standard", "High"],
    baseCredits: 8,
  },
  {
    id: "edit-reference",
    tool: "edit",
    name: "Reference edit",
    purpose: "Keeps the composition of your reference while applying the change you describe.",
    availability: "available",
    ratios: ["Original"],
    qualities: ["Standard", "High"],
    baseCredits: 6,
  },
  {
    id: "vid-short",
    tool: "video",
    name: "Short video",
    purpose: "Five or ten second clips for social posts and previews.",
    availability: "available",
    ratios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    baseCredits: 40,
  },
  {
    id: "vid-cinematic",
    tool: "video",
    name: "Cinematic video",
    purpose: "Slower camera movement and optional ambient audio for longer reads.",
    availability: "experimental",
    availabilityNote: "Experimental: results vary more and may take longer.",
    ratios: ["16:9", "9:16"],
    durations: [5, 10],
    resolutions: ["1080p"],
    audio: true,
    baseCredits: 60,
  },
  {
    id: "vid-extended",
    tool: "video",
    name: "Extended video",
    purpose: "Longer clips for storytelling.",
    availability: "maintenance",
    availabilityNote: "Under maintenance. Jobs already submitted are not affected.",
    ratios: ["16:9"],
    durations: [10],
    resolutions: ["1080p"],
    baseCredits: 90,
  },
];

export const modelsFor = (tool: ToolId) => MODELS.filter((m) => m.tool === tool);
export const modelById = (id: string) => MODELS.find((m) => m.id === id);
export const defaultModel = (tool: ToolId) => modelsFor(tool).find((m) => m.availability === "available")!;

export type Settings = {
  modelId: string;
  ratio: string;
  quality?: string;
  duration?: number;
  resolution?: string;
  audio?: boolean;
};

export const defaultSettings = (tool: ToolId): Settings => {
  const m = defaultModel(tool);
  return {
    modelId: m.id,
    ratio: m.ratios[tool === "image" ? 1 : 0],
    quality: m.qualities?.[0],
    duration: m.durations?.[0],
    resolution: m.resolutions?.[0],
    audio: m.audio ? false : undefined,
  };
};

/** Keep settings valid when the model changes (capability-driven controls). */
export const reconcileSettings = (s: Settings, model: ModelSlot): Settings => ({
  modelId: model.id,
  ratio: model.ratios.includes(s.ratio) ? s.ratio : model.ratios[0],
  quality: model.qualities ? (s.quality && model.qualities.includes(s.quality) ? s.quality : model.qualities[0]) : undefined,
  duration: model.durations ? (s.duration && model.durations.includes(s.duration) ? s.duration : model.durations[0]) : undefined,
  resolution: model.resolutions
    ? s.resolution && model.resolutions.includes(s.resolution)
      ? s.resolution
      : model.resolutions[0]
    : undefined,
  audio: model.audio ? Boolean(s.audio) : undefined,
});

/**
 * DEMO quote. Production replaces this with an authenticated server quote
 * that carries a price version and expiry (blueprint-governed).
 */
export const demoQuote = (s: Settings): number => {
  const m = modelById(s.modelId);
  if (!m) return 0;
  let c = m.baseCredits;
  if (s.quality === "High") c = Math.round(c * 1.5);
  if (s.duration === 10) c *= 2;
  if (s.resolution === "1080p" && m.resolutions && m.resolutions.length > 1) c = Math.round(c * 1.25);
  if (s.audio) c += 12;
  return c;
};

export const QUOTE_TTL_MS = 10 * 60 * 1000;

export const settingsSummary = (s: Settings): string => {
  const m = modelById(s.modelId);
  return [m?.name, s.ratio !== "Original" ? s.ratio : "Original ratio", s.quality, s.duration ? `${s.duration}s` : undefined, s.resolution, s.audio ? "Audio" : undefined]
    .filter(Boolean)
    .join(" · ");
};

export type Example = {
  id: string;
  tool: ToolId;
  title: string;
  prompt: string;
  settings: Settings;
  media: MediaKey;
  reference?: MediaKey;
  note?: string;
};

/**
 * Curated examples. Media are placeholders and prompts are *prompt ideas* written to match
 * them — not the recorded prompts of a generation. Replace with validated outputs plus their
 * real prompt/settings records before launch (guide §14).
 */
export const EXAMPLES: Example[] = [
  {
    id: "ex-torus",
    tool: "image",
    title: "Electric torus, lime core",
    prompt: "Glossy electric-blue torus floating above a dark studio floor, a lime sphere passing through its centre, soft rim light, product-render look, vertical frame",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "torus",
  },
  {
    id: "ex-pills",
    tool: "image",
    title: "Capsule trio for stories",
    prompt: "Three tall glossy capsules in lime, electric blue and white standing on a dark floor, blue studio glow, vertical story frame",
    settings: { modelId: "img-standard", ratio: "9:16", quality: "High" },
    media: "pills",
  },
  {
    id: "ex-orbs",
    tool: "image",
    title: "Orbs on a night floor",
    prompt: "Lime, chrome, electric-blue and white spheres with a white ring on a dark reflective floor, cinematic blue glow, wide frame",
    settings: { modelId: "img-standard", ratio: "3:2", quality: "High" },
    media: "orbs",
  },
  {
    id: "ex-loop",
    tool: "video",
    title: "Orbit loop",
    prompt: "A glossy electric-blue torus slowly rotates while a lime sphere orbits through it, dark studio, seamless loop, calm pace",
    settings: { modelId: "vid-short", ratio: "16:9", duration: 5, resolution: "720p" },
    media: "loop",
  },
  {
    id: "ex-dunes",
    tool: "image",
    title: "Dusk over layered dunes",
    prompt: "A quiet desert at dusk, layered dunes fading into haze, low pale sun, violet sky, soft film grain, wide frame",
    settings: { modelId: "img-standard", ratio: "3:2", quality: "High" },
    media: "dunesDusk",
  },
  {
    id: "ex-edit-dusk",
    tool: "edit",
    title: "Midday reference → dusk",
    prompt: "Change the scene to a warm dusk with a low sun; keep the dune shapes",
    settings: { modelId: "edit-reference", ratio: "Original", quality: "Standard" },
    media: "dunesDusk",
    reference: "dunesNoon",
  },
  {
    id: "ex-aurora-clip",
    tool: "video",
    title: "Aurora drift",
    prompt: "Aurora curtains drift slowly over a dark mountain ridge, still lake reflection, stars, calm pace",
    settings: { modelId: "vid-short", ratio: "16:9", duration: 5, resolution: "720p" },
    media: "auroraClip",
  },
  {
    id: "ex-product",
    tool: "image",
    title: "Amber bottle on a pedestal",
    prompt: "Amber glass bottle with a black cap on a cream cylinder pedestal, soft warm studio light, blank label, square crop",
    settings: { modelId: "img-detail", ratio: "1:1", quality: "High" },
    media: "product",
  },
  {
    id: "ex-aurora-still",
    tool: "image",
    title: "Vertical aurora for stories",
    prompt: "Green and violet aurora above a mountain ridge reflected in a lake, vertical frame for stories",
    settings: { modelId: "img-standard", ratio: "9:16", quality: "Standard" },
    media: "auroraVertical",
  },
  {
    id: "ex-dunes-noon",
    tool: "image",
    title: "Midday dunes, wide sky",
    prompt: "Pale sand dunes at midday under a clear blue sky, small white sun, gentle ripples in the foreground",
    settings: { modelId: "img-standard", ratio: "1:1", quality: "Standard" },
    media: "dunesNoon",
  },
  {
    id: "ex-spheres",
    tool: "image",
    title: "Pastel studio spheres",
    prompt: "Four glossy spheres, orange, chrome, lime and violet, on a pale studio floor, soft shadows, calm composition",
    settings: { modelId: "img-standard", ratio: "3:2", quality: "Standard" },
    media: "spheres",
  },
];

export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);
