// Studio rules for the full catalog (22 Oct 2026): excluded setting combinations, prompt-free tools, a combination chosen
// on another model, billed seconds with reference videos, the model picker's summaries and "from" prices.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogModel, InputSlotSpec } from "../../src/lib/live/types";
import {
  activeMode,
  billedSeconds,
  emptyDraft,
  excludedValues,
  exclusionProblem,
  missingReason,
  quoteRequest,
  takesNoPrompt,
  visibleSlots,
  type Draft,
  type DraftInput,
} from "../../src/lib/live/video-studio";
import { capabilitySummary, fromCredits } from "../../src/lib/live/model-summary";
import { providerOf } from "../../src/lib/live/makers";

const IMG = ["image/png", "image/jpeg", "image/webp"];
const img = (label: string, over: Partial<InputSlotSpec> = {}): InputSlotSpec => ({ kind: "image", label, min: 1, max: 1, mime: IMG, ...over });
const base = (over: Partial<CatalogModel>): CatalogModel => ({
  id: "x", tool: "video", operation: "create", name: "X", purpose: null, state: "enabled", note: null, options: {},
  prompt: { min: 3, max: 2000 }, references: { min: 0, max: 0 }, output: { kind: "video", count: 1 }, fixed: null, priced: true, ...over,
});
const ready = (over: Partial<DraftInput>): DraftInput => ({ key: Math.random().toString(36), status: "ready", progress: 1, name: "f", mime: "image/png", kind: "image", assetId: "a1", ...over });
const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over });

const hailuo = base({
  id: "hailuo-2-3-standard",
  name: "Hailuo 2.3 Standard",
  family: "Hailuo 2.3",
  options: {
    resolution: { label: "Resolution", values: ["768P", "1080P"], default: "768P", labels: { "768P": "768p", "1080P": "1080p" } },
    duration: { label: "Length (seconds)", values: [6, 10], default: 6 },
  },
  inputs: { first_frame: img("Start frame") },
  modes: [{ id: "image", uses: ["first_frame"], requires: ["first_frame"] }],
  exclude: [{ resolution: "1080P", duration: 10 }],
  excludeMessage: "10-second clips are available at 768p only.",
  priceRules: { format: "table", dims: ["resolution", "duration"], units: { "768P|6": 15, "768P|10": 25, "1080P|6": 25 } },
});

test("excluded combinations: refused with the model's message, and the other values stay available", () => {
  assert.equal(exclusionProblem(hailuo, { resolution: "1080P", duration: 10 }), "10-second clips are available at 768p only.");
  assert.equal(exclusionProblem(hailuo, { resolution: "1080P", duration: 6 }), null);
  // At 1080p the 10 s value is the one shown as unavailable; at 768p every length is available.
  assert.deepEqual([...excludedValues(hailuo, { resolution: "1080P", duration: 6 }, "duration", [6, 10])], ["10"]);
  assert.deepEqual([...excludedValues(hailuo, { resolution: "768P", duration: 6 }, "duration", [6, 10])], []);
  const d = draft({ modelId: hailuo.id, prompt: "A fox in snow", options: { resolution: "1080P", duration: 10 }, slots: { first_frame: [ready({})] } });
  assert.equal(missingReason(hailuo, d), "10-second clips are available at 768p only.");
  assert.equal(quoteRequest(hailuo, d), null, "an excluded combination is never priced");
  assert.ok(quoteRequest(hailuo, { ...d, options: { resolution: "1080P", duration: 6 } }));
});

test("a tool that takes no prompt sends none, even if one was typed for another model", () => {
  const topaz = base({
    id: "topaz-video-upscale",
    name: "Topaz Video Upscale",
    operation: "edit",
    prompt: { min: 0, max: 0, optional: true },
    options: { factor: { label: "Upscale", values: ["1", "2", "4"], default: "2" } },
    inputs: { source_video: { kind: "video", label: "Video to upscale", min: 1, max: 1, mime: ["video/mp4"] } },
    modes: [{ id: "edit", uses: ["source_video"], requires: ["source_video"] }],
  });
  assert.equal(takesNoPrompt(topaz), true);
  const d = draft({ modelId: topaz.id, prompt: "Left over from another model", slots: { source_video: [ready({ mime: "video/mp4", kind: "video" })] } });
  assert.equal(missingReason(topaz, d), null);
  assert.equal(quoteRequest(topaz, d)?.prompt, "");
});

test("a combination chosen on another model falls back to the one that takes the files already added", () => {
  const kling26 = base({
    id: "kling-2-6",
    inputs: { first_frame: img("Start frame") },
    modes: [{ id: "text", uses: [] }, { id: "image", uses: ["first_frame"], requires: ["first_frame"] }],
  });
  const d = draft({ modeId: "frames", slots: { first_frame: [ready({})] } });
  assert.equal(activeMode(kling26, d.modeId, d.slots).id, "image");
  assert.deepEqual(visibleSlots(kling26, d.modeId, d.slots).map(([k]) => k), ["first_frame"]);
  assert.equal(activeMode(kling26, "frames").id, "text", "without files the first combination applies");
});

test("billed seconds: clip length plus the reference videos' total, rounded up like the server", () => {
  const seedance = base({
    id: "seedance-2-0",
    options: { duration: { label: "Length (seconds)", values: [4, 5, 8], default: 5 } },
    inputs: { reference_videos: { kind: "video", label: "Reference videos", min: 1, max: 3, mime: ["video/mp4"] } },
    derived: { billed: { kind: "billed_seconds", from: ["reference_videos"], plus: "duration" }, with_video: { kind: "present", from: ["reference_videos"] } },
  });
  const d = draft({ slots: { reference_videos: [ready({ kind: "video", mime: "video/mp4", durationMs: 6200 }), ready({ kind: "video", mime: "video/mp4", durationMs: 3000 })] } });
  assert.equal(billedSeconds(seedance, d, { duration: 5 }), 15);
  assert.equal(billedSeconds(seedance, draft({}), { duration: 5 }), null, "no reference video: the clip length alone is billed");
});

test("picker: summaries from the model's own spec, the lowest price, and who makes each model", () => {
  assert.equal(fromCredits(hailuo), 15);
  assert.equal(fromCredits(base({ priceRules: null })), null);
  const caps = capabilitySummary(hailuo);
  assert.ok(caps.includes("1080p") && caps.includes("6–10 s") && caps.includes("Start frame"), caps.join(", "));
  const grok = base({ tool: "image", name: "Grok Imagine", family: "Grok Imagine", output: { kind: "image", count: 2 }, options: {} });
  assert.ok(capabilitySummary(grok).includes("2 images"));
  assert.ok(capabilitySummary(base({ tool: "edit", prompt: { min: 0, max: 0 }, references: { min: 1, max: 1 } })).includes("No prompt"));
  const maker = (family: string, name = family) => providerOf({ id: name.toLowerCase(), name, family }).name;
  assert.equal(maker("Imagen 4"), "Google");
  assert.equal(maker("Gemini Omni"), "Google");
  assert.equal(maker("OmniHuman"), "ByteDance");
  assert.equal(maker("Qwen Image"), "Alibaba");
  assert.equal(maker("HappyHorse"), "Alibaba");
  assert.equal(maker("Grok Imagine"), "xAI");
  assert.equal(maker("Hailuo 2.3"), "MiniMax");
  assert.equal(maker("Runway"), "Runway");
  assert.equal(maker("Vidu"), "Shengshu (Vidu)");
});
