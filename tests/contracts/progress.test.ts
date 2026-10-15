// Generation progress shown on the preview card: honest stages, labelled estimates, no early 100 % (15 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPercent, estimateProgress, fmtElapsed, stageOf, type ProgressJob } from "../../src/lib/live/progress";

const T0 = Date.parse("2026-10-15T03:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const job = (over: Partial<ProgressJob>): ProgressJob => ({ state: "queued", createdAt: iso(0), outputKind: "video", timing: { generateSeconds: 120, saveSeconds: 20 }, ...over });

test("stages map from the stored state, never from a timer", () => {
  assert.equal(stageOf({ state: "queued" }), "preparing");
  assert.equal(stageOf({ state: "submission_unknown" }), "confirming");
  assert.equal(stageOf({ state: "processing_delayed" }), "generating");
  assert.equal(stageOf({ state: "importing" }), "saving");
  assert.equal(stageOf({ state: "succeeded" }), "ready");
  assert.equal(stageOf({ state: "review_required" }), "review");
  // A running job that has been going for hours is still not "ready".
  const p = estimateProgress(job({ state: "provider_pending", acceptedAt: iso(0) }), T0 + 10 * 3600_000);
  assert.equal(p.stage, "generating");
  assert.ok((p.percent ?? 0) < 90 && displayPercent(p)! <= 99);
});

test("estimate rises with time inside the generating band and is labelled as an estimate", () => {
  const running = job({ state: "provider_pending", acceptedAt: iso(0) });
  const a = estimateProgress(running, T0 + 1_000);
  const b = estimateProgress(running, T0 + 60_000);
  const c = estimateProgress(running, T0 + 120_000);
  assert.equal(a.kind, "estimate");
  assert.ok(a.percent! >= 6 && a.percent! < b.percent! && b.percent! < c.percent! && c.percent! < 90);
  assert.equal(c.delayed, false);
  const late = estimateProgress(running, T0 + 300_000);
  assert.equal(late.delayed, true);
  assert.match(late.caption, /longer than usual/);
});

test("provider progress is used only when reported, and labelled as such", () => {
  const p = estimateProgress(job({ state: "provider_pending", acceptedAt: iso(0), providerProgress: { value: 50, at: iso(30_000) } }), T0 + 30_000);
  assert.equal(p.kind, "provider");
  assert.ok(Math.abs(p.percent! - 48) < 1);
  const bogus = estimateProgress(job({ state: "provider_pending", acceptedAt: iso(0), providerProgress: { value: 150, at: iso(1) } }), T0 + 1_000);
  assert.equal(bogus.kind, "estimate");
});

test("saving stays below 100 until the file exists; ready is 100 only with an output", () => {
  const saving = estimateProgress(job({ state: "importing", generatedAt: iso(0) }), T0 + 600_000);
  assert.equal(saving.stage, "saving");
  assert.ok(saving.percent! >= 90 && saving.percent! <= 98);
  assert.ok(displayPercent(saving)! >= 97 && displayPercent(saving)! <= 98);
  assert.equal(saving.delayed, true, "a long save is surfaced, not parked at 99 %");
  const ready = estimateProgress(job({ state: "succeeded", outputs: [{}] }), T0 + 1);
  assert.equal(ready.percent, 100);
  assert.equal(ready.kind, "final");
});

test("never moves backwards within a run; failures and reviews show no fake percentage", () => {
  const running = job({ state: "provider_pending", acceptedAt: iso(0) });
  const later = estimateProgress(running, T0 + 100_000);
  // A slower provider reading after a fast estimate does not pull the bar back.
  const back = estimateProgress({ ...running, providerProgress: { value: 5, at: iso(101_000) } }, T0 + 101_000, later);
  assert.ok(back.percent! >= later.percent!);
  assert.equal(estimateProgress(job({ state: "failed" }), T0).percent, null);
  assert.equal(estimateProgress(job({ state: "review_required" }), T0).percent, null);
  assert.equal(estimateProgress(job({ state: "cancelled" }), T0).caption, "Cancelled");
});

test("queue copy is honest about a refusing service; elapsed time formats", () => {
  const w = estimateProgress(job({ state: "queued", events: [{ event: "waiting_service", at: iso(1) }] }), T0 + 5_000);
  assert.match(w.caption, /Waiting for the generation service/);
  assert.match(w.detail ?? "", /nothing is charged/);
  assert.equal(estimateProgress(job({ state: "queued", outputKind: "image" }), T0 + 1).caption, "Preparing your image");
  assert.equal(fmtElapsed(65_000), "1:05");
  assert.equal(fmtElapsed(3_725_000), "1:02:05");
});
