// Provider contract fixtures (guide §12, §26.2). Shapes follow the KIE Market API documentation checked 14 Oct 2026.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { classifyCreate, normalizeRecord, parseBalance, resultUrlsOf } from "../../src/lib/providers/kie/client";
import { buildInput, supportedAdapters } from "../../src/lib/providers/kie/adapters";
import { TransientProviderError, type ClaimContext } from "../../src/lib/providers/types";

const body = (v: unknown) => JSON.stringify(v);

test("create: accepted only with a valid task id", () => {
  assert.deepEqual(classifyCreate(200, body({ code: 200, msg: "success", data: { taskId: "task_abc123" } })), { kind: "accepted", taskId: "task_abc123" });
  assert.equal(classifyCreate(200, body({ code: 200, data: {} })).kind, "unknown");
  assert.equal(classifyCreate(200, body({ code: 200, data: { taskId: "bad id with spaces" } })).kind, "unknown");
});

test("create: documented rejections are terminal or retryable; ambiguity is unknown", () => {
  assert.equal(classifyCreate(200, body({ code: 422, msg: "invalid" })).kind, "rejected_terminal");
  assert.equal(classifyCreate(200, body({ code: 400, msg: "bad" })).kind, "rejected_terminal");
  assert.equal(classifyCreate(200, body({ code: 505, msg: "disabled" })).kind, "rejected_terminal");
  for (const code of [401, 402, 429, 433, 455]) assert.equal(classifyCreate(200, body({ code, msg: "x" })).kind, "rejected_retryable", `code ${code}`);
  assert.equal(classifyCreate(429, "<html>busy</html>").kind, "rejected_retryable");
  // 500 / unexplained / unparseable: the task may exist — never resend blindly.
  assert.equal(classifyCreate(200, body({ code: 500, msg: "server error" })).kind, "unknown");
  assert.equal(classifyCreate(502, "<html>bad gateway</html>").kind, "unknown");
  assert.equal(classifyCreate(200, "not json").kind, "unknown");
  assert.equal(classifyCreate(200, body({ msg: "no code" })).kind, "unknown");
});

test("create: terminal rejection exposes only a public message", () => {
  const r = classifyCreate(200, body({ code: 422, msg: "internal supplier detail" }));
  assert.equal(r.kind, "rejected_terminal");
  if (r.kind === "rejected_terminal") {
    assert.equal(r.publicCode, "INVALID_REQUEST");
    assert.ok(!r.publicMessage.includes("supplier detail"));
  }
});

test("status: states normalize; resultJson is parsed from a string; callBackUrl is read from param", () => {
  const cb = "https://genlixs.com/api/webhooks/kie?attempt=7a1d1c1e-1111-4222-8333-444455556666&correlation=tok";
  const ok = normalizeRecord(
    "t1",
    200,
    body({
      code: 200,
      data: {
        taskId: "t1",
        state: "success",
        resultJson: JSON.stringify({ resultUrls: ["https://tempfile.aiquickdraw.com/a.png"] }),
        param: JSON.stringify({ model: "m", callBackUrl: cb, input: JSON.stringify({ prompt: "p" }) }),
        creditsConsumed: 3,
      },
    }),
  );
  assert.equal(ok.normalized, "success");
  assert.deepEqual(ok.resultUrls, ["https://tempfile.aiquickdraw.com/a.png"]);
  assert.equal(ok.callBackUrl, cb);
  assert.equal(ok.creditsConsumed, "3");
  for (const s of ["waiting", "queuing", "generating"]) assert.equal(normalizeRecord("t1", 200, body({ code: 200, data: { taskId: "t1", state: s } })).normalized, "pending");
  assert.equal(normalizeRecord("t1", 200, body({ code: 200, data: { taskId: "t1", state: "fail", failMsg: "x" } })).normalized, "fail");
  assert.equal(normalizeRecord("t1", 200, body({ code: 200, data: { taskId: "t1", state: "mystery" } })).normalized, "unknown");
});

test("status: not found is not a failure; transient errors throw; a different task is never evidence", () => {
  const nf = normalizeRecord("t1", 200, body({ code: 404, msg: "not found" }));
  assert.equal(nf.notFound, true);
  assert.equal(nf.normalized, "unknown");
  assert.throws(() => normalizeRecord("t1", 200, body({ code: 500 })), TransientProviderError);
  assert.throws(() => normalizeRecord("t1", 503, "<html>"), TransientProviderError);
  const other = normalizeRecord("t1", 200, body({ code: 200, data: { taskId: "t2", state: "success", resultJson: "{}" } }));
  assert.equal(other.normalized, "unknown");
});

const ctx = (adapter: string, options: Record<string, string | number>): ClaimContext => ({
  job: { id: "j", ref: "R", userId: "u", state: "submitting", tool: "image", prompt: "A lamp", options, units: "4" },
  model: { id: "m", providerModelId: "pm", adapter, adapterVersion: 1, providerAccountId: "a" },
  output: { kind: "image", mime: ["image/png"], count: 1, maxBytes: 1 },
  references: [],
  attempt: null,
});

test("adapters forward only documented fields with the right types", () => {
  assert.deepEqual(buildInput({ context: ctx("kie-market-image", { aspect_ratio: "3:2", resolution: "1K" }), referenceUrls: [], callBackUrl: null }), {
    prompt: "A lamp",
    aspect_ratio: "3:2",
    resolution: "1K",
  });
  assert.throws(() => buildInput({ context: ctx("kie-market-image-edit", {}), referenceUrls: [], callBackUrl: null }));
  assert.deepEqual(buildInput({ context: ctx("kie-market-image-edit", { aspect_ratio: "auto" }), referenceUrls: ["https://x/r.png"], callBackUrl: null }).input_urls, [
    "https://x/r.png",
  ]);
  const veo = buildInput({ context: ctx("kie-market-veo", { variant: "veo3_fast", duration: "6", aspect_ratio: "16:9", resolution: "720p" }), referenceUrls: [], callBackUrl: null });
  assert.equal(veo.generation_type, "TEXT_2_VIDEO");
  assert.equal(veo.model, "veo3_fast");
  assert.equal(veo.duration, 6);
  assert.throws(() => buildInput({ context: ctx("unknown-adapter", {}), referenceUrls: [], callBackUrl: null }));
});

// ------------------------------------------------------------- curated catalog (docs.kie.ai, 14 Oct 2026)

const ctxFor = (adapter: string, tool: "image" | "edit" | "video", options: Record<string, string | number>): ClaimContext => ({
  ...ctx(adapter, options),
  job: { ...ctx(adapter, options).job, tool },
});
const build = (adapter: string, tool: "image" | "edit" | "video", options: Record<string, string | number>, referenceUrls: string[] = []) =>
  buildInput({ context: ctxFor(adapter, tool, options), referenceUrls, callBackUrl: null });

test("adapters: image models send documented fields; edit models require and forward the reference", () => {
  assert.deepEqual(build("kie-nano-banana", "image", { aspect_ratio: "4:5", resolution: "2K" }), {
    prompt: "A lamp", aspect_ratio: "4:5", resolution: "2K", output_format: "png",
  });
  assert.deepEqual(build("kie-nano-banana", "edit", { aspect_ratio: "auto", resolution: "1K" }, ["https://x/r.png"]).image_input, ["https://x/r.png"]);
  assert.throws(() => build("kie-nano-banana", "edit", { aspect_ratio: "auto", resolution: "1K" }));
  assert.deepEqual(build("kie-flux-2", "image", { aspect_ratio: "16:9", resolution: "2K" }), {
    prompt: "A lamp", aspect_ratio: "16:9", resolution: "2K", nsfw_checker: true,
  });
  assert.deepEqual(build("kie-flux-2", "edit", { aspect_ratio: "auto", resolution: "1K" }, ["https://x/r.png"]).input_urls, ["https://x/r.png"]);
  assert.throws(() => build("kie-flux-2", "image", { aspect_ratio: "1:1", resolution: "4K" }), /unsupported resolution/);
  assert.deepEqual(build("kie-seedream-5", "image", { aspect_ratio: "21:9", resolution: "1.5K" }), {
    prompt: "A lamp", aspect_ratio: "21:9", size: "1.5K", output_format: "png", nsfw_checker: true,
  });
  assert.deepEqual(build("kie-seedream-5", "edit", { aspect_ratio: "1:1", resolution: "2K" }, ["https://x/r.png"]).image_urls, ["https://x/r.png"]);
  // Text-to-image never forwards a reference even if one were attached.
  assert.equal(build("kie-seedream-5", "image", { aspect_ratio: "1:1", resolution: "1K" }, ["https://x/r.png"]).image_urls, undefined);
});

test("adapters: video models map tiers, modes, audio and durations to the documented types", () => {
  const lite = build("kie-market-veo", "video", { variant: "veo3_lite", aspect_ratio: "9:16", resolution: "4k", duration: 8 });
  assert.deepEqual(lite, { prompt: "A lamp", generation_type: "TEXT_2_VIDEO", model: "veo3_lite", aspect_ratio: "9:16", resolution: "4k", duration: 8 });
  assert.deepEqual(build("kie-kling-3", "video", { resolution: "1080p", audio: "off", duration: 10, aspect_ratio: "1:1" }), {
    prompt: "A lamp", mode: "pro", sound: false, duration: "10", aspect_ratio: "1:1", multi_shots: false,
  });
  assert.equal(build("kie-kling-3", "video", { resolution: "720p", audio: "on", duration: 5, aspect_ratio: "16:9" }).mode, "std");
  assert.equal(build("kie-kling-3", "video", { resolution: "4K", audio: "on", duration: 15, aspect_ratio: "16:9" }).mode, "4K");
  assert.throws(() => build("kie-kling-3", "video", { resolution: "720p", audio: "maybe", duration: 5, aspect_ratio: "16:9" }));
  assert.throws(() => build("kie-kling-3", "video", { resolution: "720p", audio: "on", duration: 7, aspect_ratio: "16:9" }), /unsupported duration/);
  assert.deepEqual(build("kie-seedance-2", "video", { resolution: "480p", audio: "on", duration: 5, aspect_ratio: "21:9" }), {
    prompt: "A lamp", resolution: "480p", generate_audio: true, duration: 5, aspect_ratio: "21:9", nsfw_checker: true,
  });
  assert.deepEqual(build("kie-wan-2-6", "video", { resolution: "1080p", duration: 15 }), {
    prompt: "A lamp", duration: "15", resolution: "1080p", multi_shots: false, nsfw_checker: true,
  });
});

test("adapters in code equal the implemented-adapter registry shipped in the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261014065744_catalog_admin_schema.sql", import.meta.url), "utf8");
  const block = sql.slice(sql.indexOf("insert into app_private.provider_adapters"), sql.indexOf("alter table app_private.provider_adapters"));
  const registry = [...block.matchAll(/\('([a-z0-9-]+)', 'kie'/g)].map((m) => m[1]).sort();
  assert.deepEqual(registry, [...supportedAdapters()].sort());
});

test("status: deliverables come from resultUrls, or Veo's upgraded data.result_urls — never originals or extras", () => {
  const rec = (resultJson: unknown) =>
    normalizeRecord("t1", 200, body({ code: 200, data: { taskId: "t1", state: "success", resultJson: JSON.stringify(resultJson) } })).resultUrls;
  assert.deepEqual(rec({ resultUrls: ["https://tempfile.aiquickdraw.com/a.mp4"], lastFrameUrl: ["https://tempfile.aiquickdraw.com/last.jpg"] }), [
    "https://tempfile.aiquickdraw.com/a.mp4",
  ]);
  assert.deepEqual(rec({ data: { result_urls: ["https://tempfile.aiquickdraw.com/1080.mp4"], origin_urls: ["https://tempfile.aiquickdraw.com/720.mp4"] } }), [
    "https://tempfile.aiquickdraw.com/1080.mp4",
  ]);
  assert.deepEqual(rec({ originUrls: ["https://tempfile.aiquickdraw.com/720.mp4"] }), []);
  assert.deepEqual(resultUrlsOf(null), []);
  // 422 "task does not exist or does not belong to your account" is evidence only, not a failure.
  const nf = normalizeRecord("t1", 200, body({ code: 422, msg: "taskId not found" }));
  assert.equal(nf.notFound, true);
  assert.equal(nf.normalized, "unknown");
});

test("balance: only a numeric code-200 reply is a balance; anything else is an error, never zero", () => {
  assert.deepEqual(parseBalance(200, body({ code: 200, msg: "success", data: 1234.5 })), { ok: true, credits: 1234.5 });
  assert.deepEqual(parseBalance(200, body({ code: 200, msg: "success", data: "100" })), { ok: true, credits: 100 });
  assert.deepEqual(parseBalance(200, body({ code: 401, msg: "unauthorized" })), { ok: false, error: "KIE_401" });
  assert.deepEqual(parseBalance(200, body({ code: 200, data: null })), { ok: false, error: "MALFORMED" });
  assert.deepEqual(parseBalance(200, body({ code: 200, data: "n/a" })), { ok: false, error: "MALFORMED" });
  assert.deepEqual(parseBalance(502, "<html>"), { ok: false, error: "HTTP_502" });
});
