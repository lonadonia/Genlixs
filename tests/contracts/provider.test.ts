// Provider contract fixtures (guide §12, §26.2). Shapes follow the KIE Market API documentation checked 14 Oct 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCreate, normalizeRecord } from "../../src/lib/providers/kie/client";
import { buildInput } from "../../src/lib/providers/kie/adapters";
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
