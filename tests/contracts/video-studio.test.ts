// Video studio composer rules: model filtering per tab, the exact priced request, input checks (15 Oct 2026).
// Model shapes mirror the production catalog (capability specs of the video models).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogModel, InputSlotSpec } from "../../src/lib/live/types";
import {
  derivedSeconds,
  effectiveOptions,
  emptyDraft,
  estimateSupplierCredits,
  factsProblem,
  loadDrafts,
  missingReason,
  onSale,
  operationOf,
  quoteRequest,
  routeFiles,
  saveDrafts,
  visibleOptions,
  visibleSlots,
  type Draft,
  type DraftInput,
} from "../../src/lib/live/video-studio";

const IMG = ["image/png", "image/jpeg", "image/webp"];
const img = (label: string, over: Partial<InputSlotSpec> = {}): InputSlotSpec => ({ kind: "image", label, min: 1, max: 1, mime: IMG, minSide: 300, maxBytes: 10485760, aspectMin: 0.4, aspectMax: 2.5, ...over });
const base = (over: Partial<CatalogModel>): CatalogModel => ({
  id: "x",
  tool: "video",
  operation: "create",
  name: "X",
  purpose: null,
  state: "enabled",
  note: null,
  options: {},
  prompt: { min: 3, max: 2000 },
  references: { min: 0, max: 0 },
  output: { kind: "video", count: 1 },
  fixed: null,
  priced: true,
  ...over,
});

const veo = base({
  id: "veo-3-1-lite",
  name: "Veo 3.1 Lite",
  family: "Veo 3.1",
  options: {
    duration: { label: "Length (seconds)", values: [4, 6, 8], default: 8 },
    resolution: { label: "Resolution", values: ["720p", "1080p", "4k"], default: "720p" },
    aspect_ratio: { label: "Aspect ratio", values: ["16:9", "9:16"], default: "16:9" },
    variant: { label: "Tier", values: ["veo3_lite"], default: "veo3_lite" },
  },
  inputs: { first_frame: img("Start frame"), last_frame: img("End frame", { needs: ["first_frame"] }), reference_images: img("Reference images", { max: 3 }) },
  modes: [
    { id: "text", uses: [], label: "Text to video" },
    { id: "frames", uses: ["first_frame", "last_frame"], requires: ["first_frame"], label: "Start and end frames" },
    { id: "reference", uses: ["reference_images"], requires: ["reference_images"], allowed: { duration: [8] }, label: "Reference images" },
  ],
});
const kling = base({
  id: "kling-3-0",
  name: "Kling 3.0",
  prompt: { min: 3, max: 2500 },
  options: {
    duration: { label: "Length (seconds)", values: [5, 10, 15], default: 5 },
    aspect_ratio: { label: "Aspect ratio", values: ["16:9", "9:16", "1:1"], default: "16:9" },
    audio: { label: "Sound", values: ["on", "off"], default: "on" },
  },
  inputs: {
    first_frame: img("Start frame", { mime: ["image/png", "image/jpeg"], hides: ["aspect_ratio"] }),
    last_frame: img("End frame", { mime: ["image/png", "image/jpeg"], needs: ["first_frame"] }),
    element_1: img("Element 1", { mime: ["image/png", "image/jpeg"], min: 2, max: 4, group: "elements", mention: "@element1" }),
  },
  modes: [{ id: "create", uses: ["first_frame", "last_frame", "element_1"], label: "Text, frames and elements" }],
});
const wan = base({ id: "wan-2-6", name: "Wan 2.6", options: { duration: { label: "Length (seconds)", values: [5, 10, 15], default: 5 } }, inputs: null, modes: null });
const edit = base({
  id: "seedance-2-5-edit",
  name: "Seedance 2.5 Edit",
  operation: "edit",
  state: "disabled",
  priced: false,
  options: {
    resolution: { label: "Resolution", values: ["480p", "720p"], default: "720p" },
    seconds: { label: "Video length (s)", values: [4, 5, 6, 7, 8, 30], default: 5, derived: true },
    audio: { label: "Sound", values: ["on", "off"], default: "on" },
  },
  inputs: {
    source_video: { kind: "video", label: "Video to edit", min: 1, max: 1, mime: ["video/mp4", "video/quicktime"], minSeconds: 4, maxSeconds: 30, minPixels: 409600, maxPixels: 927408, fpsMin: 24, fpsMax: 60 },
    reference_images: img("Reference images", { max: 9 }),
    reference_audio: { kind: "audio", label: "Reference audio", min: 1, max: 3, mime: ["audio/mpeg", "audio/wav", "audio/mp4"], minSeconds: 2, maxSeconds: 30, totalMaxSeconds: 30 },
  },
  modes: [{ id: "edit", uses: ["source_video", "reference_images", "reference_audio"], requires: ["source_video"], label: "Edit with a prompt" }],
  derived: { seconds: { from: "source_video" } },
  costSchedule: { unit: "second", dims: ["resolution"], rates: { "480p": 17, "720p": 38 }, durationOption: "seconds", secondsFactor: 2 },
});
const motion = base({
  id: "kling-3-0-motion",
  name: "Kling 3.0 Motion Control",
  operation: "motion",
  state: "disabled",
  priced: false,
  prompt: { min: 0, max: 2500, optional: true },
  options: {
    mode: { label: "Quality", values: ["720p", "1080p"], default: "720p" },
    seconds: { label: "Motion length (s)", values: [3, 5, 10, 30], default: 5, derived: true },
    orientation: { label: "Character orientation", values: ["video", "image"], default: "video" },
  },
  inputs: {
    motion_video: { kind: "video", label: "Motion to copy", min: 1, max: 1, mime: ["video/mp4", "video/quicktime"], minSeconds: 3, maxSeconds: 30, minSide: 341 },
    character_image: img("Your character", { mime: ["image/png", "image/jpeg"], minSide: 341 }),
  },
  modes: [{ id: "motion", uses: ["motion_video", "character_image"], requires: ["motion_video", "character_image"], label: "Copy motion" }],
  rules: [{ when: { orientation: "image" }, slot: "motion_video", maxSeconds: 10, message: "With “Keep the image's pose” the motion video can be up to 10 seconds." }],
  derived: { seconds: { from: "motion_video" } },
  costSchedule: { unit: "second", dims: ["mode"], rates: { "720p": 20, "1080p": 27 }, durationOption: "seconds" },
});
const extend = base({
  id: "veo-3-1-extend",
  operation: "extend",
  state: "disabled",
  priced: false,
  options: { tier: { label: "Tier", values: ["fast", "lite", "quality"], default: "fast" } },
  inputs: { source_job: { kind: "job", label: "Video to extend", min: 1, max: 1, families: ["Veo 3.1"], maxAgeDays: 13 } },
  modes: [{ id: "extend", uses: ["source_job"], requires: ["source_job"] }],
  costSchedule: { unit: "output", dims: ["tier"], rates: { fast: 60, lite: 30, quality: 250 } },
});

let n = 0;
const ready = (over: Partial<DraftInput>): DraftInput => ({ key: `k${++n}`, status: "ready", progress: 1, name: "f", mime: "image/png", kind: "image", assetId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, ...over });
const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over });

test("each tab offers only models of its operation, and only models on sale to customers", () => {
  const all = [veo, kling, wan, edit, motion, extend];
  const forOp = (op: string) => all.filter((m) => operationOf(m) === op && onSale(m)).map((m) => m.id);
  assert.deepEqual(forOp("create"), ["veo-3-1-lite", "kling-3-0", "wan-2-6"]);
  // A text-to-video model is never offered as an editor or for motion transfer; disabled/unpriced models stay off sale.
  assert.deepEqual(forOp("edit"), []);
  assert.deepEqual(forOp("motion"), []);
  assert.deepEqual(forOp("extend"), []);
  assert.equal(operationOf({ ...wan, operation: undefined }), "create");
  assert.equal(onSale({ ...edit, state: "enabled", priced: true }), true);
});

test("only inputs of the visible combination are priced; hidden stale files never ride along", () => {
  const d = draft({ prompt: "A lighthouse at dusk", modeId: "text", slots: { first_frame: [ready({})], reference_images: [ready({})] } });
  const req = quoteRequest(veo, d)!;
  assert.deepEqual(req.inputs, {});
  assert.deepEqual(Object.keys(effectiveOptions(veo, d)).sort(), ["aspect_ratio", "duration", "resolution", "variant"]);
  const frames = quoteRequest(veo, { ...d, modeId: "frames" })!;
  assert.deepEqual(Object.keys(frames.inputs), ["first_frame"]);
  const refs = quoteRequest(veo, { ...d, modeId: "reference", options: { duration: 4 } })!;
  assert.deepEqual(Object.keys(refs.inputs), ["reference_images"]);
  // Reference images work only with 8-second clips: the length is snapped, never sent as 4.
  assert.equal(refs.options.duration, 8);
  assert.deepEqual(visibleOptions(veo, { ...d, modeId: "reference" }).find(([k]) => k === "duration")![1].values, [8]);
});

test("required, dependent and mentioned inputs are explained before any price is requested", () => {
  assert.equal(missingReason(veo, draft({ prompt: "Waves", modeId: "frames" })), "Add a start frame");
  assert.equal(missingReason(veo, draft({ prompt: "Waves", modeId: "reference" })), "Add reference images");
  assert.match(missingReason(kling, draft({ prompt: "A walk", slots: { last_frame: [ready({})] } }))!, /End frame needs start frame/);
  assert.match(missingReason(kling, draft({ prompt: "@element1 walks", slots: {} }))!, /Add images for @element1/);
  assert.match(missingReason(kling, draft({ prompt: "@element1 walks", slots: { element_1: [ready({})] } }))!, /at least 2/);
  assert.equal(missingReason(kling, draft({ prompt: "@element1 walks", slots: { element_1: [ready({}), ready({})] } })), null);
  assert.equal(missingReason(veo, draft({ prompt: "" })), "Describe what you want");
  assert.equal(missingReason(veo, draft({ prompt: "x".repeat(2001) })), "The prompt is too long for this model");
  assert.equal(quoteRequest(veo, draft({ prompt: "" })), null);
  assert.equal(missingReason(null, draft({ prompt: "x" })), "Choose a model");
});

test("an upload in progress or a refused file blocks the price; a type the model refuses is named", () => {
  const up = draft({ prompt: "Waves", modeId: "frames", slots: { first_frame: [{ ...ready({}), status: "uploading", assetId: undefined }] } });
  assert.equal(missingReason(veo, up), "Waiting for the upload to finish");
  const bad = draft({ prompt: "Waves", modeId: "frames", slots: { first_frame: [{ ...ready({}), status: "error", error: "x" }] } });
  assert.equal(missingReason(veo, bad), "Remove the file that could not be used");
  // A WEBP start frame chosen for one model is not silently sent to a model that only takes PNG/JPG.
  const webp = draft({ prompt: "Waves", slots: { first_frame: [ready({ mime: "image/webp" })] } });
  assert.match(missingReason(kling, webp)!, /does not accept WEBP/);
});

test("a used start frame hides the aspect ratio when the model takes the shape from the image", () => {
  const d = draft({ prompt: "A walk", options: { aspect_ratio: "9:16" }, slots: { first_frame: [ready({ mime: "image/jpeg" })] } });
  assert.equal(visibleOptions(kling, d).some(([k]) => k === "aspect_ratio"), false);
  assert.equal(quoteRequest(kling, d)!.options.aspect_ratio, undefined);
  assert.equal(quoteRequest(kling, { ...d, slots: {} })!.options.aspect_ratio, "9:16");
});

test("edit: the source clip is required, its length is derived by the server and never sent", () => {
  assert.equal(missingReason(edit, draft({ prompt: "Make it snow" })), "Add a video to edit");
  const clip = ready({ mime: "video/mp4", kind: "video", durationMs: 6200, width: 1280, height: 720 });
  const d = draft({ prompt: "Make it snow", slots: { source_video: [clip] } });
  const req = quoteRequest(edit, d)!;
  assert.deepEqual(Object.keys(req.inputs), ["source_video"]);
  assert.equal(req.options.seconds, undefined);
  assert.equal(derivedSeconds(edit, d), 7);
  assert.equal(estimateSupplierCredits(edit, { ...req.options, seconds: 7 }, 7), 38 * 7 * 2);
  // Too short, too big, too much reference audio.
  assert.match(missingReason(edit, draft({ prompt: "x y z", slots: { source_video: [{ ...clip, durationMs: 3000 }] } }))!, /at least 4 s/);
  assert.match(missingReason(edit, draft({ prompt: "x y z", slots: { source_video: [{ ...clip, width: 1920, height: 1080 }] } }))!, /largest size/);
  const audio = (ms: number) => ready({ mime: "audio/mpeg", kind: "audio", durationMs: ms });
  assert.match(missingReason(edit, draft({ prompt: "x y z", slots: { source_video: [clip], reference_audio: [audio(20_000), audio(15_000)] } }))!, /30 s in total/);
});

test("motion: prompt optional, orientation rule limits the clip, background is not an option", () => {
  const video = ready({ mime: "video/mp4", kind: "video", durationMs: 15_000, width: 720, height: 1280 });
  const person = ready({ mime: "image/jpeg", width: 768, height: 1024 });
  assert.equal(missingReason(motion, draft({})), "Add the motion to copy");
  assert.equal(missingReason(motion, draft({ slots: { motion_video: [video] } })), "Add your character");
  const d = draft({ slots: { motion_video: [video], character_image: [person] } });
  assert.equal(missingReason(motion, d), null);
  assert.deepEqual(quoteRequest(motion, d)!.options, { mode: "720p", orientation: "video" });
  const keepPose = { ...d, options: { orientation: "image" } };
  assert.match(missingReason(motion, keepPose)!, /up to 10 seconds/);
  assert.equal(quoteRequest(motion, keepPose), null);
  assert.equal(estimateSupplierCredits(motion, { mode: "720p", seconds: 15 }, 15), 300);
  assert.equal(Object.keys(motion.options).includes("background"), false);
});

test("extend: a chosen own job is sent by job id; price estimate by tier", () => {
  const d = draft({ prompt: "Keep rising", slots: { source_job: [ready({ kind: "job", mime: "video/mp4", jobId: "11111111-1111-4111-8111-111111111111" })] } });
  assert.deepEqual(quoteRequest(extend, d)!.inputs, { source_job: ["11111111-1111-4111-8111-111111111111"] });
  assert.equal(missingReason(extend, draft({ prompt: "Keep rising" })), "Choose a video to extend");
  assert.equal(estimateSupplierCredits(extend, { tier: "lite" }), 30);
});

test("dropped files go to the first slot that accepts the type and has room", () => {
  const d = draft({ slots: { reference_images: [ready({}), ready({})] } });
  const files = [{ mime: "image/png" }, { mime: "audio/mpeg" }, { mime: "video/mp4" }, { mime: "image/jpeg" }, { mime: "image/webp" }];
  const { placed, rejected } = routeFiles(edit, d, files);
  assert.deepEqual(placed.map((p) => [p.slot, p.file.mime]), [["reference_images", "image/png"], ["reference_audio", "audio/mpeg"], ["source_video", "video/mp4"], ["reference_images", "image/jpeg"], ["reference_images", "image/webp"]]);
  assert.equal(rejected.length, 0);
  const only = routeFiles(edit, d, files, ["reference_images", "reference_audio"]);
  assert.deepEqual(only.rejected.map((f) => f.mime), ["video/mp4"]);
  const full = routeFiles(veo, draft({ modeId: "reference", slots: { reference_images: [ready({}), ready({}), ready({})] } }), [{ mime: "image/png" }]);
  assert.equal(full.rejected.length, 1);
  assert.deepEqual(visibleSlots(veo, "text"), []);
});

test("facts read in the browser catch obvious mismatches; unknown facts pass to the server", () => {
  const spec = motion.inputs!.motion_video;
  assert.equal(factsProblem(motion, "motion_video", spec, {}), null);
  assert.match(factsProblem(motion, "motion_video", spec, { durationMs: 2000 })!, /at least 3 s/);
  assert.match(factsProblem(motion, "motion_video", spec, { durationMs: 31_000 })!, /up to 30 s/);
  assert.equal(factsProblem(motion, "motion_video", spec, { durationMs: 12_000 }), null);
  assert.match(factsProblem(motion, "motion_video", spec, { durationMs: 12_000 }, { orientation: "image" })!, /up to 10 seconds/);
  assert.match(factsProblem(veo, "first_frame", veo.inputs!.first_frame, { width: 200, height: 400 })!, /too small/);
  assert.match(factsProblem(veo, "first_frame", veo.inputs!.first_frame, { width: 3000, height: 1000 })!, /too narrow or too wide/);
});

test("drafts persist per account without local file links or unfinished uploads", () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  const keep = ready({ previewUrl: "blob:local" });
  const drafts = {
    create: draft({ prompt: "Waves", modelId: "veo-3-1-lite", modeId: "frames", slots: { first_frame: [keep, { ...ready({}), status: "uploading" }] } }),
    extend: draft({}),
    edit: draft({ prompt: "Snow" }),
    motion: draft({}),
    avatar: draft({ prompt: "Smiles" }),
  };
  saveDrafts("user-a", drafts);
  const back = loadDrafts("user-a");
  assert.equal(back.create!.prompt, "Waves");
  assert.equal(back.create!.slots.first_frame.length, 1);
  assert.equal(back.create!.slots.first_frame[0].previewUrl, undefined);
  assert.equal(back.edit!.prompt, "Snow");
  assert.equal(back.avatar!.prompt, "Smiles");
  assert.deepEqual(loadDrafts("user-b"), {});
  store.set("genlixs-video-studio-v1:user-c", "{not json");
  assert.deepEqual(loadDrafts("user-c"), {});
});
