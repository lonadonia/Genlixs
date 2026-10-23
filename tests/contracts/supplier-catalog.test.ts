// Supplier offers of the full catalog (22 Oct 2026): every offer of supabase/catalog/offers.mjs builds the supplier's
// documented request for every input mode and every setting its capabilities accept; exact bodies for representative
// requests; refusals outside the documented shapes; registration in code and in the offers migration. Nothing is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { buildApimart } from "../../src/lib/providers/apimart";
import { buildNezhagate } from "../../src/lib/providers/nezhagate";
import { buildPoyo } from "../../src/lib/providers/poyo";
import { adaptersByProvider } from "../../src/lib/providers/registry";
import type { AttemptRoute, ClaimContext, RoutedSubmit } from "../../src/lib/providers/types";
import { OFFERS, SUPPLIER_ADAPTERS } from "../../supabase/catalog/offers.mjs";
import { modelFor } from "../../supabase/catalog/offer-check.mjs";

type Opt = { values: (string | number)[]; default: string | number; derived?: boolean };
type Mode = { id: string; uses: string[]; requires?: string[]; allowed?: Record<string, (string | number)[]> };
type Spec = { options: Record<string, Opt>; inputs?: Record<string, { min?: number }>; modes?: Mode[]; exclude?: Record<string, unknown>[] };
type Caps = { options: Record<string, (string | number)[] | { min: number; max: number }>; modes?: string[]; inputs?: Record<string, { max: number }> };
type Offer = { provider: "apimart" | "poyo" | "nezhagate"; key: string; model: string; tool: "image" | "edit" | "video"; upstream: string; adapter: string; caps: Caps };

const OFFER_LIST = OFFERS as unknown as Offer[];
const BUILD = { apimart: buildApimart, poyo: buildPoyo, nezhagate: buildNezhagate };
const U = "https://files.example/";

const route = (o: Offer): AttemptRoute => ({
  provider: o.provider, accountId: "acc", offerId: "off", adapter: o.adapter, upstreamModelId: o.upstream, credentialVersion: 1, credentialSource: "vault", secretRef: null,
});
const ctx = (o: Offer, options: Record<string, string | number>, mode: string | null, prompt = "A lighthouse at dawn"): ClaimContext => ({
  job: { id: "00000000-0000-4000-8000-0000000000b1", ref: "J1", userId: "u", state: "submitting", tool: o.tool, prompt, options, units: "4", mode },
  model: { id: o.model, providerModelId: "kie-id", adapter: "kie-x", adapterVersion: 1, providerAccountId: "a" },
  output: { kind: o.tool === "video" ? "video" : "image", mime: ["image/png"], count: 1, maxBytes: 1 },
  references: [],
  inputs: {},
  attempt: { id: "att-1", ordinal: 1, state: "submitting", taskId: null },
});
const req = (o: Offer, options: Record<string, string | number>, mode: string | null, inputs: Record<string, string[]> = {}, refs: string[] = []): RoutedSubmit => ({
  context: ctx(o, options, mode), referenceUrls: refs, inputUrls: inputs, sourceTasks: {}, callBackUrl: null, route: route(o), key: "k_test", idempotencyKey: "genlixs-att-1",
});
const build = (o: Offer, ...a: Parameters<typeof req> extends [Offer, ...infer R] ? R : never) => BUILD[o.provider](req(o, ...a));

/** A value the offer accepts: the model's default when allowed, otherwise the first allowed value. */
function accepted(cap: Caps["options"][string], o: Opt): string | number {
  if (Array.isArray(cap)) return cap.map(String).includes(String(o.default)) ? o.default : cap[0];
  const n = Number(o.default);
  return n >= cap.min && n <= cap.max ? o.default : (o.values.find((v) => Number(v) >= cap.min && Number(v) <= cap.max) ?? cap.min);
}
function settings(o: Offer, spec: Spec, mode: Mode | null): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, opt] of Object.entries(spec.options)) out[k] = accepted(o.caps.options[k], opt);
  for (const [k, vals] of Object.entries(mode?.allowed ?? {})) if (!vals.map(String).includes(String(out[k]))) out[k] = vals.find((v) => accepted(o.caps.options[k], { values: [v], default: v }) === v) ?? vals[0];
  if ("billed" in out && "duration" in out) out.billed = out.duration;
  return out;
}
const inputsFor = (mode: Mode | null): Record<string, string[]> => Object.fromEntries((mode?.requires ?? []).map((s) => [s, [`${U}${s}`]]));
const refsFor = (o: Offer) => (o.tool === "edit" ? [`${U}ref-0`] : []);
const modesOf = (o: Offer, spec: Spec): (Mode | null)[] => (o.caps.modes?.length ? o.caps.modes.map((id) => spec.modes!.find((m) => m.id === id)!) : [null]);

test("every offer builds its supplier's request for every input mode it takes", () => {
  let n = 0;
  for (const o of OFFER_LIST) {
    const spec = modelFor(o.model)!.spec as Spec;
    for (const mode of modesOf(o, spec)) {
      const opts = settings(o, spec, mode);
      assert.doesNotThrow(() => build(o, opts, mode?.id ?? null, inputsFor(mode), refsFor(o)), `${o.provider} ${o.key} / ${mode?.id ?? "default"}`);
      n++;
    }
  }
  assert.ok(n >= 45, `only ${n} requests`);
});

test("every setting value an offer accepts builds a request (one setting at a time)", () => {
  for (const o of OFFER_LIST) {
    const spec = modelFor(o.model)!.spec as Spec;
    const modes = modesOf(o, spec);
    for (const [k, cap] of Object.entries(o.caps.options)) {
      if (spec.options[k]?.derived) continue;
      const values = Array.isArray(cap) ? cap : spec.options[k].values.filter((v) => Number(v) >= cap.min && Number(v) <= cap.max);
      for (const v of values) {
        const mode = modes.find((md) => !md?.allowed?.[k] || md.allowed[k].map(String).includes(String(v))) ?? null;
        const opts = { ...settings(o, spec, mode), [k]: v };
        if ("billed" in opts && "duration" in opts) opts.billed = opts.duration;
        if ((spec.exclude ?? []).some((e) => Object.entries(e).every(([ek, ev]) => opts[ek] === ev))) continue;
        // an automatic ratio needs a reference image, which only edits have
        assert.doesNotThrow(() => build(o, opts, mode?.id ?? null, inputsFor(mode), refsFor(o)), `${o.provider} ${o.key}: ${k}=${v} (${mode?.id ?? "default"})`);
      }
    }
  }
});

const offer = (provider: string, key: string) => OFFER_LIST.find((o) => o.provider === provider && o.key === key)!;

test("APIMart: exact bodies of the new families", () => {
  const wan3 = build(offer("apimart", "wan-3.0"), { audio: "off", resolution: "720P", duration: 8, aspect_ratio: "adaptive", billed: 14 }, "reference",
    { reference_images: [U + "i"], reference_videos: [U + "v"], reference_audio: [U + "a"] });
  assert.deepEqual(wan3, { path: "/v1/videos/generations", body: {
    model: "wan3.0-video", prompt: "A lighthouse at dawn", resolution: "720P", size: "adaptive", duration: 8, audio: false,
    image_with_roles: [{ url: U + "i", role: "reference_image" }], video_urls: [U + "v"], audio_urls: [U + "a"], generation_type: "reference", watermark: false } });
  const frames = build(offer("apimart", "wan-2.7"), { resolution: "1080p", duration: 5, aspect_ratio: "16:9" }, "frames", { first_frame: [U + "1"], last_frame: [U + "2"] });
  assert.deepEqual(frames.body, { model: "wan2.7", prompt: "A lighthouse at dawn", resolution: "1080P", duration: 5,
    image_with_roles: [{ url: U + "1", role: "first_frame" }, { url: U + "2", role: "last_frame" }], watermark: false });
  const r2v = build(offer("apimart", "wan-2.7"), { resolution: "720p", duration: 5, aspect_ratio: "9:16" }, "reference", { reference_images: [U + "a", U + "b"] });
  assert.equal(r2v.body.model, "wan2.7-r2v", "reference images use the R2V model");
  assert.deepEqual(r2v.body.image_with_roles, [{ url: U + "a", role: "reference_image" }, { url: U + "b", role: "reference_image" }]);
  const edit = build(offer("apimart", "wan2.7-videoedit"), { resolution: "720p", audio_setting: "origin", seconds: 6 }, "edit", { source_video: [U + "v"] });
  assert.deepEqual(edit.body, { model: "wan2.7-videoedit", prompt: "A lighthouse at dawn", video_urls: [U + "v"], resolution: "720P", duration: 0,
    metadata: { audio_setting: "origin" }, watermark: false });
  const pix = build(offer("apimart", "pixverse-v6"), { audio: "on", resolution: "540p", duration: 5, aspect_ratio: "3:2" }, "reference", { reference_images: [U + "a"] });
  assert.deepEqual(pix.body, { model: "pixverse-v6", prompt: "A lighthouse at dawn", resolution: "540p", duration: 5, audio: true, motion_mode: "normal",
    watermark: false, img_references: [U + "a"], size: "3:2" });
  const hhEdit = build(offer("apimart", "happyhorse-1.0/edit"), { resolution: "1080p", audio_setting: "auto", seconds: 9 }, "edit",
    { source_video: [U + "v"], reference_images: [U + "s"] });
  assert.deepEqual(hhEdit.body, { model: "happyhorse-1.0", prompt: "A lighthouse at dawn", video_url: U + "v", image_urls: [U + "s"], resolution: "1080P",
    audio_setting: "auto", watermark: false });
  const hhFrame = build(offer("apimart", "happyhorse-1.0"), { resolution: "720p", duration: 3, aspect_ratio: "1:1" }, "image", { first_frame: [U + "f"] });
  assert.deepEqual(hhFrame.body, { model: "happyhorse-1.0", prompt: "A lighthouse at dawn", first_frame_image: U + "f", resolution: "720P", duration: 3, watermark: false });
  const seedream = build(offer("apimart", "seedream-4.5"), { quality: "high", aspect_ratio: "21:9" }, null);
  assert.deepEqual(seedream.body, { model: "seedream-4.5", prompt: "A lighthouse at dawn", size: "21:9", resolution: "4K", n: 1 });
  const klein = build(offer("apimart", "flux-3-image-klein/edit"), { resolution: "2K", aspect_ratio: "auto" }, null, {}, [U + "r1", U + "r2"]);
  assert.deepEqual(klein, { path: "/v1/images/generations", body: { model: "flux-3-image-klein", prompt: "A lighthouse at dawn", aspect_ratio: "auto", resolution: "2k", n: 1,
    image_urls: [U + "r1", U + "r2"] } });
  const wan26 = build(offer("apimart", "wan2.6"), { duration: 10, resolution: "1080p" }, "text");
  assert.deepEqual(wan26.body, { model: "wan2.6", prompt: "A lighthouse at dawn", resolution: "1080p", duration: 10, watermark: false });
  const sd = build(offer("apimart", "seedance-2-0"), { audio: "on", resolution: "4k", duration: 12, aspect_ratio: "adaptive", with_video: "no", billed: 12 }, "frames",
    { first_frame: [U + "f"] });
  assert.deepEqual(sd.body, { model: "seedance-2.0", prompt: "A lighthouse at dawn", duration: 12, resolution: "4k", size: "adaptive", generate_audio: true,
    image_with_roles: [{ url: U + "f", role: "first_frame" }] });
});

test("PoYo: exact bodies of Wan 2.7, HappyHorse and Gemini Omni (model id per workflow)", () => {
  const w = offer("poyo", "wan-2.7");
  assert.deepEqual(build(w, { resolution: "720p", duration: 10, aspect_ratio: "4:3" }, "text"), { path: "/api/generate/submit", body: {
    model: "wan2.7-text-to-video", input: { prompt: "A lighthouse at dawn", aspect_ratio: "4:3", resolution: "720p", duration: 10 } } });
  assert.deepEqual(build(w, { resolution: "1080p", duration: 5, aspect_ratio: "16:9" }, "frames", { first_frame: [U + "1"], last_frame: [U + "2"] }).body, {
    model: "wan2.7-image-to-video", input: { prompt: "A lighthouse at dawn", image_urls: [U + "1", U + "2"], resolution: "1080p", duration: 5 } });
  assert.deepEqual(build(w, { resolution: "720p", duration: 5, aspect_ratio: "1:1" }, "reference", { reference_images: [U + "a"] }).body, {
    model: "wan2.7-reference-to-video", input: { prompt: "A lighthouse at dawn", reference_image_urls: [U + "a"], aspect_ratio: "1:1", resolution: "720p", duration: 5 } });
  assert.deepEqual(build(offer("poyo", "wan2.7-edit-video"), { resolution: "720p", audio_setting: "auto", seconds: 4 }, "edit", { source_video: [U + "v"], reference_image: [U + "r"] }).body, {
    model: "wan2.7-edit-video", input: { prompt: "A lighthouse at dawn", video_url: U + "v", reference_image_url: U + "r", resolution: "720p", duration: 0, audio_setting: "auto" } });
  assert.deepEqual(build(offer("poyo", "happy-horse"), { resolution: "1080p", duration: 15, aspect_ratio: "9:16" }, "reference", { reference_images: [U + "c1", U + "c2"] }).body, {
    model: "happy-horse", input: { prompt: "A lighthouse at dawn", reference_image_urls: [U + "c1", U + "c2"], aspect_ratio: "9:16", resolution: "1080p", duration: 15 } });
  assert.deepEqual(build(offer("poyo", "happy-horse/edit"), { resolution: "720p", audio_setting: "origin", seconds: 12 }, "edit", { source_video: [U + "v"] }).body, {
    model: "happy-horse", input: { prompt: "A lighthouse at dawn", video_url: U + "v", resolution: "720p", audio_setting: "origin" } });
  assert.deepEqual(build(offer("poyo", "gemini-omni-1.1-flash"), { resolution: "4k", duration: 8, aspect_ratio: "9:16" }, "frames", { first_frame: [U + "1"] }).body, {
    model: "gemini-omni-1.1-flash", input: { prompt: "A lighthouse at dawn", image_urls: [U + "1"], resolution: "4k", duration: 8, aspect_ratio: "9:16" } });
  // Kling 2.6 Motion Control reuses the existing PoYo motion builder with its own model id
  assert.equal(build(offer("poyo", "kling-2.6-motion-control"), { mode: "720p", orientation: "video", seconds: 12 }, "motion",
    { character_image: [U + "c"], motion_video: [U + "m"] }).body.model, "kling-2.6-motion-control");
});

test("NezhaGate: Nano Banana 2 / 2.1 and Seedance 2.0 reuse the documented image and video shapes", () => {
  assert.deepEqual(build(offer("nezhagate", "nano-banana-2.1/edit"), { resolution: "4K", aspect_ratio: "4:5" }, null, {}, [U + "a", U + "b"]).body, {
    model: "nano-banana-2.1", prompt: "A lighthouse at dawn", size: "4:5", resolution: "4K", images: [U + "a", U + "b"] });
  assert.deepEqual(build(offer("nezhagate", "seedance-2.0"), { audio: "on", resolution: "480p", duration: 6, aspect_ratio: "1:1", with_video: "no", billed: 6 }, "reference",
    { reference_images: [U + "i"] }).body, { model: "seedance-2.0", prompt: "A lighthouse at dawn", duration: 6, resolution: "480P", size: "1:1", images: [U + "i"] });
});

test("requests outside the documented shapes are refused, never sent half-right", () => {
  assert.throws(() => build(offer("apimart", "pixverse-v6"), { audio: "off", resolution: "720p", duration: 5, aspect_ratio: "16:9" }, "frames",
    { first_frame: [U + "1"], last_frame: [U + "2"] }), /transitions/);
  assert.throws(() => build(offer("apimart", "pixverse-v6"), { audio: "off", resolution: "720p", duration: 5, aspect_ratio: "21:9" }, "text"), /aspect_ratio/);
  assert.throws(() => build(offer("apimart", "wan2.6"), { duration: 5, resolution: "720p" }, "image", { first_frame: [U + "f"] }), /text only/);
  assert.throws(() => build(offer("apimart", "seedream-4"), { resolution: "1K", aspect_ratio: "1:1" }, null, {}, [U + "r"]), /text-to-image only/);
  assert.throws(() => build(offer("apimart", "flux-3-image-klein"), { resolution: "1K", aspect_ratio: "auto" }, null), /automatic ratio/);
  assert.throws(() => build(offer("apimart", "wan-3.0"), { audio: "on", resolution: "720P", duration: 5, aspect_ratio: "16:9", billed: 5 }, "frames",
    { first_frame: [U + "f"], reference_images: [U + "i"] }), /cannot be combined/);
  assert.throws(() => build(offer("poyo", "wan-2.7"), { resolution: "720p", duration: 8, aspect_ratio: "16:9" }, "text"), /duration/);
  assert.throws(() => build(offer("poyo", "happy-horse"), { resolution: "720p", duration: 5, aspect_ratio: "16:9" }, "image", { first_frame: [U + "f"], reference_images: [U + "c"] }),
    /cannot be combined/);
  assert.throws(() => build(offer("poyo", "gemini-omni-1.1-flash"), { resolution: "720p", duration: 5, aspect_ratio: "16:9" }, "text"), /duration/);
  assert.throws(() => build(offer("nezhagate", "seedance-2.0"), { audio: "off", resolution: "480p", duration: 5, aspect_ratio: "1:1" }, "text"), /cannot be switched off/);
});

test("the new builders are registered in code and in the offers migration (one row per adapter, under its supplier)", () => {
  const code = adaptersByProvider();
  for (const [name, [provider]] of Object.entries(SUPPLIER_ADAPTERS) as [string, [string, string]][]) assert.ok(code[provider]?.includes(name), `${provider}: ${name}`);
  for (const o of OFFER_LIST) assert.ok(code[o.provider]?.includes(o.adapter), `${o.provider} ${o.key}: ${o.adapter}`);
  // The offers migration: still in supabase/pending before the release, in supabase/migrations after it.
  const sql = ["../../supabase/migrations/", "../../supabase/pending/"].flatMap((d) => {
    const dir = new URL(d, import.meta.url);
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(new URL(f, dir), "utf8")) : [];
  }).find((t) => t.includes("Full catalog, part 5: supplier offers"));
  assert.ok(sql, "offers migration");
  for (const [name, [provider]] of Object.entries(SUPPLIER_ADAPTERS) as [string, [string, string]][]) assert.ok(sql.includes(`('${name}', '${provider}', '`), name);
});
