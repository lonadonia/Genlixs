// Checks every supplier offer of offers.mjs against the Genlixs model it serves and compares it with the KIE reference,
// setting by setting, the way the database does (app_private.offer_incompatibility, offer_native_cost, supplier_credits).
// Used by build.mjs (the build fails on a problem) and for the coverage report.
import { aspect, perOutput, resolution } from "./lib.mjs";
import { IMAGE_MODELS } from "./models.mjs";
import { MODEL_UPDATES, VIDEO_MODELS } from "./models-video.mjs";

/** Units per USD of each native price unit (app_private.cost_unit_versions). */
export const UNITS_PER_USD = { usd: 1, apimart_credit: 10, poyo_credit: 200, kie_credit: 200 };
const KIE_USD = 0.005;

/** Models that existed before the full catalog and gain an offer here: their spec and KIE cost as recorded in production. */
const EXISTING = {
  "nano-banana-2-image": {
    tool: "image",
    name: "Nano Banana 2",
    spec: { options: { resolution: resolution(["1K", "2K", "4K"]), aspect_ratio: aspect(["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"], "1:1") },
      references: { min: 0, max: 0 }, output: { count: 1 } },
    cost: { schedule: perOutput(["resolution"], { "1K": 8, "2K": 12, "4K": 18 }) },
  },
};
const wan26 = MODEL_UPDATES.find((u) => u.id === "wan-2-6");
EXISTING["wan-2-6"] = {
  tool: "video",
  name: "Wan 2.6",
  spec: wan26.spec,
  cost: { schedule: perOutput(["resolution", "duration"], { "720p|5": 70, "720p|10": 140, "720p|15": 210, "1080p|5": 105, "1080p|10": 210, "1080p|15": 315 }) },
};

export function modelFor(id) {
  return [...IMAGE_MODELS, ...VIDEO_MODELS].find((m) => m.id === id) ?? (EXISTING[id] ? { id, ...EXISTING[id] } : null);
}

const valuesOf = (spec, k) => spec.options?.[k]?.values ?? null;
const isRange = (c) => c && typeof c === "object" && !Array.isArray(c);

/** Problems with one offer (empty when it is exact). */
export function checkOffer(o) {
  const p = [];
  const m = modelFor(o.model);
  if (!m) return [`model ${o.model} is not in the catalog source`];
  const s = m.spec;
  if (m.tool !== o.tool) p.push(`tool ${o.tool} differs from the model's ${m.tool}`);
  const caps = o.caps.options ?? {};
  for (const k of Object.keys(s.options ?? {})) if (!(k in caps)) p.push(`setting ${k} of the model is missing from the capabilities (the offer would never match)`);
  for (const [k, c] of Object.entries(caps)) {
    const vals = valuesOf(s, k);
    if (!vals) { p.push(`capability ${k} is not a setting of the model`); continue; }
    if (Array.isArray(c)) {
      for (const v of c) if (!vals.map(String).includes(String(v))) p.push(`${k}=${v} is not a value of the model`);
      if (!c.length) p.push(`${k} allows nothing`);
    } else if (isRange(c)) {
      if (!vals.some((v) => Number(v) >= c.min && Number(v) <= c.max)) p.push(`${k} range matches no value`);
    } else p.push(`${k} capability must be a list or a range`);
  }
  const modeIds = (s.modes ?? []).map((x) => x.id);
  if (modeIds.length && !o.caps.modes?.length) p.push("the model has input modes but the capabilities list none");
  for (const md of o.caps.modes ?? []) if (!modeIds.includes(md)) p.push(`mode ${md} is not a mode of the model`);
  const slots = Object.keys(s.inputs ?? {});
  for (const k of Object.keys(o.caps.inputs ?? {})) {
    if (k === "_references") { if (!(s.references?.max > 0)) p.push("_references on a model without reference images"); continue; }
    if (!slots.includes(k)) p.push(`input ${k} is not an input of the model`);
  }
  for (const md of o.caps.modes ?? []) {
    const mode = s.modes.find((x) => x.id === md);
    for (const r of mode?.requires ?? []) if (!(r in (o.caps.inputs ?? {}))) p.push(`mode ${md} requires ${r}, which the capabilities do not accept`);
  }
  if (o.tool === "edit" && !o.caps.inputs?._references) p.push("an edit offer must state how many reference images it takes");
  for (const part of o.upstream.split(";").slice(1)) if (!modeIds.includes(part.split("=")[0])) p.push(`upstream id for unknown mode ${part}`);
  const sch = o.schedule;
  for (const d of sch.dims) if (!(d in caps)) p.push(`price dimension ${d} is not a capability`);
  if (sch.basis === "output_second" && !(sch.seconds.option in caps)) p.push(`seconds option ${sch.seconds.option} is not a capability`);
  if (!(o.unit in UNITS_PER_USD)) p.push(`unknown unit ${o.unit}`);
  if (o.adapter && /;/.test(o.label)) p.push("label contains a semicolon");
  if (p.length) return p;
  const cmp = compareOffer(o);
  if (cmp.missingRate.length) p.push(`no rate for ${cmp.missingRate.slice(0, 3).join(", ")}`);
  if (!cmp.compatible) p.push("no compatible setting");
  if (!cmp.cheaper) p.push("not cheaper than the KIE reference for any setting");
  return p;
}

/** Every combination of the given settings the model allows (exclusions removed), with billed = length (no reference video). */
function configs(spec, dims, caps) {
  let set = [{}];
  for (const d of dims) {
    let vals = valuesOf(spec, d) ?? [];
    const c = caps?.[d];
    if (isRange(c) && vals.length > 12) vals = vals.filter((v) => v <= c.max + 5); // long derived ranges: enough to cover the offer
    set = set.flatMap((x) => vals.map((v) => ({ ...x, [d]: v })));
  }
  const ex = spec.exclude ?? [];
  return set.filter((c) => !ex.some((e) => Object.entries(e).every(([k, v]) => c[k] === v)));
}

/** USD of one setting on the KIE reference (no extra reference images). */
export function kieUsd(m, cfg) {
  const sch = m.cost.schedule;
  const key = sch.dims.map((d) => String(cfg[d])).join("|");
  const rate = sch.rates[key];
  if (typeof rate !== "number") return null;
  const qty = sch.unit === "second" ? Number(cfg[sch.durationOption]) * (sch.secondsFactor ?? 1) : m.spec.output?.count ?? 1;
  return rate * qty * KIE_USD;
}

/** USD of one setting on the offer, or null when the offer cannot take it. */
export function offerUsd(o, m, cfg) {
  const caps = o.caps.options ?? {};
  for (const [k, v] of Object.entries(cfg)) {
    const c = caps[k];
    if (c === undefined) continue;
    if (Array.isArray(c) ? !c.map(String).includes(String(v)) : Number(v) < c.min || Number(v) > c.max) return null;
  }
  const sch = o.schedule;
  const rate = sch.rates[sch.dims.map((d) => String(cfg[d])).join("|")];
  if (rate === undefined) return undefined;
  const qty = sch.basis === "output_second" ? Number(cfg[sch.seconds.option]) : m.spec.output?.count ?? 1;
  return (rate * qty) / UNITS_PER_USD[o.unit];
}

/** The settings that matter for one model's offers: price dimensions, lengths and every setting an offer restricts. */
export function dimsFor(m, offers) {
  const s = m.spec;
  const sch = m.cost.schedule;
  const set = new Set(sch.dims);
  if (sch.unit === "second") set.add(sch.durationOption);
  for (const o of offers) {
    for (const d of o.schedule.dims) set.add(d);
    if (o.schedule.basis === "output_second") set.add(o.schedule.seconds.option);
    for (const [k, c] of Object.entries(o.caps.options ?? {})) {
      const vals = valuesOf(s, k) ?? [];
      if (Array.isArray(c) ? c.length < vals.length : vals.some((v) => Number(v) < c.min || Number(v) > c.max)) set.add(k);
    }
  }
  // "billed" follows the length when no reference video is attached; it is set from duration below.
  if (s.options?.billed && s.options?.duration) set.delete("billed");
  return [...set];
}

function withBilled(m, cfg) {
  return m.spec.options?.billed && m.spec.options?.duration ? { ...cfg, billed: cfg.duration } : cfg;
}

export function compareOffer(o) {
  const m = modelFor(o.model);
  const dims = dimsFor(m, [o]);
  let compatible = 0, cheaper = 0, maxSaving = 0, total = 0;
  const missingRate = [];
  for (const raw of configs(m.spec, dims, o.caps.options)) {
    const cfg = withBilled(m, raw);
    total++;
    const usd = offerUsd(o, m, cfg);
    if (usd === null) continue;
    if (usd === undefined) { missingRate.push(JSON.stringify(cfg)); continue; }
    compatible++;
    const k = kieUsd(m, cfg);
    if (k !== null && usd < k) {
      cheaper++;
      maxSaving = Math.max(maxSaving, Math.round((1 - usd / k) * 100));
    }
  }
  return { total, compatible, cheaper, maxSaving, missingRate };
}

/**
 * Winners per model: for each combination of the price-relevant settings, the cheapest route (KIE original or an offer,
 * every offer counted as if activated) and its saving against KIE. Settings that do not change any price are left out.
 */
export function winners(offers) {
  const byModel = new Map();
  for (const o of offers) (byModel.get(o.model) ?? byModel.set(o.model, []).get(o.model)).push(o);
  const out = [];
  for (const [id, list] of byModel) {
    const m = modelFor(id);
    const priceDims = new Set([...m.cost.schedule.dims, ...list.flatMap((o) => o.schedule.dims)]);
    const rows = new Map();
    for (const raw of configs(m.spec, dimsFor(m, list), Object.assign({}, ...list.map((o) => o.caps.options)))) {
      const cfg = withBilled(m, raw);
      const k = kieUsd(m, cfg);
      if (k === null) continue;
      let best = { route: "KIE (original)", usd: k };
      for (const o of list) {
        const u = offerUsd(o, m, cfg);
        if (typeof u === "number" && u < best.usd) best = { route: `${o.provider} ${o.key}`, usd: u };
      }
      // One row per price-relevant combination; the length is reported per second / per output below.
      const lengthKey = m.cost.schedule.unit === "second" ? m.cost.schedule.durationOption : null;
      const key = [...priceDims].map((d) => `${d}=${cfg[d]}`).join(", ") || "any setting";
      const qty = lengthKey ? Number(cfg[lengthKey]) || 1 : 1;
      const row = rows.get(key) ?? { setting: key, routes: new Map(), kieUnit: k / qty, unit: lengthKey ? "per second" : "per output" };
      const r = row.routes.get(best.route) ?? { configs: 0, saving: 0 };
      r.configs++;
      r.saving = Math.max(r.saving, Math.round((1 - best.usd / k) * 100));
      row.routes.set(best.route, r);
      rows.set(key, row);
    }
    out.push({ model: id, name: m.name ?? id, rows: [...rows.values()] });
  }
  return out;
}
