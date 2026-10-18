// Motion Library, walkthrough videos and the Recreate handoff (18 Oct 2026). The motion model mirrors the production
// capability of Kling 3.0 Motion Control (vm3 migration): motion video 3–30 s, 10 s with "Keep the image's pose".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CatalogModel } from "../../src/lib/live/types";
import { emptyDraft, quoteRequest, type Draft } from "../../src/lib/live/video-studio";
import { MOTION_LIBRARY, motionItem, motionSlots, recreatePlan, type MotionItem } from "../../src/lib/motion-library";
import { TUTORIALS } from "../../src/lib/tutorials";
import { canvasViewOf } from "../../src/lib/studio-routes";

const PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
const motion: CatalogModel = {
  id: "kling-3-0-motion",
  tool: "video",
  operation: "motion",
  name: "Kling 3.0 Motion Control",
  purpose: null,
  state: "enabled",
  note: null,
  options: {
    mode: { values: ["720p", "1080p"], default: "720p", label: "Quality" },
    orientation: { values: ["video", "image"], default: "video", label: "Character orientation", labels: { video: "Follow the video", image: "Keep the image's pose" } },
    seconds: { values: Array.from({ length: 28 }, (_, i) => i + 3), default: 5, label: "Motion length (s)", derived: true },
  },
  prompt: { min: 0, max: 2500, optional: true },
  references: { min: 0, max: 0 },
  inputs: {
    motion_video: { kind: "video", label: "Motion to copy", min: 1, max: 1, mime: ["video/mp4", "video/quicktime"], maxBytes: 52428800, minSeconds: 3, maxSeconds: 30, minSide: 341, aspectMin: 0.4, aspectMax: 2.5 },
    character_image: { kind: "image", label: "Your character", min: 1, max: 1, mime: ["image/png", "image/jpeg"], maxBytes: 10485760, minSide: 341, aspectMin: 0.4, aspectMax: 2.5 },
  },
  modes: [{ id: "motion", label: "Copy motion", uses: ["motion_video", "character_image"], requires: ["motion_video", "character_image"] }],
  rules: [{ when: { orientation: "image" }, slot: "motion_video", maxSeconds: 10, message: "With “Keep the image's pose” the motion video can be up to 10 seconds." }],
  derived: { seconds: { from: "motion_video" } },
  output: { kind: "video", count: 1 },
  fixed: null,
  priced: true,
};
const clip = (over: Partial<MotionItem>): MotionItem => ({ ...MOTION_LIBRARY[0], ...over });
const local = (src: string) => `${PUBLIC}${src}`;

test("library: every clip is a usable motion reference, from both source folders, served from this site", () => {
  const ids = new Set<string>();
  for (const m of MOTION_LIBRARY) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.ok(m.durationMs >= 3000 && m.durationMs <= 30_000, `${m.id} length ${m.durationMs}`);
    assert.ok(Math.min(m.width, m.height) >= 341 && m.width / m.height >= 0.4 && m.width / m.height <= 2.5, `${m.id} size`);
    for (const p of [m.src, m.poster]) {
      assert.match(p, /^\/media\//, `${m.id} must use a site path, never a local Windows path`);
      assert.ok(existsSync(local(p)), `${p} missing`);
    }
  }
  assert.deepEqual(new Set(MOTION_LIBRARY.map((m) => m.source)), new Set(["EXPLORS", "EXPLORS 2"]));
  assert.equal(motionItem("studio-session-solo")?.durationMs, 4917, "the single-shot excerpt stays within 3–30 s");
});

test("walkthroughs: distinct local videos with posters and thumbnails", () => {
  assert.ok(TUTORIALS.length >= 3);
  assert.equal(new Set(TUTORIALS.map((t) => t.src)).size, TUTORIALS.length);
  for (const t of TUTORIALS) for (const p of [t.src, t.poster, t.thumb]) assert.ok(p.startsWith("/media/tutorials/") && existsSync(local(p)), p);
});

test("recreate: the library clip and the customer's inputs go to the motion workflow, priced before anything runs", () => {
  const draft: Draft = { ...emptyDraft(), prompt: "in a neon-lit studio", options: { mode: "1080p" } };
  const plan = recreatePlan(motion, draft, clip({ durationMs: 8042 }), "in a neon-lit studio");
  assert.ok(!("error" in plan));
  if ("error" in plan) return;
  assert.deepEqual({ v: plan.videoSlot, i: plan.imageSlot, p: plan.prompt, o: plan.options, n: plan.notes }, {
    v: "motion_video",
    i: "character_image",
    p: "in a neon-lit studio",
    o: { mode: "1080p" },
    n: [],
  });
  // Once both uploads are verified, the priced request carries the library clip as the motion video.
  const ready: Draft = {
    ...draft,
    slots: {
      motion_video: [{ key: "v", status: "ready", progress: 1, name: "Motion Library · clip", mime: "video/mp4", kind: "video", assetId: "asset-clip", durationMs: 8042, width: 540, height: 960 }],
      character_image: [{ key: "i", status: "ready", progress: 1, name: "me.png", mime: "image/png", kind: "image", assetId: "asset-me", width: 1024, height: 1536 }],
    },
  };
  assert.deepEqual(quoteRequest(motion, ready)?.inputs, { motion_video: ["asset-clip"], character_image: ["asset-me"] });
  // Nothing is priced while the clip is still being fetched or uploaded.
  assert.equal(quoteRequest(motion, { ...ready, slots: { ...ready.slots, motion_video: [{ ...ready.slots.motion_video[0], status: "uploading", assetId: undefined }] } }), null);
});

test("recreate: a setting that blocks the clip is changed with an explanation; impossible clips and prompts are refused", () => {
  const draft: Draft = { ...emptyDraft(), options: { orientation: "image" } };
  const long = recreatePlan(motion, draft, clip({ durationMs: 17_042 }), "");
  assert.ok(!("error" in long) && long.options.orientation === "video" && /Follow the video/.test(long.notes[0]), JSON.stringify(long));
  const short = recreatePlan(motion, draft, clip({ durationMs: 8042 }), "");
  assert.ok(!("error" in short) && short.options.orientation === "image" && short.notes.length === 0);
  assert.match((recreatePlan(motion, emptyDraft(), clip({ durationMs: 2000 }), "") as { error: string }).error, /at least 3 s/);
  assert.match((recreatePlan(motion, emptyDraft(), clip({ durationMs: 31_000 }), "") as { error: string }).error, /up to 30 s/);
  assert.match((recreatePlan(motion, emptyDraft(), clip({}), "x".repeat(2501)) as { error: string }).error, /longer than this model accepts/);
  assert.match((recreatePlan(null, emptyDraft(), clip({}), "") as { error: string }).error, /not available/);
  assert.match((recreatePlan({ ...motion, inputs: {} }, emptyDraft(), clip({}), "") as { error: string }).error, /motion video and a character image/);
  assert.deepEqual(motionSlots(motion)?.video[0], "motion_video");
});

test("views: the studio opens on How it works; links choose a known view; a job link opens History", () => {
  assert.equal(canvasViewOf(null), "how");
  assert.equal(canvasViewOf("styles"), "how");
  assert.equal(canvasViewOf("library"), "library");
  assert.equal(canvasViewOf("history"), "history");
  assert.equal(canvasViewOf(undefined, "history"), "history");
  assert.equal(canvasViewOf("how", "history"), "how");
});
