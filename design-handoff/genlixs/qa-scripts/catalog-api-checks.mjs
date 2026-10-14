// API checks for the admin catalog endpoints (live mode, local build on :3200, no KIE key configured locally).
// Usage: QA_EMAIL=… QA_PASSWORD=… BASE=http://localhost:3200 node catalog-api-checks.mjs
// The account holds `operations` + `finance` (not owner). Only reads and refused writes are exercised.
const BASE = process.env.BASE ?? "http://localhost:3200";
const qa = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!qa.email || !qa.password) throw new Error("set QA_EMAIL and QA_PASSWORD");
const results = [];
const check = (name, ok, info = "") => results.push({ name, ok: Boolean(ok), info: String(info).slice(0, 200) });
let cookie = "";
async function req(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: { Origin: BASE, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [...new Map([...cookie.split("; ").filter(Boolean), ...set.map((c) => c.split(";")[0])].map((c) => [c.split("=")[0], c])).values()].join("; ");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

let r = await req("/api/admin/catalog");
check("catalog without session 401", r.status === 401);
r = await req("/api/admin/provider/summary");
check("provider summary without session 401", r.status === 401);
r = await req("/api/admin/catalog/bulk-pricing/preview", { method: "POST", body: { scope: "all", markupPercent: 300 } });
check("preview without session 401", r.status === 401);

r = await req("/api/auth/sign-in", { method: "POST", body: { email: qa.email, password: qa.password } });
check("staff sign-in", r.status === 200, r.status);

r = await req("/api/admin/catalog");
const cat = r.json?.data;
check("catalog 200 with 18 models", r.status === 200 && cat?.models?.length === 18, r.status);
check("runtime reports presence only", cat?.runtime && Object.keys(cat.runtime).sort().join(",") === "adaptersInCode,balanceReadable,fakeProvider,kieKeyPresent,submitsEnabled", JSON.stringify(cat?.runtime));
check("adapters in code match the catalog adapters", cat?.models?.every((m) => cat.runtime.adaptersInCode.includes(m.adapter) && m.adapterImplemented));
check("role access: finance+operations, not publish", cat?.access?.canPrice && cat?.access?.canOperate && cat?.access?.canTest && !cat?.access?.canPublish, JSON.stringify(cat?.access));
check("costs visible to pricing roles", cat?.models?.[0]?.cost?.versionId && cat?.economics?.basis?.minRevenuePerCredit === 0.0345, cat?.economics?.basis?.minRevenuePerCredit);
check("no secret-looking values in the payload", !/(sk_|eyJhbGci|Bearer )/.test(r.text));

r = await req("/api/admin/catalog/models/kling-3-0");
check("model detail with 18-configuration table", r.status === 200 && r.json?.data?.table?.configCount === 18, r.json?.data?.table?.configCount);
r = await req("/api/admin/catalog/models/does-not-exist");
check("unknown model 404", r.status === 404 && r.json?.error?.code === "NOT_FOUND", r.status);
r = await req("/api/admin/catalog/models/BAD%20ID");
check("invalid model id 422", r.status === 422, r.status);

r = await req("/api/admin/catalog/bulk-pricing/preview", { method: "POST", body: { scope: "videos", markupPercent: 100 } });
check("preview videos +100 %", r.status === 200 && r.json?.data?.models?.length === 7 && r.json.data.markupBps === 10000, r.status);
const veo = r.json?.data?.models?.find((m) => m.modelId === "veo-3-1");
check("veo 720p +100 % = ceil(0.30 × 2 / 0.0345) = 18", veo?.configs?.find((c) => c.key === "720p")?.proposedUnits === 18, veo?.configs?.[0]?.proposedUnits);
r = await req("/api/admin/catalog/bulk-pricing/preview", { method: "POST", body: { scope: "all", markupPercent: 12.345 } });
check("markup precision refused", r.status === 422 && r.json?.error?.code === "INVALID_MARKUP", r.json?.error?.code);
r = await req("/api/admin/catalog/bulk-pricing/apply", {
  method: "POST",
  body: { scope: "videos", markupPercent: 100, previewRevision: "0".repeat(32), action: "publish", selected: ["veo-3-1"] },
});
check("publish refused for non-owner (403)", r.status === 403 && r.json?.error?.code === "FORBIDDEN", `${r.status} ${r.json?.error?.code}`);
r = await req("/api/admin/catalog/bulk-pricing/apply", {
  method: "POST",
  body: { scope: "videos", markupPercent: 100, previewRevision: "0".repeat(32), action: "draft", selected: ["veo-3-1"] },
});
check("stale/forged revision refused (409)", r.status === 409 && r.json?.error?.code === "PREVIEW_STALE", `${r.status} ${r.json?.error?.code}`);
r = await req("/api/admin/catalog/models/veo-3-1/availability", { method: "POST", body: { state: "enabled" } });
check("enable refused without KIE credentials (409)", r.status === 409 && r.json?.error?.code === "CREDENTIALS_MISSING", `${r.status} ${r.json?.error?.code}`);
r = await req("/api/admin/catalog/models/veo-3-1/tests", {
  method: "POST",
  headers: { "Idempotency-Key": "qa-check-00000001" },
  body: { prompt: "A test", options: {}, confirmSpend: true },
});
check("paid test refused up front without KIE credentials", r.status === 409 && r.json?.error?.code === "CREDENTIALS_MISSING", `${r.status} ${r.json?.error?.code}`);
r = await req("/api/admin/catalog/models/veo-3-1/availability", { method: "POST", body: { state: "sideways" } });
check("invalid availability state 422", r.status === 422, r.status);
r = await req("/api/admin/catalog/packages/impact", { method: "POST", body: { changes: { studio: { amountMinor: 5000, credits: 2000 } } } });
check("package impact (read-only)", r.status === 200 && r.json?.data?.after?.minRevenuePerCredit === 0.025, r.json?.data?.after?.minRevenuePerCredit);
r = await req("/api/admin/provider/summary");
check("provider summary: not configured, no fabricated balance", r.status === 200 && r.json?.data?.configured === false && r.json?.data?.balance?.credits === null, JSON.stringify(r.json?.data?.balance));
r = await req("/api/admin/catalog/batches");
check("batch history readable", r.status === 200 && Array.isArray(r.json?.data), r.status);
r = await req("/api/admin/catalog/tests/outputs/00000000-0000-4000-8000-000000000000");
check("unknown test output 404", r.status === 404, r.status);

const failed = results.filter((x) => !x.ok);
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.ok ? "" : `  :: ${x.info}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
