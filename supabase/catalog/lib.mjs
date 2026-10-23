// Building blocks for the catalog source (supabase/catalog/models.mjs). Plain data helpers: every value they produce
// ends up verbatim in a capability specification, a KIE price schedule or a supplier offer, so keep them boring.

export const IMG = ["image/png", "image/jpeg", "image/webp"];
export const JPG_PNG = ["image/png", "image/jpeg"];
export const VIDEO_MIME = ["video/mp4", "video/quicktime"];
export const AUDIO_MIME = ["audio/mpeg", "audio/wav", "audio/mp4"];
export const MP3_WAV = ["audio/mpeg", "audio/wav"];
export const MP3 = ["audio/mpeg"];

const MB = 1024 * 1024;
/** Upload limits of Genlixs itself (uploads/intents): images 10 MB, video 50 MB, audio 15 MB. */
export const LIMIT = { image: 10 * MB, video: 50 * MB, audio: 15 * MB };

export const range = (from, to, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const SPECIAL = { auto: "Match input", adaptive: "Match input" };

/** A customer setting: label, allowed values (in display order), default and optional display labels. */
export function opt(label, values, def = values[0], labels) {
  if (!values.includes(def)) throw new Error(`default ${def} not in ${label} values`);
  return { label, values, default: def, ...(labels && Object.keys(labels).length ? { labels } : {}) };
}

export function aspect(values, def = values[0], label = "Aspect ratio") {
  const labels = Object.fromEntries(values.filter((v) => SPECIAL[v]).map((v) => [v, SPECIAL[v]]));
  return opt(label, values, def, labels);
}

export const resolution = (values, def = values[0], labels) => opt("Resolution", values, def, labels);
export const duration = (values, def = values[0]) => opt("Length (seconds)", values, def);
export const audio = (def = "on", labels = { on: "With audio", off: "No audio" }) => opt("Sound", ["on", "off"], def, labels);
export const quality = (values, def, labels) => opt("Quality", values, def, labels);

/** A setting the server derives from the inputs (never chosen by the customer). */
export const derivedOpt = (label, values, def = values[0], labels) => ({ ...opt(label, values, def, labels), derived: true });

// ------------------------------------------------------------------------------------------------ input slots

export function image(label, o = {}) {
  const { min = 1, max = 1, mime = IMG, maxBytes = LIMIT.image, minSide = 300, aspectMin = 0.4, aspectMax = 2.5, ...rest } = o;
  return { kind: "image", label, min, max, mime, maxBytes, ...(minSide ? { minSide } : {}),
    ...(aspectMin ? { aspectMin } : {}), ...(aspectMax ? { aspectMax } : {}), ...rest };
}
export const firstFrame = (o = {}) => image("Start frame", o);
export const lastFrame = (o = {}) => image("End frame", { ...o, needs: ["first_frame"] });
export const referenceImages = (max, o = {}) => image("Reference images", { max, ...o });

export function video(label, o = {}) {
  const { min = 1, max = 1, mime = VIDEO_MIME, maxBytes = LIMIT.video, ...rest } = o;
  return { kind: "video", label, min, max, mime, maxBytes, ...rest };
}
export function audioSlot(label, o = {}) {
  const { min = 1, max = 1, mime = MP3_WAV, maxBytes = LIMIT.audio, ...rest } = o;
  return { kind: "audio", label, min, max, mime, maxBytes, ...rest };
}

// ------------------------------------------------------------------------------------------------ modes

export const textMode = (label = "Text to video") => ({ id: "text", label, uses: [] });
export const imageMode = (label = "Start frame") => ({ id: "image", label, uses: ["first_frame"], requires: ["first_frame"] });
export const framesMode = (label = "Start and end frames", uses = ["first_frame", "last_frame"]) => ({ id: "frames", label, uses, requires: ["first_frame"] });
export const referenceMode = (uses, label = "Reference images", requires = [uses[0]]) => ({ id: "reference", label, uses, requires });

// ------------------------------------------------------------------------------------------------ outputs

export const imageOut = (count = 1) => ({ kind: "image", count, mime: IMG, maxBytes: 50 * MB });
export const videoOut = { kind: "video", count: 1, mime: ["video/mp4"], maxBytes: 300 * MB };
export const NO_REFS = { min: 0, max: 0 };
export const refs = (min, max, mime = IMG) => ({ min, max, mime, maxBytes: LIMIT.image });

// ------------------------------------------------------------------------------------------------ KIE schedules

/** KIE credits per output (image or clip), by setting. Rates keyed by the dims joined with "|". */
export const perOutput = (dims, rates, extra = {}) => ({ unit: "output", dims, rates, ...extra });
/** KIE credits per second of the length option (or a derived length). */
export const perSecond = (dims, rates, durationOption = "duration", extra = {}) => ({ unit: "second", durationOption, dims, rates, ...extra });

/** Every combination of the given option values, as rate keys (in dims order). */
export function keys(...lists) {
  return lists.reduce((acc, list) => acc.flatMap((a) => list.map((v) => (a === null ? String(v) : `${a}|${v}`))), [null]);
}

/** Rates from a function over the combinations of option values. */
export function rates(lists, f) {
  const out = {};
  const walk = (i, vals) => {
    if (i === lists.length) {
      const r = f(...vals);
      if (r !== undefined && r !== null) out[vals.join("|")] = r;
      return;
    }
    for (const v of lists[i]) walk(i + 1, [...vals, v]);
  };
  walk(0, []);
  return out;
}

/** Same rate for every value. */
export const flat = (values, rate) => Object.fromEntries(values.map((v) => [String(v), rate]));
