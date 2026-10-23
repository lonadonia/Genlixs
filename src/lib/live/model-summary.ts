/** Model summaries shown by the model picker: capability chips, the lowest price and what a model can start from. */
import type { CatalogModel } from "./types";

const RES_ORDER = ["360p", "480p", "512P", "540p", "580p", "720p", "720P", "768P", "1080p", "1080P", "1K", "1.5K", "2K", "2k", "3K", "4k", "4K"];

/** One-line capability summary from the model's own spec (never marketing claims). */
export function capabilitySummary(m: CatalogModel): string[] {
  const out: string[] = [];
  const res = m.options.resolution ?? m.options.mode;
  if (res) {
    const top = [...res.values].map(String).sort((a, b) => RES_ORDER.indexOf(a) - RES_ORDER.indexOf(b)).pop();
    if (top) out.push(res.labels?.[top] ?? top.replace(/^(\d)k$/i, "$1K").replace(/^(\d+)P$/, "$1p"));
  } else if (m.options.quality?.labels) {
    const labels = m.options.quality.values.map((v) => m.options.quality.labels?.[String(v)]).filter((l): l is string => Boolean(l && /\dK$/.test(l)));
    if (labels.length) out.push(labels[labels.length - 1]);
  }
  const dur = m.options.duration;
  if (dur) {
    const v = dur.values.map(Number).filter(Number.isFinite);
    if (v.length) out.push(Math.min(...v) === Math.max(...v) ? `${v[0]} s` : `${Math.min(...v)}–${Math.max(...v)} s`);
  }
  const seconds = m.options.seconds;
  if (seconds?.derived) {
    const v = seconds.values.map(Number);
    const from = Object.values(m.derived ?? {}).find((d) => typeof d.from === "string")?.from;
    const kind = typeof from === "string" ? m.inputs?.[from]?.kind : undefined;
    out.push(`${Math.min(...v)}–${Math.max(...v)} s from your ${kind === "audio" ? "audio" : "clip"}`);
  }
  const slots = Object.values(m.inputs ?? {});
  if (slots.some((s) => s.label === "Start frame" || s.label === "First frame" || s.label === "Start image")) out.push(m.inputs?.last_frame ? "Start/end frame" : "Start frame");
  if (slots.some((s) => s.group === "elements")) out.push("@Elements");
  if (slots.some((s) => s.kind === "image" && /reference|subject|character images/i.test(s.label))) out.push("Image refs");
  if (slots.some((s) => s.kind === "video" && /reference/i.test(s.label))) out.push("Video refs");
  if (slots.some((s) => s.kind === "audio")) out.push(m.inputs?.speech_audio ? "Speech audio" : "Audio refs");
  if (m.options.audio || m.fixed?.audio) out.push("Sound");
  const refMax = m.references?.max ?? 0;
  if (m.tool === "edit" && refMax > 0) out.push(refMax === 1 ? "1 image" : `Up to ${refMax} images`);
  if (m.output?.count > 1) out.push(`${m.output.count} images`);
  if (m.options.aspect_ratio && m.tool !== "video") out.push(`${m.options.aspect_ratio.values.length} shapes`);
  if ((m.prompt?.max ?? 1) === 0) out.push("No prompt");
  return out;
}

/** The lowest price in credits of any setting (the price list is per whole request), or null when unknown. */
export function fromCredits(m: CatalogModel): number | null {
  const units = m.priceRules?.format === "table" ? Object.values(m.priceRules.units ?? {}) : [];
  const n = units.filter((u) => Number.isFinite(u) && u > 0);
  return n.length ? Math.min(...n) : null;
}

/** What a model can start from (filters of a long video list). */
export const WORKFLOWS = [
  { id: "text", label: "Text only", test: (m: CatalogModel) => Boolean(m.modes?.some((x) => x.uses.length === 0)) },
  { id: "start", label: "Start frame", test: (m: CatalogModel) => Boolean(m.inputs?.first_frame) },
  { id: "end", label: "End frame", test: (m: CatalogModel) => Boolean(m.inputs?.last_frame) },
  { id: "images", label: "Reference images", test: (m: CatalogModel) => Object.values(m.inputs ?? {}).some((s) => s.kind === "image" && s.max > 1) },
  { id: "video", label: "Reference video", test: (m: CatalogModel) => Object.entries(m.inputs ?? {}).some(([k, s]) => s.kind === "video" && k.startsWith("reference")) },
  { id: "audio", label: "Audio", test: (m: CatalogModel) => Object.values(m.inputs ?? {}).some((s) => s.kind === "audio") },
] as const;

