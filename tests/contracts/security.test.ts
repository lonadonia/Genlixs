// Callback verification, signed cookies, redirects and safe-fetch address checks (guide §15, §16.4, §18.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extractTaskId, parseCallbackUrl, verifyCallback } from "../../src/lib/providers/kie/webhook";
import { signValue, verifySignedValue, bearerMatches } from "../../src/lib/server/crypto";
import { safeNext } from "../../src/lib/auth/redirect";
import { checkUrl, isPrivateAddress } from "../../src/lib/media/safe-fetch";

const KEY = "test-hmac-key";
const sign = (task: string, ts: string) => createHmac("sha256", KEY).update(`${task}.${ts}`).digest("base64");

test("callback: valid signature within the replay window is accepted", () => {
  const now = 1_760_000_000;
  const ts = String(now - 10);
  assert.deepEqual(verifyCallback(KEY, "task_1", ts, sign("task_1", ts), now), { ok: true, taskId: "task_1", timestamp: ts });
});

test("callback: stale, missing, forged or cross-task signatures are rejected", () => {
  const now = 1_760_000_000;
  const old = String(now - 301);
  assert.equal(verifyCallback(KEY, "task_1", old, sign("task_1", old), now).ok, false);
  assert.equal(verifyCallback(KEY, "task_1", null, "x", now).ok, false);
  const ts = String(now);
  assert.equal(verifyCallback(KEY, "task_1", ts, sign("task_2", ts), now).ok, false);
  assert.equal(verifyCallback("other-key", "task_1", ts, sign("task_1", ts), now).ok, false);
  assert.equal(verifyCallback(KEY, null, ts, sign("task_1", ts), now).ok, false);
});

test("callback: task id extraction and callBackUrl evidence parsing", () => {
  assert.equal(extractTaskId({ data: { taskId: "abc_123" } }), "abc_123");
  assert.equal(extractTaskId({ data: { task_id: "abc_123" } }), "abc_123");
  assert.equal(extractTaskId({ data: { taskId: "../../etc" } }), null);
  const id = "7a1d1c1e-1111-4222-8333-444455556666";
  assert.deepEqual(parseCallbackUrl(`https://genlixs.com/api/webhooks/kie?attempt=${id}&correlation=tok-1`), { attempt: id, correlation: "tok-1" });
  assert.deepEqual(parseCallbackUrl("https://genlixs.com/api/webhooks/kie?attempt=nope"), { attempt: null, correlation: null });
  assert.deepEqual(parseCallbackUrl(null), { attempt: null, correlation: null });
});

test("signed referral cookie detects tampering; bearer check is exact", () => {
  const s = signValue("k", "click-1");
  assert.equal(verifySignedValue("k", s), "click-1");
  assert.equal(verifySignedValue("k", s.replace("click-1", "click-2")), null);
  assert.equal(verifySignedValue("other", s), null);
  assert.equal(verifySignedValue("k", undefined), null);
  assert.equal(bearerMatches("Bearer abc", "abc"), true);
  assert.equal(bearerMatches("Bearer abcd", "abc"), false);
  assert.equal(bearerMatches("abc", "abc"), false);
  assert.equal(bearerMatches("Bearer abc", undefined), false);
});

test("post-auth redirects stay on this site", () => {
  assert.equal(safeNext("/studio/image"), "/studio/image");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "studio", 42, null]) assert.equal(safeNext(bad), null);
});

test("safe fetch: only allowlisted HTTPS hosts on public addresses", () => {
  const hosts = ["tempfile.aiquickdraw.com"];
  assert.equal(checkUrl("https://tempfile.aiquickdraw.com/a.png", hosts).hostname, "tempfile.aiquickdraw.com");
  for (const bad of [
    "http://tempfile.aiquickdraw.com/a.png",
    "https://evil.example/a.png",
    "https://user:pw@tempfile.aiquickdraw.com/a.png",
    "https://tempfile.aiquickdraw.com:8443/a.png",
    "https://127.0.0.1/a.png",
    "file:///etc/passwd",
  ]) {
    assert.throws(() => checkUrl(bad, hosts), Error, bad);
  }
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "104.18.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});
