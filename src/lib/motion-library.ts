/**
 * Motion Library (contract-tested): client clips from the "EXPLORS" and "EXPLORS 2" hand-over folders that suit motion
 * transfer — one performer whose head, shoulders and torso stay visible in one continuous shot of 3–30 s, as the motion
 * reference must show (Kling 3.0 Motion Control, docs.kie.ai, re-read 18 Oct 2026). Only what is needed to show and
 * recreate an item is kept; no creator, prompt or model is claimed (none was supplied). Choices and exclusions are listed
 * in design-handoff/genlixs/CLIENT_MEDIA.md.
 *
 * Recreate puts the library clip itself into the Motion Control draft as the motion video (uploaded through the normal
 * private upload, so the server verifies the bytes like any upload), the customer's image as the character and their
 * prompt; the studio then prices the exact request and nothing runs until Generate.
 */
import { MEDIA, type MediaItem, type MediaKey } from "./media";
import type { CatalogModel, InputSlotSpec } from "./live/types";
import { effectiveOptions, slotMaxSeconds, type Draft } from "./live/video-studio";

export type MotionItem = {
  id: string;
  title: string;
  src: string;
  poster: string;
  /** Measured from the web file (ffprobe). */
  durationMs: number;
  width: number;
  height: number;
  source: "EXPLORS" | "EXPLORS 2";
  alt: string;
};

const item = (key: MediaKey, durationMs: number, source: MotionItem["source"]): MotionItem => {
  const m: MediaItem = MEDIA[key];
  return { id: m.id.replace(/^client-/, ""), title: m.title ?? m.alt, src: m.src, poster: m.poster ?? m.src, durationMs, width: m.width, height: m.height, source, alt: m.alt };
};

export const MOTION_LIBRARY: MotionItem[] = [
  item("pajamaDance", 17_042, "EXPLORS"),
  item("teeDance", 8_042, "EXPLORS 2"),
  item("doorwayDance", 10_042, "EXPLORS"),
  item("hairRollers", 14_049, "EXPLORS 2"),
  item("studioSessionSolo", 4_917, "EXPLORS 2"),
  item("leatherCoat", 10_064, "EXPLORS 2"),
  item("pinkKnitWalk", 15_042, "EXPLORS 2"),
  item("arcadeTote", 15_042, "EXPLORS 2"),
  item("cashFan", 15_045, "EXPLORS 2"),
];

export const motionItem = (id: string | null | undefined) => MOTION_LIBRARY.find((m) => m.id === id) ?? null;

export const fmtClip = (ms: number) => `0:${String(Math.round(ms / 1000)).padStart(2, "0")}`;

/** The motion-video and character-image slots of a motion model (by kind, from the model's own spec). */
export function motionSlots(model: CatalogModel | null): { video: [string, InputSlotSpec]; image: [string, InputSlotSpec] } | null {
  const entries = Object.entries(model?.inputs ?? {});
  const video = entries.find(([, s]) => s.kind === "video");
  const image = entries.find(([, s]) => s.kind === "image");
  return video && image ? { video, image } : null;
}

export type RecreatePlan = {
  modelId: string;
  videoSlot: string;
  imageSlot: string;
  options: Record<string, string | number>;
  prompt: string;
  notes: string[];
};

/**
 * What Recreate changes in the Motion Control draft, or why it cannot. The clip must fit the model's length limits;
 * when a setting (the orientation rule) is what blocks it, another allowed value is chosen and the customer is told.
 * The prompt is never dropped: a prompt the model cannot take is an error, not a silent cut.
 */
export function recreatePlan(model: CatalogModel | null, draft: Draft, clip: MotionItem, prompt: string): RecreatePlan | { error: string } {
  if (!model) return { error: "Motion Control is not available right now." };
  const slots = motionSlots(model);
  if (!slots) return { error: "This model does not take a motion video and a character image." };
  const [videoSlot, videoSpec] = slots.video;
  const notes: string[] = [];
  const options = { ...draft.options };
  const secs = (ms: number) => (ms / 1000).toFixed(1);

  if (videoSpec.minSeconds && clip.durationMs < videoSpec.minSeconds * 1000 - 50) return { error: `This clip is ${secs(clip.durationMs)} s; this model needs at least ${videoSpec.minSeconds} s.` };
  const effective = effectiveOptions(model, { ...draft, options });
  const fits = (opts: Record<string, string | number>) => {
    const { max } = slotMaxSeconds(model, videoSlot, videoSpec, opts);
    return !max || clip.durationMs <= max * 1000 + 50;
  };
  if (!fits(effective)) {
    const { max, message } = slotMaxSeconds(model, videoSlot, videoSpec, effective);
    // Try the other values of the setting a rule depends on (for example orientation).
    const keys = [...new Set((model.rules ?? []).filter((r) => r.slot === videoSlot).flatMap((r) => Object.keys(r.when)))];
    let fixed = false;
    for (const k of keys) {
      for (const v of model.options?.[k]?.values ?? []) {
        if (String(v) === String(effective[k]) || !fits({ ...effective, [k]: v })) continue;
        options[k] = v;
        const label = model.options[k].labels?.[String(v)] ?? String(v);
        notes.push(`${model.options[k].label ?? k} set to “${label}”: ${message ?? `the other setting takes clips up to ${max} s`}`);
        fixed = true;
        break;
      }
      if (fixed) break;
    }
    if (!fixed) return { error: `This clip is ${secs(clip.durationMs)} s; this model takes up to ${max} s.` };
  }

  const max = model.prompt?.max ?? 0;
  if (prompt.trim() && max === 0) return { error: "This model does not take a prompt. Remove it to continue." };
  if (prompt.length > max && max > 0) return { error: `The prompt is longer than this model accepts (${max} characters).` };
  return { modelId: model.id, videoSlot, imageSlot: slots.image[0], options, prompt, notes };
}
