/**
 * Pure rules of the video studio composer (contract-tested): which inputs a model shows for the chosen combination,
 * which settings apply, and the exact request that is priced. Only inputs of the visible combination are ever sent,
 * so a file left in another tab or combination can never ride along with a submission. The server re-checks all of
 * it; these rules only keep the customer from paying for a request that would be refused.
 */
import type { CatalogModel, InputKind, InputMode, InputSlotSpec, Operation, OptionSpec } from "./types";

export type TabId = "create" | "edit" | "motion" | "avatar";
export type DraftKey = "create" | "extend" | "edit" | "motion" | "avatar";
export const DRAFT_KEYS: DraftKey[] = ["create", "extend", "edit", "motion", "avatar"];
export const OPERATION_OF: Record<DraftKey, Operation> = { create: "create", extend: "extend", edit: "edit", motion: "motion", avatar: "avatar" };
export const TAB_OF: Record<DraftKey, TabId> = { create: "create", extend: "create", edit: "edit", motion: "motion", avatar: "avatar" };

/** One input in the draft: an upload in progress, a verified asset (upload or own saved result) or an own job. */
export type DraftInput = {
  key: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  name: string;
  mime: string;
  kind: InputKind;
  assetId?: string;
  jobId?: string;
  previewUrl?: string;
  error?: string;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
};

export type Draft = {
  modelId: string | null;
  prompt: string;
  options: Record<string, string | number>;
  slots: Record<string, DraftInput[]>;
  modeId: string | null;
};

export const emptyDraft = (): Draft => ({ modelId: null, prompt: "", options: {}, slots: {}, modeId: null });

export const operationOf = (m: CatalogModel): Operation | null => m.operation ?? (m.tool === "video" ? "create" : null);

/** A model is on sale to customers when it is enabled (or experimental) and has a published price. */
export const onSale = (m: CatalogModel) => (m.state === "enabled" || m.state === "experimental") && m.priced;

/** Combinations offered as choices (a "text only" combination is offered when the model has one). */
export function modesOf(model: CatalogModel | null): InputMode[] {
  return model?.modes?.length ? model.modes : [{ id: "default", uses: Object.keys(model?.inputs ?? {}) }];
}

export function activeMode(model: CatalogModel | null, modeId: string | null, slots?: Record<string, DraftInput[]>): InputMode {
  const modes = modesOf(model);
  const exact = modes.find((m) => m.id === modeId);
  if (exact) return exact;
  // A combination chosen on another model ("frames" there, "image" here) falls back to the first one that takes the
  // files already added, so switching models never hides a start frame the customer just uploaded.
  const filled = Object.entries(slots ?? {}).filter(([k, items]) => model?.inputs?.[k] && readyItems(items).length).map(([k]) => k);
  return (filled.length ? modes.find((m) => filled.every((k) => m.uses.includes(k))) : undefined) ?? modes[0];
}

/** Slots shown for the active combination, in the spec's order. */
export function visibleSlots(model: CatalogModel | null, modeId: string | null, slots?: Record<string, DraftInput[]>): [string, InputSlotSpec][] {
  if (!model?.inputs) return [];
  const uses = activeMode(model, modeId, slots).uses;
  return Object.entries(model.inputs).filter(([name]) => uses.includes(name));
}

export const readyItems = (items: DraftInput[] | undefined) => (items ?? []).filter((i) => i.status === "ready" && Boolean(i.assetId || i.jobId));

/** Settings the customer can change now: declared, not derived, not hidden by a used input, limited by the combination. */
export function visibleOptions(model: CatalogModel | null, draft: Draft): [string, OptionSpec][] {
  if (!model) return [];
  const hidden = new Set<string>();
  for (const [name, spec] of visibleSlots(model, draft.modeId, draft.slots)) if (readyItems(draft.slots[name]).length) for (const h of spec.hides ?? []) hidden.add(h);
  const allowed = activeMode(model, draft.modeId, draft.slots).allowed ?? {};
  return Object.entries(model.options ?? {})
    .filter(([k, o]) => !o.derived && !hidden.has(k))
    .map(([k, o]): [string, OptionSpec] => [k, allowed[k] ? { ...o, values: o.values.filter((v) => allowed[k].map(String).includes(String(v))) } : o]);
}

/** Effective value of every non-derived, non-hidden option, snapped into what the combination allows. */
export function effectiveOptions(model: CatalogModel, draft: Draft): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, o] of visibleOptions(model, draft)) {
    if (!o.values.length) continue;
    let v = draft.options[k] ?? o.default;
    if (!o.values.map(String).includes(String(v))) v = o.values.map(String).includes(String(o.default)) ? o.default : o.values[0];
    out[k] = typeof o.values[0] === "number" ? Number(v) : String(v);
  }
  return out;
}

/** True when these settings form a combination the model does not offer (the server refuses it and never prices it). */
export function isExcluded(model: Pick<CatalogModel, "exclude"> | null, options: Record<string, string | number>): boolean {
  return (model?.exclude ?? []).some((e) => Object.entries(e).every(([k, v]) => String(options[k]) === String(v)));
}

/** The model's message for an excluded combination of these settings (null when they are offered). */
export function exclusionProblem(model: Pick<CatalogModel, "exclude" | "excludeMessage"> | null, options: Record<string, string | number>): string | null {
  return isExcluded(model, options) ? (model?.excludeMessage ?? "This combination of settings is not available. Choose another setting.") : null;
}

/** Values of one setting that would form an excluded combination with the other current settings (shown disabled). */
export function excludedValues(model: Pick<CatalogModel, "exclude"> | null, options: Record<string, string | number>, key: string, values: (string | number)[]): Set<string> {
  return new Set(values.filter((v) => isExcluded(model, { ...options, [key]: v })).map(String));
}

/** A tool that takes no prompt at all (an upscaler, a background remover): the prompt box is not shown. */
export const takesNoPrompt = (model: Pick<CatalogModel, "prompt"> | null) => (model?.prompt?.max ?? 1) === 0;

/** Maximum clip length for a slot once the model's conditional rules (for example orientation) are applied. */
export function slotMaxSeconds(model: CatalogModel | null, slot: string, spec: InputSlotSpec, options: Record<string, string | number>): { max?: number; message?: string } {
  let max = spec.maxSeconds;
  let message: string | undefined;
  for (const r of model?.rules ?? []) {
    if (r.slot !== slot || !r.maxSeconds) continue;
    if (Object.entries(r.when).every(([k, v]) => String(options[k]) === String(v)) && (max === undefined || r.maxSeconds < max)) {
      max = r.maxSeconds;
      message = r.message;
    }
  }
  return { max, message };
}

const secs = (ms: number) => (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);

/**
 * Limits that can be checked from facts read in the browser (length, picture size, shape). Unknown facts pass:
 * the server reads the real file and has the last word.
 */
export function factsProblem(
  model: CatalogModel | null,
  slot: string,
  spec: InputSlotSpec,
  facts: { durationMs?: number | null; width?: number | null; height?: number | null },
  options: Record<string, string | number> = {},
): string | null {
  if (facts.durationMs) {
    const { max, message } = slotMaxSeconds(model, slot, spec, options);
    if (spec.minSeconds && facts.durationMs < spec.minSeconds * 1000 - 50) return `This clip is ${secs(facts.durationMs)} s; use at least ${spec.minSeconds} s.`;
    if (max && facts.durationMs > max * 1000 + 50) return message ?? `This clip is ${secs(facts.durationMs)} s; use up to ${max} s.`;
  }
  const { width: w, height: h } = facts;
  if (w && h) {
    if (spec.minSide && Math.min(w, h) < spec.minSide) return `${w}×${h} is too small; the short side needs at least ${spec.minSide} px.`;
    if (spec.maxSide && Math.max(w, h) > spec.maxSide) return `${w}×${h} is too large; the long side can be at most ${spec.maxSide} px.`;
    const ratio = w / h;
    if ((spec.aspectMin && ratio < spec.aspectMin - 0.001) || (spec.aspectMax && ratio > spec.aspectMax + 0.001)) return `${w}×${h} is too narrow or too wide for this model.`;
    if (spec.minPixels && w * h < spec.minPixels) return `${w}×${h} is below the smallest size this model accepts${spec.hint ? ` (${spec.hint})` : ""}.`;
    if (spec.maxPixels && w * h > spec.maxPixels) return `${w}×${h} is above the largest size this model accepts${spec.hint ? ` (${spec.hint})` : ""}.`;
  }
  return null;
}

const typeName = (mime: string) => mime.split("/")[1]?.replace("quicktime", "MOV").replace("mpeg", "MP3").toUpperCase() ?? mime;

const ADD_COPY: Record<string, string> = {
  "Video to edit": "Add a video to edit",
  "Motion to copy": "Add the motion to copy",
  "Your character": "Add your character",
  "Video to extend": "Choose a video to extend",
};

/** "Add a start frame", "Add reference images"… */
function addPrompt(spec: InputSlotSpec) {
  if (ADD_COPY[spec.label]) return ADD_COPY[spec.label];
  if (spec.kind === "job") return "Choose a video";
  const label = spec.label.charAt(0).toLowerCase() + spec.label.slice(1);
  return spec.max > 1 ? `Add ${label}` : `Add a ${label}`;
}

/** Why the request cannot be priced yet, in the customer's words (null = ready to price). */
export function missingReason(model: CatalogModel | null, draft: Draft): string | null {
  if (!model) return "Choose a model";
  const slots = visibleSlots(model, draft.modeId, draft.slots);
  const options = effectiveOptions(model, draft);
  for (const [name, spec] of slots) {
    const items = draft.slots[name] ?? [];
    if (items.some((i) => i.status === "uploading")) return "Waiting for the upload to finish";
    if (items.some((i) => i.status === "error")) return "Remove the file that could not be used";
    const wrong = items.find((i) => spec.kind !== "job" && spec.mime && !spec.mime.includes(i.mime));
    if (wrong) return `${spec.label}: this model does not accept ${typeName(wrong.mime)} files`;
  }
  const mode = activeMode(model, draft.modeId, draft.slots);
  for (const req of mode.requires ?? []) {
    const spec = model.inputs?.[req];
    if (spec && readyItems(draft.slots[req]).length < Math.max(1, spec.min)) return addPrompt(spec);
  }
  for (const [name, spec] of slots) {
    const ready = readyItems(draft.slots[name]);
    const n = ready.length;
    if (n > 0 && n < spec.min) return `${spec.label} needs at least ${spec.min} images`;
    if (n > spec.max) return `${spec.label} takes at most ${spec.max}`;
    if (n > 0) for (const need of spec.needs ?? []) if (!readyItems(draft.slots[need]).length) return `${spec.label} needs ${model.inputs?.[need]?.label.toLowerCase() ?? need}`;
    for (const it of ready) {
      const problem = factsProblem(model, name, spec, it, options);
      if (problem) return problem;
    }
    if (spec.totalMaxSeconds) {
      const total = ready.reduce((s, i) => s + (i.durationMs ?? 0), 0);
      if (total > spec.totalMaxSeconds * 1000 + 50) return `${spec.label} can be ${spec.totalMaxSeconds} s in total`;
    }
  }
  const excluded = exclusionProblem(model, options);
  if (excluded) return excluded;
  if (takesNoPrompt(model)) return null;
  const p = draft.prompt.trim();
  const min = model.prompt?.optional ? 0 : Math.max(1, model.prompt?.min ?? 1);
  if (p.length < min) return p.length ? "Describe it in a few more words" : "Describe what you want";
  if (p.length > (model.prompt?.max ?? 4000)) return "The prompt is too long for this model";
  for (const [name, spec] of Object.entries(model.inputs ?? {})) {
    if (!spec.mention || !p.toLowerCase().includes(spec.mention.toLowerCase())) continue;
    if (!slots.some(([s]) => s === name) || !readyItems(draft.slots[name]).length) return `Add images for ${spec.mention} or remove it from the prompt`;
  }
  return null;
}

export type StudioQuoteRequest = { modelId: string; prompt: string; options: Record<string, string | number>; inputs: Record<string, string[]> };

/** The exact request priced and submitted: visible inputs only, in order, with effective options. */
export function quoteRequest(model: CatalogModel | null, draft: Draft): StudioQuoteRequest | null {
  if (!model || missingReason(model, draft)) return null;
  const inputs: Record<string, string[]> = {};
  for (const [name, spec] of visibleSlots(model, draft.modeId, draft.slots)) {
    const ids = readyItems(draft.slots[name]).map((i) => (spec.kind === "job" ? i.jobId : i.assetId)).filter((x): x is string => Boolean(x));
    if (ids.length) inputs[name] = ids;
  }
  return { modelId: model.id, prompt: takesNoPrompt(model) ? "" : draft.prompt.trim(), options: effectiveOptions(model, draft), inputs };
}

/** Routes dropped files to the first visible slot that accepts the type and still has room. */
export function routeFiles<F extends { mime: string }>(model: CatalogModel | null, draft: Draft, files: F[], only?: string[]) {
  const placed: { slot: string; file: F }[] = [];
  const rejected: F[] = [];
  const candidates = visibleSlots(model, draft.modeId, draft.slots).filter(([name, spec]) => spec.kind !== "job" && (!only || only.includes(name)));
  const room = new Map(candidates.map(([name, spec]) => [name, spec.max - (draft.slots[name] ?? []).filter((i) => i.status !== "error").length]));
  for (const f of files) {
    const target = candidates.find(([name, spec]) => (room.get(name) ?? 0) > 0 && (spec.mime ?? []).includes(f.mime));
    if (target) {
      placed.push({ slot: target[0], file: f });
      room.set(target[0], (room.get(target[0]) ?? 0) - 1);
    } else rejected.push(f);
  }
  return { placed, rejected };
}

/** Billable seconds the server will derive from the source clip (rounded up), for display before the quote. */
export function derivedSeconds(model: CatalogModel | null, draft: Draft): number | null {
  const spec = Object.values(model?.derived ?? {}).find((d) => (d.kind ?? "seconds") === "seconds" && typeof d.from === "string");
  const item = spec ? readyItems(draft.slots[spec.from as string])[0] : null;
  return item?.durationMs ? Math.ceil(item.durationMs / 1000 - 0.05) : null;
}

/**
 * Seconds the supplier bills when reference videos count too ("billed_seconds": the clip length + the reference videos'
 * total length, rounded up), or null when the model has no such rule or no reference video is attached.
 */
export function billedSeconds(model: CatalogModel | null, draft: Draft, options: Record<string, string | number>): number | null {
  const spec = Object.values(model?.derived ?? {}).find((d) => d.kind === "billed_seconds");
  if (!spec) return null;
  const ms = [spec.from].flat().flatMap((slot) => readyItems(draft.slots[slot])).reduce((n, i) => n + (i.durationMs ?? 0), 0);
  if (!ms) return null;
  return Number(options[spec.plus ?? "duration"] ?? 0) + Math.ceil(ms / 1000 - 0.0005);
}

/** KIE credits a private test is expected to cost (documented schedule; the server's estimate is authoritative). */
export function estimateSupplierCredits(model: CatalogModel | null, options: Record<string, string | number>, seconds?: number | null): number | null {
  const s = model?.costSchedule;
  if (!s) return null;
  const key = (s.dims ?? []).map((d) => String(options[d] ?? "")).join("|");
  const rate = s.rates?.[key];
  if (rate === undefined) return null;
  if (s.unit !== "second") return rate;
  const n = s.durationOption && options[s.durationOption] !== undefined ? Number(options[s.durationOption]) : (seconds ?? null);
  return n ? Math.round(rate * n * (s.secondsFactor ?? 1) * 100) / 100 : null;
}

// ---------------------------------------------------------------- drafts kept in this browser

const STORE = "genlixs-video-studio-v1";

/** Drafts survive reloads in this browser only; files are referenced by id (they stay private on the server). */
export function loadDrafts(userId: string): Partial<Record<DraftKey, Draft>> {
  try {
    const raw = window.localStorage.getItem(`${STORE}:${userId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<Draft>>;
    const out: Partial<Record<DraftKey, Draft>> = {};
    for (const k of DRAFT_KEYS) {
      const d = parsed?.[k];
      if (!d || typeof d !== "object") continue;
      const slots: Record<string, DraftInput[]> = {};
      for (const [s, items] of Object.entries(d.slots ?? {})) {
        if (Array.isArray(items)) slots[s] = items.filter((i) => i && i.status === "ready" && (i.assetId || i.jobId) && typeof i.mime === "string");
      }
      out[k] = {
        modelId: typeof d.modelId === "string" ? d.modelId : null,
        prompt: typeof d.prompt === "string" ? d.prompt.slice(0, 5000) : "",
        options: d.options && typeof d.options === "object" ? d.options : {},
        slots,
        modeId: typeof d.modeId === "string" ? d.modeId : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDrafts(userId: string, drafts: Record<DraftKey, Draft>) {
  try {
    const clean = Object.fromEntries(
      DRAFT_KEYS.map((k) => {
        const d = drafts[k];
        // Local object URLs die with the page; restored files are shown through a fresh signed link instead.
        const slots = Object.fromEntries(Object.entries(d.slots).map(([s, items]) => [s, readyItems(items).map((i) => ({ ...i, previewUrl: undefined }))]));
        return [k, { ...d, slots }];
      }),
    );
    window.localStorage.setItem(`${STORE}:${userId}`, JSON.stringify(clean));
  } catch {
    // Storage full or blocked: drafts simply do not persist.
  }
}
