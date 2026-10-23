// Full catalog (22 Oct 2026): every model of supabase/catalog builds a documented KIE request for every input mode and
// every value a customer can choose; per-mode model ids; exact bodies for representative models. Nothing is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildInput, supportedAdapters } from "../../src/lib/providers/kie/adapters";
import { KieProvider } from "../../src/lib/providers/kie/client";
import { upstreamFor, upstreamIds } from "../../src/lib/providers/model-id";
import type { ClaimContext, SubmitRequest } from "../../src/lib/providers/types";
import { IMAGE_MODELS } from "../../supabase/catalog/models.mjs";
import { MODEL_UPDATES, VIDEO_MODELS } from "../../supabase/catalog/models-video.mjs";
import { KIE_ADAPTERS } from "../../supabase/catalog/adapters.mjs";

type Opt = { values: (string | number)[]; default: string | number; derived?: boolean };
type Slot = { kind: string; min?: number; max?: number };
type Mode = { id: string; uses: string[]; requires?: string[]; allowed?: Record<string, (string | number)[]> };
type Spec = { options: Record<string, Opt>; inputs?: Record<string, Slot>; modes?: Mode[]; references?: { min: number; max: number }; exclude?: Record<string, unknown>[];
  derived?: Record<string, { kind?: string; plus?: string }>; prompt?: { max?: number } };
type Model = { id: string; tool: "image" | "edit" | "video"; kie: { model: string; adapter: string }; spec: Spec };

const MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS, ...MODEL_UPDATES.map((u) => ({ ...u, tool: "video" }))] as unknown as Model[];

const ctx = (m: Model, options: Record<string, string | number>, mode: string | null, prompt = "A lighthouse at dawn"): ClaimContext => ({
  job: { id: "00000000-0000-4000-8000-0000000000a1", ref: "J1", userId: "u", state: "submitting", tool: m.tool, prompt, options, units: "4", mode },
  model: { id: m.id, providerModelId: m.kie.model, adapter: m.kie.adapter, adapterVersion: 1, providerAccountId: "a" },
  output: { kind: m.tool === "video" ? "video" : "image", mime: ["image/png"], count: 1, maxBytes: 1 },
  references: [],
  inputs: {},
  attempt: null,
});

/** Signed-URL stand-ins for the slots a mode needs (the minimum count of each used slot, at least one when required). */
function urlsFor(m: Model, mode: Mode | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!mode) return out;
  for (const s of mode.requires ?? []) {
    const n = Math.max(1, m.spec.inputs?.[s]?.min ?? 1);
    out[s] = Array.from({ length: n }, (_, i) => `https://files.example/${s}-${i}`);
  }
  return out;
}

function request(m: Model, options: Record<string, string | number>, mode: Mode | null, extra: Record<string, string[]> = {}): SubmitRequest {
  const refs = m.tool === "edit" ? Array.from({ length: Math.max(1, m.spec.references?.min ?? 1) }, (_, i) => `https://files.example/ref-${i}`) : [];
  const inputUrls = { ...urlsFor(m, mode), ...extra };
  const sourceTasks: Record<string, string[]> = inputUrls.source_job ? { source_job: ["task_abc123"] } : {};
  delete inputUrls.source_job;
  const prompt = (m.spec.prompt?.max ?? 1) === 0 ? "" : "A lighthouse at dawn";
  return { context: ctx(m, options, mode?.id ?? null, prompt), referenceUrls: refs, inputUrls, sourceTasks, callBackUrl: null };
}

const defaults = (spec: Spec) => Object.fromEntries(Object.entries(spec.options).map(([k, o]) => [k, o.default]));
const excluded = (spec: Spec, opts: Record<string, unknown>) => (spec.exclude ?? []).some((e) => Object.entries(e).every(([k, v]) => opts[k] === v));

test("the catalog's adapters are implemented, and every adapter in code has a description for its database row", () => {
  const code = new Set(supportedAdapters());
  for (const m of MODELS) assert.ok(code.has(m.kie.adapter), `${m.id}: adapter ${m.kie.adapter}`);
  for (const a of Object.keys(KIE_ADAPTERS)) assert.ok(code.has(a), `description for unknown adapter ${a}`);
});

test("every input mode of every model builds a request with its default settings", () => {
  let n = 0;
  for (const m of MODELS) {
    const modes: (Mode | null)[] = m.spec.modes?.length ? m.spec.modes : [null];
    for (const mode of modes) {
      const opts = { ...defaults(m.spec) };
      for (const [k, vals] of Object.entries(mode?.allowed ?? {})) if (!vals.includes(opts[k])) opts[k] = vals[0];
      if (excluded(m.spec, opts)) continue;
      assert.doesNotThrow(() => buildInput(request(m, opts, mode)), `${m.id} / ${mode?.id ?? "default"}`);
      n++;
    }
  }
  assert.ok(n > 120, `only ${n} mode requests`);
});

test("every value a customer can choose is accepted by the request builder (one setting at a time)", () => {
  for (const m of MODELS) {
    const modes: (Mode | null)[] = m.spec.modes?.length ? m.spec.modes : [null];
    for (const [k, o] of Object.entries(m.spec.options)) {
      if (o.derived) continue;
      for (const v of o.values) {
        // the first mode that allows this value
        const mode = modes.find((md) => !md?.allowed?.[k] || md.allowed[k].includes(v)) ?? null;
        const opts = { ...defaults(m.spec), [k]: v };
        for (const [ak, vals] of Object.entries(mode?.allowed ?? {})) if (!vals.includes(opts[ak])) opts[ak] = vals[0];
        if (excluded(m.spec, opts)) continue;
        assert.doesNotThrow(() => buildInput(request(m, opts, mode)), `${m.id}: ${k}=${v} (${mode?.id ?? "default"})`);
      }
    }
  }
});

test("per-mode KIE model ids: each named mode exists and resolves; a plain id serves every mode", () => {
  assert.equal(upstreamFor("veo-3-1", "frames"), "veo-3-1");
  assert.equal(upstreamFor("a/text;image=a/image;frames=a/frames", "image"), "a/image");
  assert.equal(upstreamFor("a/text;image=a/image", "reference"), "a/text");
  assert.equal(upstreamFor("a/text;image=a/image", null), "a/text");
  assert.deepEqual(upstreamIds("a/text;image=a/image;video=a/text"), ["a/text", "a/image"]);
  for (const m of MODELS) {
    const ids = (m.spec.modes ?? []).map((x) => x.id);
    for (const part of m.kie.model.split(";").slice(1)) assert.ok(ids.includes(part.split("=")[0]), `${m.id}: ${part}`);
    for (const id of upstreamIds(m.kie.model)) assert.match(id, /^[a-z0-9][a-z0-9./-]{1,80}$/, `${m.id}: ${id}`);
  }
  const kling = MODELS.find((m) => m.id === "kling-2-6")!;
  assert.equal(upstreamFor(kling.kie.model, "image"), "kling-2.6/image-to-video");
  assert.equal(upstreamFor(kling.kie.model, "text"), "kling-2.6/text-to-video");
});

test("the KIE create call sends the model id of the job's input mode (fetch is intercepted; nothing leaves the test)", async () => {
  const m = MODELS.find((x) => x.id === "pixverse-v6")!;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ code: 200, msg: "success", data: { taskId: "task_123456" } }), { status: 200 });
  }) as typeof fetch;
  try {
    const transition = m.spec.modes!.find((x) => x.id === "frames")!;
    const r = await new KieProvider("test-key").submit(request(m, { ...defaults(m.spec) }, transition));
    assert.deepEqual(r, { kind: "accepted", taskId: "task_123456" });
    assert.equal(sent[0].url, "https://api.kie.ai/api/v1/jobs/createTask");
    assert.equal(sent[0].body.model, "pixverse-v6/transition");
    const text = m.spec.modes!.find((x) => x.id === "text")!;
    await new KieProvider("test-key").submit(request(m, { ...defaults(m.spec) }, text));
    assert.equal(sent[1].body.model, "pixverse-v6/text-to-video");
  } finally {
    globalThis.fetch = real;
  }
});

// ------------------------------------------------------------------------------------- exact documented bodies

const model = (id: string) => MODELS.find((m) => m.id === id)!;
const modeOf = (m: Model, id: string) => m.spec.modes!.find((x) => x.id === id)!;
const body = (id: string, options: Record<string, string | number>, modeId: string | null, extra: Record<string, string[]> = {}) => {
  const m = model(id);
  return buildInput(request(m, { ...defaults(m.spec), ...options }, modeId ? modeOf(m, modeId) : null, extra));
};
const U = (s: string, i = 0) => `https://files.example/${s}-${i}`;

test("image builders: documented field names, enums and reference fields", () => {
  assert.deepEqual(body("gpt-image-1-5-edit", { quality: "high", aspect_ratio: "3:2" }, null), {
    prompt: "A lighthouse at dawn", input_urls: [U("ref")], aspect_ratio: "3:2", quality: "high",
  });
  assert.deepEqual(body("gpt-4o-image", { aspect_ratio: "2:3" }, null), { prompt: "A lighthouse at dawn", size: "2:3" });
  assert.deepEqual(body("seedream-4-image", { aspect_ratio: "21:9", resolution: "4K" }, null), {
    prompt: "A lighthouse at dawn", image_size: "landscape_21_9", image_resolution: "4K", max_images: 1, nsfw_checker: true,
  });
  assert.deepEqual(body("flux-kontext-edit", { tier: "max", aspect_ratio: "auto" }, null), {
    prompt: "A lighthouse at dawn", model: "flux-kontext-max", input_image: U("ref"), output_format: "png",
  });
  assert.deepEqual(body("ideogram-v3-image", { speed: "turbo", style: "DESIGN", aspect_ratio: "9:16" }, null), {
    prompt: "A lighthouse at dawn", rendering_speed: "TURBO", style: "DESIGN", image_size: "portrait_16_9",
  });
  assert.deepEqual(body("grok-imagine-image", {}, null), { prompt: "A lighthouse at dawn", aspect_ratio: "1:1", enable_pro: false, nsfw_checker: true });
  assert.deepEqual(body("wan-2-7-image-edit", { resolution: "2K" }, null), {
    prompt: "A lighthouse at dawn", input_urls: [U("ref")], resolution: "2K", n: 1, watermark: false, nsfw_checker: true,
  });
  assert.deepEqual(body("recraft-remove-background", {}, null), { image: U("ref") });
  // A text-to-image builder never forwards an attached reference; an edit builder refuses to run without one.
  const nb = model("nano-banana-image");
  assert.equal(buildInput({ ...request(nb, defaults(nb.spec), null), referenceUrls: [U("ref")] }).image_urls, undefined);
  const nbe = model("nano-banana-edit");
  assert.throws(() => buildInput({ ...request(nbe, defaults(nbe.spec), null), referenceUrls: [] }), /reference image missing/);
});

test("video builders: modes map to the documented fields and types", () => {
  // Kling 3.0 Omni: frames with aspect "auto", references with the chosen aspect, integer duration, boolean audio
  assert.deepEqual(body("kling-3-0-omni", { resolution: "4k", audio: "off", duration: 8 }, "frames", { last_frame: [U("last_frame")] }), {
    prompt: "A lighthouse at dawn", duration: 8, resolution: "4k", audio: false, image_urls: [U("first_frame"), U("last_frame")], aspect_ratio: "auto",
  });
  // Kling 4.0 keyframes: first, middle, last (no aspect ratio)
  assert.deepEqual(body("kling-4-0", { duration: 10 }, "frames", { keyframes: [U("k", 0), U("k", 1)], last_frame: [U("last_frame")] }), {
    prompt: "A lighthouse at dawn", duration: 10, resolution: "720p", first_frame_url: U("first_frame"), keyframe_urls: [U("k", 0), U("k", 1)], last_frame_url: U("last_frame"),
  });
  // Kling 2.6: string duration, sound boolean, image_urls with a start frame
  assert.deepEqual(body("kling-2-6", { audio: "on", duration: 10 }, "image"), { prompt: "A lighthouse at dawn", sound: true, duration: "10", image_urls: [U("first_frame")] });
  // Seedance 2.0 with a reference video
  const sd = body("seedance-2-0", { resolution: "1080p", duration: 8 }, "video", { reference_videos: [U("reference_videos")] });
  assert.deepEqual(sd.reference_video_urls, [U("reference_videos")]);
  assert.equal(sd.duration, 8);
  assert.equal(sd.first_frame_url, undefined);
  // Hailuo 02 Standard text-to-video takes no resolution field; image-to-video does
  assert.equal(body("hailuo-02-standard", {}, "text").resolution, undefined);
  assert.equal(body("hailuo-02-standard", { resolution: "512P" }, "frames").resolution, "512P");
  // MiniMax H3 references: images, videos and audio; audio alone is refused
  const mh = body("minimax-h3", { aspect_ratio: "adaptive" }, "reference", { reference_videos: [U("v")], reference_audio: [U("a")] });
  assert.deepEqual([mh.reference_image_urls, mh.reference_video_urls, mh.reference_audio_urls, mh.aspect_ratio], [[U("reference_images")], [U("v")], [U("a")], "adaptive"]);
  assert.throws(() => body("minimax-h3", {}, "text", { reference_audio: [U("a")] }), /reference audio needs/);
  // Wan 2.7: ratio for text, reference_image for references (10 s at most)
  assert.equal(body("wan-2-7", { aspect_ratio: "4:3" }, "text").ratio, "4:3");
  assert.deepEqual(body("wan-2-7", { duration: 10 }, "reference").reference_image, [U("reference_images")]);
  assert.throws(() => body("wan-2-7", { duration: 15 }, "reference"), /unsupported duration/);
  // Wan 2.6 (existing model, new adapter): a job without a mode still sends the text-to-video request it always sent
  const wan = model("wan-2-6");
  assert.deepEqual(buildInput(request(wan, { duration: 15, resolution: "1080p" }, null)), {
    prompt: "A lighthouse at dawn", duration: "15", resolution: "1080p", multi_shots: false, nsfw_checker: true,
  });
  assert.equal(upstreamFor(wan.kie.model, null), "wan/2-6-text-to-video");
  // PixVerse fusion references are named for "@ref1" mentions
  assert.deepEqual(body("pixverse-v6", {}, "reference", { reference_images: [U("r", 0), U("r", 1)] }).image_references, [
    { image_url: U("r", 0), type: "subject", ref_name: "ref1" }, { image_url: U("r", 1), type: "subject", ref_name: "ref2" },
  ]);
  // PixVerse Extend needs a seed: stable for the job
  assert.equal(body("pixverse-v6-extend", {}, "extend").seed, body("pixverse-v6-extend", {}, "extend").seed);
  // Grok: several images are refused at 1080p; one image sends a string duration
  assert.throws(() => body("grok-imagine-video", { resolution: "1080p" }, "reference", { reference_images: [U("a"), U("b")] }), /1080p/);
  assert.equal(body("grok-imagine-video", { duration: 10 }, "image").duration, "10");
  // Runway: 10 s at 1080p is refused even if the quote let it through
  assert.throws(() => body("runway-gen-4-turbo", { resolution: "1080p", duration: 10 }, "text"), /720p only/);
  assert.deepEqual(body("runway-gen-4-turbo-extend", { resolution: "720p" }, "extend"), { task_id: "task_abc123", prompt: "A lighthouse at dawn", quality: "720p" });
  // Avatars: portrait + audio; OmniHuman's prompt is optional and its resolution is "720" | "1080"
  assert.deepEqual(body("omnihuman-1-5", { resolution: "720p" }, "avatar"), { image_url: U("portrait_image"), audio_url: U("speech_audio"), prompt: "A lighthouse at dawn", output_resolution: "720" });
  // Tools without a prompt never send one
  assert.deepEqual(body("topaz-video-upscale", { factor: "4" }, "edit"), { video_url: U("source_video"), upscale_factor: "4" });
  assert.deepEqual(body("wan-2-2-animate-replace", { resolution: "580p" }, "motion"), { video_url: U("motion_video"), image_url: U("character_image"), resolution: "580p", nsfw_checker: true });
});

test("the catalog migrations register exactly the adapters of the catalog source", () => {
  const dir = new URL("../../supabase/", import.meta.url);
  const sqlFiles = ["migrations", "pending"].flatMap((d) => {
    try {
      return readdirSync(new URL(`${d}/`, dir)).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(new URL(`${d}/${f}`, dir), "utf8"));
    } catch {
      return [];
    }
  });
  const rows = new Set(sqlFiles.flatMap((sql) => [...sql.matchAll(/\('(kie-[a-z0-9-]+)', 'kie', '/g)].map((x) => x[1])));
  for (const a of Object.keys(KIE_ADAPTERS)) assert.ok(rows.has(a), `no provider_adapters row for ${a}`);
});
