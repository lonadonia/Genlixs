// Multi-provider adapters (18 Oct 2026): request shapes per documented API, classification of create replies (including
// business errors inside HTTP 200), status normalization, truthful balances, exact decimals and sanitized exports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildApimart, classifyApimartCreate, normalizeApimartTask, parseApimartBalance } from "../../src/lib/providers/apimart";
import { buildCuddler, classifyCuddlerCreate, cuddlerMaxUsd, normalizeCuddlerJob, parseCuddlerBalance } from "../../src/lib/providers/cuddler";
import { buildDuomi, classifyDuomiCreate, normalizeDuomiTask, parseDuomiBalance } from "../../src/lib/providers/duomi";
import { buildNezhagate, classifyNezhagateCreate, normalizeNezhagateJob, parseNezhagateUsage } from "../../src/lib/providers/nezhagate";
import { buildPoyo, classifyPoyoSubmit, normalizePoyoStatus, parsePoyoBalance } from "../../src/lib/providers/poyo";
import { scaleUp, toUnits, fromUnits } from "../../src/lib/providers/decimal";
import { csvCell, usageCsv, type UsageRow } from "../../src/lib/providers/usage-csv";
import { adaptersByProvider, resultHostsByProvider } from "../../src/lib/providers/registry";
import { maskKey } from "../../src/lib/providers/credentials";
import type { AttemptRoute, ClaimContext, RoutedSubmit } from "../../src/lib/providers/types";

const ctx = (tool: ClaimContext["job"]["tool"], options: Record<string, string | number>, mode: string | null = null): ClaimContext => ({
  job: { id: "00000000-0000-4000-8000-000000000001", ref: "J1", userId: "u", state: "submitting", tool, prompt: "A lamp", options, units: "4", mode },
  model: { id: "m", providerModelId: "x", adapter: "x", adapterVersion: 1, providerAccountId: "a" },
  output: { kind: tool === "video" ? "video" : "image", mime: ["image/png"], count: 1, maxBytes: 1 },
  references: [],
  inputs: {},
  attempt: { id: "att-1", ordinal: 1, state: "submitting", taskId: null },
});
const route = (provider: AttemptRoute["provider"], adapter: string, upstream: string, extra: Partial<AttemptRoute> = {}): AttemptRoute => ({
  provider, accountId: "acc", offerId: "off", adapter, upstreamModelId: upstream, credentialVersion: 1, credentialSource: "vault", secretRef: null, ...extra,
});
const req = (r: AttemptRoute, c: ClaimContext, refs: string[] = [], inputs: Record<string, string[]> = {}): RoutedSubmit => ({
  context: c, referenceUrls: refs, inputUrls: inputs, sourceTasks: {}, callBackUrl: null, route: r, key: "k_live_secret_value", idempotencyKey: "genlixs-att-1",
});
const U = "https://store.example/x";

test("adapters in code equal the provider_adapters rows of the multi-provider migration, per provider", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const rows: [string, string][] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    // Only the rows of `insert into app_private.provider_adapters … ;` statements.
    for (const ins of sql.matchAll(/insert into app_private\.provider_adapters[^;]*;/g)) {
      for (const m of ins[0].matchAll(/\('([a-z0-9-]+)', '(duomi|poyo|nezhagate|cuddler|apimart)', '/g)) rows.push([m[1], m[2]]);
    }
  }
  const fromSql: Record<string, string[]> = {};
  for (const [adapter, provider] of rows) (fromSql[provider] ??= []).push(adapter);
  const code = adaptersByProvider();
  for (const p of ["duomi", "poyo", "nezhagate", "cuddler", "apimart"]) assert.deepEqual([...(fromSql[p] ?? [])].sort(), code[p], p);
});

test("documented result hosts in the database equal each supplier client's resultHosts (none for Cuddler)", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((f) => f.endsWith(".sql") && readFileSync(new URL(f, dir), "utf8").includes("add column result_hosts"));
  assert.ok(file, "migration seeding provider_adapters.result_hosts");
  const sql = readFileSync(new URL(file, dir), "utf8");
  const fromSql: Record<string, string[]> = {};
  for (const m of sql.matchAll(/when '([a-z]+)' then array\[([^\]]*)\]/g)) fromSql[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((h) => h[1]).sort();
  const code = resultHostsByProvider();
  for (const p of Object.keys(code)) assert.deepEqual(fromSql[p] ?? [], code[p], p);
  assert.deepEqual(code.cuddler, [], "Cuddler's download host is not documented");
});

test("Cuddler: modes from inputs, generate_audio from the setting, fixed variant, max_usd ceiling, idempotent create", () => {
  const r = route("cuddler", "cuddler-video", "kling-3.0", { request: { variant: "standard" }, estimate: { native: "0.294", nominalUsd: "0.294", effectiveUsd: "0.31017" } });
  const text = buildCuddler(req(r, ctx("video", { resolution: "720p", audio: "off", duration: 5, aspect_ratio: "16:9" }, "create")));
  assert.equal(text.path, "/v1/videos");
  assert.deepEqual(text.body, {
    model: "kling-3.0", variant: "standard", max_usd: "0.3381", prompt: "A lamp", metadata: { genlixs_attempt: "att-1" },
    mode: "text", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false,
  });
  const frames = buildCuddler(req(r, ctx("video", { resolution: "720p", audio: "on", duration: 5, aspect_ratio: "16:9" }, "frames"), [], { first_frame: [U + 1], last_frame: [U + 2] }));
  assert.equal(frames.body.mode, "first-last-frame");
  assert.equal(frames.body.first_frame, U + 1);
  assert.throws(() => buildCuddler(req(r, ctx("video", { audio: "on" }), [], { first_frame: [U], reference_images: [U] })), /cannot be combined/);
  assert.equal(cuddlerMaxUsd(route("cuddler", "cuddler-video", "m", { estimate: { native: null, nominalUsd: "0.0000001", effectiveUsd: null } })), "0.000002", "a ceiling rounds up at every boundary");
  assert.deepEqual(classifyCuddlerCreate({ status: 202, json: { id: "vid_123", status: "queued" } }), { kind: "accepted", taskId: "vid_123" });
  assert.equal(classifyCuddlerCreate({ status: 402, json: { code: "insufficient_balance", message: "x", request_id: "r" } }).kind, "rejected_account");
  assert.equal(classifyCuddlerCreate({ status: 429, json: { code: "queue_full", message: "x", request_id: "r" } }).kind, "rejected_retryable");
  const blocked = classifyCuddlerCreate({ status: 422, json: { code: "content_blocked", message: "x", request_id: "r" } });
  assert.equal(blocked.kind === "rejected_terminal" && blocked.publicCode, "CONTENT_BLOCKED");
  assert.equal(classifyCuddlerCreate({ status: 500, json: { code: "internal_error", message: "x", request_id: "r" } }).kind, "unknown");
  assert.equal(classifyCuddlerCreate({ status: 409, json: { code: "idempotency_conflict", message: "x", request_id: "r" } }).kind, "unknown");
});

test("Cuddler: job status, output and usage; balance with held funds; failures are errors, not zero", () => {
  const ok = normalizeCuddlerJob("vid_1", { status: 200, json: { id: "vid_1", status: "succeeded", output: { url: "https://cdn.example/v.mp4" }, usage: { usd: "0.3012", tokens: 1 } } });
  assert.deepEqual([ok.normalized, ok.resultUrls, ok.creditsConsumed], ["success", ["https://cdn.example/v.mp4"], "0.3012"]);
  assert.equal(normalizeCuddlerJob("vid_1", { status: 200, json: { id: "vid_1", status: "running", usage: { usd: "0.1" } } }).creditsConsumed, null, "only a final job is a charge");
  assert.equal(normalizeCuddlerJob("vid_1", { status: 200, json: { id: "vid_2", status: "succeeded" } }).normalized, "unknown", "another job is never evidence");
  assert.equal(normalizeCuddlerJob("vid_1", { status: 404, json: null }).notFound, true);
  assert.throws(() => normalizeCuddlerJob("vid_1", { status: 503, json: null }));
  assert.deepEqual(parseCuddlerBalance({ status: 200, json: { total_usd: "12.50", available_usd: "10.00", held_usd: "2.50", daily_limit_usd: "0.000000" } }), {
    ok: true, total: "12.50", available: "10.00", held: "2.50", unit: "usd", scope: "wallet", note: null,
  });
  assert.deepEqual(parseCuddlerBalance({ status: 401, json: {} }), { ok: false, error: "HTTP_401", state: "unauthorized" });
  assert.equal(parseCuddlerBalance({ status: 200, json: { total_usd: null } }).ok, false);
});

test("APIMart: frames as roles, references as image_urls, audio flag; task results as lists; credits as the charge", () => {
  const r = route("apimart", "apimart-video", "seedance-2.0-fast");
  const b = buildApimart(req(r, ctx("video", { resolution: "720p", audio: "off", duration: 10, aspect_ratio: "16:9" }, "frames"), [], { first_frame: [U + 1] }));
  assert.deepEqual(b, {
    path: "/v1/videos/generations",
    body: { model: "seedance-2.0-fast", prompt: "A lamp", duration: 10, resolution: "720p", size: "16:9", generate_audio: false, image_with_roles: [{ url: U + 1, role: "first_frame" }] },
  });
  const img = buildApimart(req(route("apimart", "apimart-image", "seedream-5-0-flash"), ctx("edit", { resolution: "1.5K", aspect_ratio: "1:1" }), [U]));
  assert.deepEqual(img.body, { model: "seedream-5-0-flash", prompt: "A lamp", size: "1:1", resolution: "1.5K", n: 1, image_urls: [U] });
  assert.throws(() => buildApimart(req(route("apimart", "apimart-image", "s"), ctx("edit", { resolution: "1K", aspect_ratio: "1:1" }), [])), /reference image missing/);
  assert.deepEqual(classifyApimartCreate({ status: 200, json: { code: 200, data: [{ status: "submitted", task_id: "task_01KMC" }] } }), { kind: "accepted", taskId: "task_01KMC" });
  assert.equal(classifyApimartCreate({ status: 402, json: { error: { code: 402, message: "Insufficient", type: "payment_required" } } }).kind, "rejected_account");
  assert.equal(classifyApimartCreate({ status: 400, json: { error: { code: 400, message: "bad", type: "invalid_request_error" } } }).kind, "rejected_terminal");
  assert.equal(classifyApimartCreate({ status: 502, json: null }).kind, "unknown");
  const t = normalizeApimartTask("task_1", { status: 200, json: { code: 200, data: { id: "task_1", status: "completed", credits_cost: 1.5, result: { images: [{ url: ["https://upload.apimart.ai/f/a.png"] }] } } } });
  assert.deepEqual([t.normalized, t.resultUrls, t.creditsConsumed], ["success", ["https://upload.apimart.ai/f/a.png"], "1.5"]);
  assert.equal(normalizeApimartTask("task_1", { status: 200, json: { code: 200, data: { id: "task_1", status: "failed", error: { code: 500, message: "x" } } } }).normalized, "fail");
});

test("APIMart balance: credits from the account; an unlimited key allowance is noted, never treated as a wallet", () => {
  const user = { status: 200, json: { success: true, remain_balance: 100, remain_credits: 1000 } };
  const b = parseApimartBalance(user, { status: 200, json: { success: true, remain_credits: -1, unlimited_quota: true } });
  assert.equal(b.ok && b.total, "1000");
  assert.equal(b.ok && b.unit, "apimart_credit");
  assert.match(b.ok ? b.note ?? "" : "", /unlimited allowance; spending is limited by the account balance/);
  assert.deepEqual(parseApimartBalance({ status: 200, json: { success: false, message: "Failed to get user quota" } }, null), { ok: false, error: "APIMART_BALANCE_FAILED", state: "failed" });
});

test("NezhaGate: references never frames, sound always on, upper-case P; 502/503 are not billed", () => {
  const r = route("nezhagate", "nezhagate-video", "seedance-2.0-fast");
  const v = buildNezhagate(req(r, ctx("video", { resolution: "720p", audio: "on", duration: 10, aspect_ratio: "9:16" }, "reference"), [], { reference_images: [U], reference_audio: [U + "a"] }));
  assert.deepEqual(v.body, { model: "seedance-2.0-fast", prompt: "A lamp", duration: 10, resolution: "720P", size: "9:16", images: [U], audio_reference: [U + "a"] });
  assert.throws(() => buildNezhagate(req(r, ctx("video", { audio: "off", duration: 5 }))), /cannot be switched off/);
  assert.throws(() => buildNezhagate(req(r, ctx("video", { audio: "on", duration: 5 }), [], { first_frame: [U] })), /frames are not supported/);
  const edit = buildNezhagate(req(route("nezhagate", "nezhagate-image", "nano-banana-pro"), ctx("edit", { resolution: "2K", aspect_ratio: "4:5" }), [U, U]));
  assert.deepEqual(edit.body, { model: "nano-banana-pro", prompt: "A lamp", size: "4:5", resolution: "2K", images: [U, U] });
  assert.throws(() => buildNezhagate(req(route("nezhagate", "nezhagate-image", "x"), ctx("edit", { resolution: "1K", aspect_ratio: "1:1" }), Array(9).fill(U))), /at most 8/);
  assert.deepEqual(classifyNezhagateCreate({ status: 202, json: { id: "img_3f9a", object: "image.generation.job", status: "queued" } }), { kind: "accepted", taskId: "img_3f9a" });
  assert.equal(classifyNezhagateCreate({ status: 502, json: { error: { code: "upstream_timeout", message: "x" } } }).kind, "rejected_retryable");
  assert.equal(classifyNezhagateCreate({ status: 402, json: { error: { code: "insufficient_quota", message: "x" } } }).kind, "rejected_account");
  assert.equal(classifyNezhagateCreate({ status: 400, json: { error: { code: "model_coming_soon", message: "x" } } }).kind, "rejected_terminal");
  const j = normalizeNezhagateJob("img_1", { status: 200, json: { id: "img_1", status: "succeeded", data: [{ url: "https://img.nezhagate.com/i/a.png" }], usage: { images: 1 } } });
  assert.deepEqual([j.normalized, j.resultUrls, j.creditsConsumed], ["success", ["https://img.nezhagate.com/i/a.png"], null]);
  assert.equal(normalizeNezhagateJob("img_1", { status: 404, json: { error: { code: "job_not_found" } } }).notFound, true);
  assert.deepEqual(parseNezhagateUsage({ status: 200, json: { balance: { usd: 12.5, credits: 2500 } } }), {
    ok: true, total: "12.5", available: null, held: null, unit: "usd", scope: "wallet", note: "Every key of the account shares this balance.",
  });
});

test("PoYo: motion envelope {model, input}; status files; credits as the charge; balance in credits", () => {
  const r = route("poyo", "poyo-kling-motion", "kling-3.0-motion-control");
  const b = buildPoyo(req(r, ctx("video", { mode: "1080p", orientation: "image", seconds: 8 }, "motion"), [], { character_image: [U + "i"], motion_video: [U + "v"] }));
  assert.deepEqual(b, {
    path: "/api/generate/submit",
    body: { model: "kling-3.0-motion-control", input: { prompt: "A lamp", image_urls: [U + "i"], video_urls: [U + "v"], character_orientation: "image", resolution: "1080p" } },
  });
  assert.throws(() => buildPoyo(req(r, ctx("video", { mode: "1080p", orientation: "image" }), [], { character_image: [U] })), /required/);
  assert.deepEqual(classifyPoyoSubmit({ status: 200, json: { code: 200, data: { task_id: "task-unified-1757165031-uyujaw3d" } } }), {
    kind: "accepted", taskId: "task-unified-1757165031-uyujaw3d",
  });
  assert.equal(classifyPoyoSubmit({ status: 401, json: { code: 401, error: { message: "Invalid API key" } } }).kind, "rejected_account");
  const s = normalizePoyoStatus("t1", { status: 200, json: { code: 200, data: { task_id: "t1", status: "finished", credits_amount: 72, files: [{ file_url: "https://storage.poyo.ai/v.mp4", file_type: "video" }] } } });
  assert.deepEqual([s.normalized, s.resultUrls, s.creditsConsumed], ["success", ["https://storage.poyo.ai/v.mp4"], "72"]);
  assert.equal(normalizePoyoStatus("t1", { status: 200, json: { code: 200, data: { task_id: "t1", status: "running", credits_amount: 72 } } }).creditsConsumed, null);
  assert.deepEqual(parsePoyoBalance({ status: 200, json: { code: 200, data: { email: "x", credits_amount: 17276 } } }), {
    ok: true, total: "17276", available: null, held: null, unit: "poyo_credit", scope: "wallet", note: null,
  });
});

test("Duomi: raw Authorization key, edit endpoint for references, business errors inside HTTP 200, points balance", () => {
  const gen = buildDuomi(req(route("duomi", "duomi-nano-banana", "gemini-3-pro-image-preview"), ctx("image", { resolution: "2K", aspect_ratio: "16:9" })));
  assert.deepEqual(gen, { path: "/api/gemini/nano-banana", body: { model: "gemini-3-pro-image-preview", prompt: "A lamp", aspect_ratio: "16:9", image_size: "2K" } });
  const edit = buildDuomi(req(route("duomi", "duomi-nano-banana", "gemini-3-pro-image-preview"), ctx("edit", { resolution: "1K", aspect_ratio: "auto" }), [U]));
  assert.equal(edit.path, "/api/gemini/nano-banana-edit");
  assert.deepEqual(classifyDuomiCreate({ status: 200, json: { code: 200, msg: "success", data: { task_id: "e64e7980-27af-e5c2-c775-7860a215f33a" } } }), {
    kind: "accepted", taskId: "e64e7980-27af-e5c2-c775-7860a215f33a",
  });
  assert.equal(classifyDuomiCreate({ status: 200, json: { code: 400, msg: "请求失败，API账户余额不足或没有权限", data: null } }).kind, "rejected_account");
  assert.equal(classifyDuomiCreate({ status: 200, json: { code: 400, msg: "参数错误", data: null } }).kind, "rejected_terminal");
  const t = normalizeDuomiTask("t1", { status: 200, json: { code: 200, data: { task_id: "t1", state: "succeeded", data: { images: [{ url: "https://cdn3.dmiapi.com/a.jpeg" }] } } } });
  assert.deepEqual([t.normalized, t.resultUrls], ["success", ["https://cdn3.dmiapi.com/a.jpeg"]]);
  assert.deepEqual(parseDuomiBalance({ status: 200, json: { code: 200, msg: "请求成功", data: { total: "1880", used: "953888", day_used: "720" } } }), {
    ok: true, total: "1880", available: null, held: null, unit: "duomi_point", scope: "wallet", note: "Points (1,000 points = CNY 1).",
  });
});

test("decimals: exact units and a ceiling that never undercuts", () => {
  assert.equal(toUnits("0.0332325", 7), BigInt(332325));
  assert.equal(fromUnits(BigInt(-1500), 3), "-1.5");
  assert.equal(scaleUp("0.75", BigInt(115), BigInt(100)), "0.8625");
  assert.equal(scaleUp("0.0000014", BigInt(1), BigInt(1)), "0.000002");
  assert.equal(scaleUp("abc", BigInt(1), BigInt(1)), null);
});

test("usage CSV: no URLs, no formulas, no e-mail column; unknown stays empty", () => {
  const row: UsageRow = {
    at: "2026-10-18T10:00:00Z", jobRef: "J1", purpose: "customer", userId: "u-1", provider: "nezhagate", modelId: "gpt-flare-image", upstreamModelId: "=cmd()",
    attempt: 1, attemptState: "accepted", state: "pending_confirmation", unit: "usd", estimatedNative: 0.005, estimatedUsd: 0.005, confirmedNative: null,
    confirmedUsd: null, options: { resolution: "1K", note: "https://evil.example/x" } as Record<string, unknown>,
  };
  const csv = usageCsv([row]);
  assert.ok(!/https?:\/\//.test(csv));
  assert.match(csv, /,'=cmd\(\),/);
  assert.ok(!/email/i.test(csv.split("\r\n")[0]));
  assert.match(csv, /pending_confirmation,usd,0\.005,0\.005,,,/);
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("-0.5"), "-0.5", "a negative number stays a number");
  assert.equal(maskKey("k_live_secret_value"), "••••alue");
});
