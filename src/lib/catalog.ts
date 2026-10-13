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
    promptPlaceholder: "A glowing tent on frosty rocks beneath the Milky Way, long exposure…",
    starters: [
      "Sequin gown on a beach at blue hour",
      "Product shot on a snowy summit at sunrise",
      "Character sheet: front, side and back views",
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
    promptPlaceholder: "A wolf pup in silver armour stands in a foggy meadow, the camera slowly pulls back…",
    starters: ["Armoured pup in a foggy meadow", "Product turntable, soft light", "Slow drift over a night landscape"],
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
 * Curated examples. Most media are client-supplied files (Genlixs Drive); the abstract loop and
 * the dune edit pair are still placeholders. Prompts are *prompt ideas* written to match each
 * file and settings are the recipe "Use prompt" loads — neither is the recorded prompt or
 * settings of the original generation. Replace with validated outputs plus their real
 * prompt/settings records before launch (guide §14).
 */
export const EXAMPLES: Example[] = [
  {
    id: "ex-drive-thru",
    tool: "image",
    title: "Neon drive-thru at night",
    prompt: "A witch-themed drive-thru at night under a neon cauldron sign, a server in a navy uniform hands a green drink to a driver, wet car roof, cinematic wide frame",
    settings: { modelId: "img-standard", ratio: "16:9", quality: "High" },
    media: "driveThru",
  },
  {
    id: "ex-knight-clip",
    tool: "video",
    title: "Pup knight in the fog",
    prompt: "A wolf pup in silver armour holds a long sword in a foggy meadow, the camera pulls back to reveal an armoured knight standing behind it, cinematic, slow pace",
    settings: { modelId: "vid-short", ratio: "16:9", duration: 10, resolution: "720p" },
    media: "knightClip",
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
    id: "ex-forest-flare",
    tool: "image",
    title: "Red flare in a misty forest",
    prompt: "Two hooded figures face each other in a misty forest at dusk, one holding a burning red flare, fallen leaves, cinematic haze, vertical frame",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "forestFlare",
  },
  {
    id: "ex-sea-gown",
    tool: "image",
    title: "Sequin gown at blue hour",
    prompt: "A woman in a silver sequin gown with a long train on a dark beach at blue hour, small island on the horizon, moonlight on the water, editorial fashion photo",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "seaGown",
  },
  {
    id: "ex-garden",
    tool: "image",
    title: "Garden portrait for stories",
    prompt: "A red-haired woman in a white cotton dress with a leather crossbody bag stands in a rose garden, soft daylight, vertical story frame",
    settings: { modelId: "img-standard", ratio: "9:16", quality: "High" },
    media: "garden",
  },
  {
    id: "ex-summit-bag",
    tool: "image",
    title: "Sleeping bag on the summit",
    prompt: "A red and green down sleeping bag on a foam mat at a snowy summit at sunrise, mountain range behind, outdoor product shot, no logos",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "summitBag",
  },
  {
    id: "ex-milky-tent",
    tool: "image",
    title: "Tent under the Milky Way",
    prompt: "A glowing tent pitched on frosty rocks beneath the Milky Way, patches of snow, long-exposure night sky, adventure photography",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "milkyTent",
  },
  {
    id: "ex-horned",
    tool: "image",
    title: "Four-eyed character portrait",
    prompt: "Studio portrait of a pale character with four green eyes, red horns and a glossy black collar on a deep blue backdrop, film grain",
    settings: { modelId: "img-standard", ratio: "2:3", quality: "High" },
    media: "horned",
  },
  {
    id: "ex-warrior-sheet",
    tool: "image",
    title: "Character sheet, three views",
    prompt: "Character turnaround of an armoured warrior with a spear and a quiver: front, side and back views on a plain white background, matching details in every view",
    settings: { modelId: "img-standard", ratio: "16:9", quality: "High" },
    media: "warriorSheet",
  },
  {
    id: "ex-earring",
    tool: "image",
    title: "Gold earring close-up",
    prompt: "Close-up of a woman with tousled dark hair wearing a sculptural gold earring and a black turtleneck, dark background, warm side light",
    settings: { modelId: "img-detail", ratio: "3:2", quality: "High" },
    media: "earring",
  },
  {
    id: "ex-sofa",
    tool: "image",
    title: "Candid phone moment",
    prompt: "A man with glasses and an olive overshirt scrolls his phone on a brown leather sofa by a window, autumn trees outside, candid creator-style vertical",
    settings: { modelId: "img-standard", ratio: "9:16", quality: "Standard" },
    media: "sofa",
  },
  {
    id: "ex-library",
    tool: "image",
    title: "Old-world study",
    prompt: "A dark wood-panelled study with hand-painted wallpaper, a leather armchair and an antique desk, tall window light, quiet atmosphere",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    media: "library",
  },
  {
    id: "ex-loop",
    tool: "video",
    title: "Orbit loop",
    prompt: "A glossy electric-blue torus slowly rotates while a lime sphere orbits through it, dark studio, seamless loop, calm pace",
    settings: { modelId: "vid-short", ratio: "16:9", duration: 5, resolution: "720p" },
    media: "loop",
  },
];

export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);
