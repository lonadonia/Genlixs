#!/usr/bin/env node
// Writes docs/CATALOG_COVERAGE.md from the catalog source: counts, every model, every supplier offer and its savings, the
// cheapest route per setting, and every product that is not a customer model yet with the reason and the source.
// Usage: node supabase/catalog/coverage.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareOffer, modelFor, UNITS_PER_USD, winners } from "./offer-check.mjs";
import { IMAGE_MODELS } from "./models.mjs";
import { MODEL_UPDATES, VIDEO_MODELS } from "./models-video.mjs";
import { LINKS, OFFERS, PRICE_UPDATES } from "./offers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "..", "docs", "CATALOG_COVERAGE.md");
const KIE = (p) => `[docs.kie.ai/${p}](https://docs.kie.ai/${p})`;

/** The 21 models that were live before the full catalog (production, 22 Oct 2026); unchanged except Wan 2.6. */
const EXISTING = [
  ["GPT Image 2.5 Flare", "image"], ["GPT Image 2.5 Sunburst", "image"], ["Nano Banana Pro", "image"], ["Nano Banana 2", "image"], ["FLUX.2 Pro", "image"],
  ["Seedream 5.0 Flash", "image"], ["GPT Image 2.5 Flare Edit", "edit"], ["GPT Image 2.5 Sunburst Edit", "edit"], ["Nano Banana Pro Edit", "edit"],
  ["FLUX.2 Pro Edit", "edit"], ["Seedream 5.0 Flash Edit", "edit"], ["Veo 3.1 Fast", "video"], ["Veo 3.1 Lite", "video"], ["Veo 3.1 Quality", "video"],
  ["Veo 3.1 Extend", "video"], ["Kling 3.0", "video"], ["Kling 3.0 Motion Control", "video"], ["Seedance 2.5", "video"], ["Seedance 2.5 Edit", "video"],
  ["Seedance 2.0 Fast", "video"], ["Wan 2.6", "video"],
];

/** KIE products that are not customer models yet (every KIE image/video page was checked against the catalog). */
const PENDING_KIE = [
  ["Topaz Image Upscale", "The price depends on the output size, which follows the uploaded image; the studio cannot quote it before upload.", "market/topaz/image-upscale"],
  ["Qwen Image (v1) text-to-image and Image Edit", "Priced per output megapixel; the pixel sizes behind each setting are not documented.", "market/qwen/text-to-image"],
  ["Wan 2.2 A14B Turbo (text and image to video)", "The clip length is not a setting and is not documented, so the price per request is unknown.", "market/wan/2-2-a14b-text-to-video-turbo"],
  ["Wan 2.2 A14B Speech to Video Turbo", "Priced, but the request and the billed length are not documented.", "market/wan/2-2-a14b-speech-to-video-turbo"],
  ["InfiniteTalk", "In the price list without a documentation page.", "pricing (kie.ai/pricing)"],
  ["Grok Imagine Video Extend / Upscale", "The price depends on the start point and the source video's resolution, which the studio cannot fix in a quote.", "market/grok-imagine/extend"],
  ["Grok Imagine Image 2.0 Segment Map / Segment Edit", "A two-task chain (map, then edit by segment) with no single priced request.", "market/grok-imagine-image-2-0/segment-map"],
  ["Seedance 2.5 Draft", "A two-step workflow (draft, then render) with no single priced request.", "market/bytedance/seedance-2-5-draft"],
  ["Runway Aleph", "No KIE price for Aleph in the price list.", "runway-api/generate-aleph-video"],
  ["Volcengine video-to-video lip sync", "The billed length (source or audio) is not documented.", "market/volcengine/video-to-video-lip-sync"],
  ["Seedream 5.0 Pro / Flash Layer Decomposition", "Returns a variable number of layers; per-request price not fixed.", "market/seedream/5-pro-layer-decomposition"],
  ["Ideogram V3 Edit and Character Edit", "Need a painted mask, which the studio does not offer.", "market/ideogram/v3-edit"],
  ["Ideogram Character Remix", "Needs two image roles (character and scene) the studio's edit tool does not distinguish.", "market/ideogram/character-remix"],
  ["Gemini Omni Character", "A helper that registers a character for later videos, not a generation.", "market/gemini-omni-character"],
  ["Gemini Omni Video / Flash 1.1 with a video input", "Video-input prices are per request but the accepted input length and its effect are not documented; text, frames and images are live.", "market/gemini-omni-video"],
  ["Kling 3.0 Omni video input and Transformation", "Billed seconds with a video input are not documented; text, frames and reference images are live.", "market/kling/v3-omni-transformation"],
  ["Kling 4.0 and Wan 2.7 reference videos", "The price with a video input is not documented; their other workflows are live.", "market/kling/v4-reference-to-video"],
  ["Seedance 2.0 Fast with reference videos", "The existing model has no reference-video workflow yet; KIE's billing with video input is per input + output second and was not added in this release.", "market/bytedance/seedance-2-fast"],
  ["OmniHuman 1.5 Human Identification / Subject Detection", "Helper steps for OmniHuman, not generations (OmniHuman 1.5 itself is live).", "market/omnihuman-1-5/subject-detection"],
  ["Seedance 1.5 Pro", "No longer in KIE's price list or documentation (checked 22 Oct 2026); the research entry is marked unavailable.", "pricing (kie.ai/pricing)"],
];

/** Research entries for products other suppliers sell and KIE does not: kept as "KIE reference needed". */
const KIE_LESS = [
  ["apimart", "midjourney", "Midjourney", "Four-image grids and follow-up actions are not single-image units."],
  ["apimart", "vidu-q3-turbo", "Vidu Q3 Turbo", "KIE sells Vidu Q4 only; Q3 is not a substitute."],
  ["cuddler", "kling-o1", "Kling O1", "Not sold by KIE."],
  ["cuddler", "ltx-2.5", "LTX 2.5", "Not sold by KIE."],
  ["cuddler", "runway-gen-4.5", "Runway Gen-4.5", "KIE sells Gen-4 Turbo only."],
  ["poyo", "runway-gen-4.5", "Runway Gen-4.5", "KIE sells Gen-4 Turbo only."],
  ["poyo", "seedance-1.5-pro", "Seedance 1.5 Pro", "KIE withdrew it (22 Oct 2026)."],
  ["nezhagate", "gemini-omni-flash", "Gemini Omni Flash", "Version (Flash vs Flash 1.1) not established."],
  ["nezhagate", "seedance-2.5-30s", "Seedance 2.5 · 30 s", "A fixed 30-second product; Genlixs Seedance 2.5 offers 5 or 10 s."],
  ["nezhagate", "veo-3.1", "Veo 3.1", "Alias, version, duration and audio mapping not established."],
  ["nezhagate", "seedance-2-fast/video-reference", "Seedance 2.0 Fast with reference video", "The Genlixs model has no reference-video workflow yet."],
  ["apimart", "seedance-2-fast/video-reference", "Seedance 2.0 Fast with reference video", "The Genlixs model has no reference-video workflow yet."],
];
const DUOMI = ["gpt-image-2/medium", "grok-video", "grok-video-1.5", "kling-2.5-turbo-pro", "kling-2.6-motion-control", "kling-2.6-pro", "kling-image-tools",
  "nano-banana", "nano-banana-2-lite", "nano-banana-2.1", "sora"];

const NAMES = { apimart: "APIMart", nezhagate: "NezhaGate", poyo: "PoYo", cuddler: "Cuddler", duomi: "Duomi" };
const usd = (n) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3).replace(/0$/, "")}`);
const esc = (s) => String(s).replace(/\|/g, "\\|");

const MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS];
const byTool = (t) => MODELS.filter((m) => m.tool === t).length;
const existingBy = (t) => EXISTING.filter(([, x]) => x === t).length;
const offersOf = (id) => OFFERS.filter((o) => o.model === id);
const workflows = (m) => (m.spec.modes?.length ? m.spec.modes.map((x) => x.label).join(", ") : m.tool === "edit" ? `Edit (${m.spec.references.min}–${m.spec.references.max} images)` : "Text to image");

function offerPrice(o) {
  const r = o.schedule.rates;
  const per = o.schedule.basis === "output_second" ? "/s" : o.tool === "video" ? " per video" : " per image";
  const vals = Object.entries(r).map(([k, v]) => `${k || "any"} ${usd(Number(v) / UNITS_PER_USD[o.unit])}`);
  const uniq = [...new Set(Object.values(r).map(String))];
  return uniq.length === 1 ? `${usd(Number(uniq[0]) / UNITS_PER_USD[o.unit])}${per}` : `${vals.join(", ")}${per}`;
}

let md = `# Catalog coverage

Generated by \`node supabase/catalog/coverage.mjs\` from the catalog source (\`supabase/catalog/*.mjs\`), which the migrations are generated from
too. Sources were read on **22 Oct 2026**: docs.kie.ai and the KIE price list (KIE credit = $0.005), docs.apimart.ai and APIMart's public
price list (Gold tier), nezhagate.com, poyo.ai model pages, Cuddler's public catalog. **No paid generation or test was made** for this work
(supplier spend $0): every route below is documented, not live-tested.

## Summary

| | Count |
| --- | --- |
| Customer models | **${MODELS.length + EXISTING.length}** (${MODELS.length} new + ${EXISTING.length} existing) |
| — text to image | ${byTool("image") + existingBy("image")} (${byTool("image")} new) |
| — image edit | ${byTool("edit") + existingBy("edit")} (${byTool("edit")} new) |
| — video (create, edit, extend, motion, avatar) | ${byTool("video") + existingBy("video")} (${byTool("video")} new) |
| Existing model gaining workflows | ${MODEL_UPDATES.map((u) => u.id).join(", ")} (image and reference-video workflows; same KIE rates) |
| New supplier offers (all **off** until the owner activates them) | ${OFFERS.length}: ${Object.entries(NAMES).map(([p, n]) => [n, OFFERS.filter((o) => o.provider === p).length]).filter(([, c]) => c).map(([n, c]) => `${n} ${c}`).join(", ")} |
| Supplier price corrections on existing offers | ${PRICE_UPDATES.length} (NezhaGate GPT Image 2.5 Flare/Sunburst, 2K and 4K went up) |
| Supplier research entries linked to a model, not integrated (reason recorded) | ${LINKS.length} |
| KIE products not yet customer models (pending, reasons below) | ${PENDING_KIE.length} |
| Products without a KIE reference (pending "KIE reference needed") | ${KIE_LESS.length} research entries + Duomi's ${DUOMI.length} (preserved) + the rest of the suppliers' catalogs |

**Customer prices** are unchanged by any of this: every model is priced from its KIE reference under the owner's global policy
(\`ceil(KIE USD × (1 + markup) ÷ USD per credit)\`), whichever supplier serves the job. A supplier offer only changes Genlixs' cost.
**Routing**: each request goes to the cheapest *activated* route that supports its exact settings, inputs and prompt length, and never costs
more than the KIE original route; settings an offer does not take stay on KIE.

## 1. New customer models (${MODELS.length})

All are on (documented KIE cost basis) unless the owner turns one off in /admin/catalog.

| Model | Tool | Workflows | KIE reference | Supplier offers |
| --- | --- | --- | --- | --- |
`;
for (const m of [...MODELS].sort((a, b) => a.sort - b.sort)) {
  const sch = m.cost.schedule;
  const rates = Object.values(sch.rates);
  const range = `${Math.min(...rates)}${Math.max(...rates) !== Math.min(...rates) ? `–${Math.max(...rates)}` : ""} cr ${sch.unit === "second" ? "/ s" : m.tool === "video" ? "/ video" : "/ image"}`;
  const offers = offersOf(m.id).map((o) => NAMES[o.provider]).join(", ") || "—";
  md += `| ${esc(m.name)} | ${m.tool}${m.spec.operation && m.spec.operation !== "create" ? ` (${m.spec.operation})` : ""} | ${esc(workflows(m))} | ${range} | ${offers} |\n`;
}
md += `
Existing models (live before 22 Oct, unchanged): ${EXISTING.map(([n]) => n).join(", ")}. Existing documented offers on them are unchanged.

## 2. Supplier offers (${OFFERS.length}) — off until activated

Every offer was checked against its model (\`supabase/catalog/offer-check.mjs\`): it must accept every setting name of the model, only
values the model has, only its input modes and slots, and be cheaper than the KIE reference for at least one setting. "Cheaper" counts the
settings the offer takes; settings it does not take always stay on KIE.

| Supplier | Product (model) | Takes | Price (USD) | Cheaper than KIE | Notes |
| --- | --- | --- | --- | --- | --- |
`;
for (const o of OFFERS) {
  const c = compareOffer(o);
  const m = modelFor(o.model);
  const notes = [...(o.caps.notes ?? []), ...(o.gap ? [`Open documentation gap: ${o.gap}`] : [])].join("; ");
  md += `| ${NAMES[o.provider]} | ${esc(o.label)} (${esc(m.name ?? o.model)}) | ${(o.caps.modes ?? [o.tool === "edit" ? "edit" : "text"]).join(", ")} | ${esc(offerPrice(o))} | ${c.cheaper} of ${c.compatible} settings, up to ${c.maxSaving} % | ${esc(notes) || "—"} |\n`;
}
md += `
## 3. Cheapest route per setting (if every offer above were activated)

Per price-relevant setting of each model with offers: which route would serve it and the largest saving against the KIE reference.
Shares count every combination of the model's other settings (aspect ratio, sound, length…) with that price setting.

`;
for (const w of winners(OFFERS)) {
  md += `**${esc(w.name)}**\n\n| Setting | KIE reference | Cheapest route (share of settings, largest saving) |\n| --- | --- | --- |\n`;
  for (const r of w.rows) {
    const total = [...r.routes.values()].reduce((a, b) => a + b.configs, 0);
    const routes = [...r.routes].sort((a, b) => b[1].configs - a[1].configs)
      .map(([k, v]) => `${k.startsWith("KIE") ? k : `${NAMES[k.split(" ")[0]]} (${k.split(" ").slice(1).join(" ")})`} ${Math.round((v.configs / total) * 100)} %${v.saving ? `, −${v.saving} %` : ""}`).join("; ");
    md += `| ${esc(r.setting)} | ${usd(r.kieUnit)} ${r.unit} | ${esc(routes)} |\n`;
  }
  md += "\n";
}
md += `## 4. KIE products not yet customer models (${PENDING_KIE.length})

Every KIE image/video documentation page (167 endpoints) was matched against the catalog's per-workflow KIE model ids; the pages not used
are the existing live models, KIE's text models, and the items below.

| Product | Why it is pending | Source |
| --- | --- | --- |
${PENDING_KIE.map(([n, r, s]) => `| ${esc(n)} | ${esc(r)} | ${s.startsWith("pricing") ? s : KIE(s)} |`).join("\n")}

## 5. Products without a KIE reference ("KIE reference needed")

Customer models are KIE-referenced only (that is how they are priced). A product only another supplier sells stays out of the customer
catalog; if the owner adds one, its original route is created switched off with the blocker "KIE reference needed".

| Supplier | Research entry | Product | Note |
| --- | --- | --- | --- |
${KIE_LESS.map(([p, k, n, r]) => `| ${NAMES[p]} | \`${k}\` | ${esc(n)} | ${esc(r)} |`).join("\n")}

Duomi entries are preserved as they were (not expanded, not linked): ${DUOMI.map((k) => `\`${k}\``).join(", ")}.
Beyond these research entries, the suppliers' public catalogs list further products KIE does not sell (for example Sora, Runway Gen-4.5,
LTX, SkyReels, Vidu Q3, FLUX 3 video and Max, Kling O1 and 1.6, MiniMax H3 Max, Midjourney, DALL·E 3, GPT Image 1, Hunyuan): they were
not inventoried one by one and are all pending for the same reason.

## 6. Supplier entries linked to a model but not integrated (${LINKS.length})

| Supplier | Entry | Model | Reason |
| --- | --- | --- | --- |
${LINKS.map(([p, k, m, , r]) => `| ${NAMES[p]} | \`${k}\` | ${esc(modelFor(m)?.name ?? m)} | ${esc(r.replace(/^Not integrated: /, ""))} |`).join("\n")}

## 7. Settings a model refuses, and settings left to KIE

Combinations a model itself does not offer (the studio shows them as unavailable, the server refuses them with the message):

${MODELS.filter((m) => m.spec.exclude?.length).map((m) => `- **${esc(m.name)}**: ${m.spec.exclude.map((e) => Object.entries(e).map(([k, v]) => `${k}=${v}`).join(" + ")).join("; ")} — "${m.spec.excludeMessage}"`).join("\n")}

Settings an offer does not take (they are served by the KIE route): see the "Takes" and "Notes" columns of section 2, e.g. Seedance 2.0
with reference videos, PixVerse transitions and 21:9, Wan 2.7 lengths 2/8 s on PoYo, sound switched off on NezhaGate Seedance, automatic
aspect ratio on NezhaGate Nano Banana, more than 8 images on NezhaGate edits, HappyHorse edits of sources over 15 s.

## 8. Limitations, estimates and expiry

- **Documented, not live-tested.** No offer has been tested with a real generation (the task allowed $0 of supplier spend). Each one routes
  only after the owner activates it in /admin/providers ("Documented, not live-tested"), and the first supplier refusal or failed job
  switches it off again automatically.
- **Price freshness.** Supplier prices were read on 22 Oct 2026 and are excluded from routing after 30 days (from **21 Nov 2026**) unless
  re-checked. APIMart prices are its Gold-tier member prices (20 % below list); if the account's tier or the discount changes, the price
  must be re-entered. KIE reference prices are dated the same day.
- **Estimates.** Reference-video seconds of Seedance 2.0 / Wan 3.0 on KIE are billed from the uploaded clips' length (rounded up); edit
  models bill the source length. Supplier charges are confirmed from each task's reported cost where the supplier reports one.
- **Reliability.** NezhaGate publishes a 61 % 30-day success rate for Seedance 2.0 (failed jobs are refunded; Genlixs falls back to KIE).
- **Balances.** Activation requires a fresh balance that covers the cheapest request: NezhaGate held $0.125 on 22 Oct (enough for images,
  not for a Seedance video); APIMart 100 credits ($10); PoYo 1,000 credits ($5). KIE held 506 credits on 23 Oct: a request whose KIE cost
  is higher (e.g. Seedance 2.0 at 1080p for 5 s, 510 credits) is refused before charging until KIE is topped up or a cheaper offer serves it.
- **Open gap.** APIMart Wan 2.6: whether sound is added by default is not documented (on either route) — it needs a live test before it can route.
- **Cuddler** offers are not integrated: its result download host is not documented and must not be guessed.

## 9. Owner actions

1. /admin/providers → each offer → **Refresh balance** (free) and, where every readiness check passes, **Activate (documented, not live-tested)**
   with a reason. The readiness panel lists the exact missing item otherwise (balance, gap, price age).
2. Top up NezhaGate before activating its Seedance 2.0 offer.
3. Optionally live-test APIMart Wan 2.6 (one short clip) to close its documentation gap.
`;

writeFileSync(out, md);
console.log(`${path.relative(process.cwd(), out)}: ${(Buffer.byteLength(md) / 1024).toFixed(1)} KB`);
