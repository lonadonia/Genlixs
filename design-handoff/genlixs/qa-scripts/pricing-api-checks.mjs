// API checks for the simplified admin endpoints (live mode, local build on :3200, no KIE key configured locally).
// Usage: QA_EMAIL=… QA_PASSWORD=… BASE=http://localhost:3200 node pricing-api-checks.mjs
// The account holds `operations` + `finance` (not owner). Only reads, read-only previews and refused writes run.
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
const code = (r) => `${r.status} ${r.json?.error?.code ?? ""}`;

for (const [path, body] of [
  ["/api/admin/catalog", undefined],
  ["/api/admin/settings", undefined],
  ["/api/admin/pricing/references", { kind: "credit_value", amountUsd: "5", credits: "250" }],
  ["/api/admin/packages/starter", { name: "Starter" }],
]) {
  const r = await req(path, body ? { method: "POST", body } : {});
  check(`${path} without session 401`, r.status === 401, r.status);
}

let r = await req("/api/auth/sign-in", { method: "POST", body: { email: qa.email, password: qa.password } });
check("staff sign-in", r.status === 200, r.status);

r = await req("/api/admin/catalog");
const cat = r.json?.data;
check("catalog 200 with 18 models", r.status === 200 && cat?.models?.length === 18, r.status);
check("references for pricing roles", cat?.references?.kie?.usdPerCredit > 0 && cat?.references?.credit?.usdPerCredit > 0, JSON.stringify(cat?.references)?.slice(0, 160));
check("basis is the Genlixs credit value, not a package", cat?.economics?.basis?.source === "reference" && cat.economics.basis.usdPerCredit === cat.references.credit.usdPerCredit, cat?.economics?.basis?.source);
check("products carry included and bonus credits", cat?.products?.every((p) => Number(p.includedCredits) + Number(p.bonusCredits) === Number(p.credits)));
check("no secret-looking values in the payload", !/(sk_|eyJhbGci|Bearer )/.test(r.text));
check("readiness: private test is optional", cat?.models?.every((m) => m.readiness.checks.find((c) => c.key === "verification")?.warning === true));

r = await req("/api/admin/settings");
check("settings for the Overview section", r.status === 200 && r.json?.data?.settings?.some((s) => s.key === "generation_paused") && Array.isArray(r.json?.data?.agreements), r.status);

r = await req("/api/admin/pricing/references/impact", { method: "POST", body: { kind: "credit_value", amountUsd: "5", credits: "100" } });
check("reference impact is read-only and computed", r.status === 200 && r.json?.data?.usdPerCredit === 0.05 && /Nothing was saved/.test(r.json?.data?.note), code(r));
r = await req("/api/admin/pricing/references/impact", { method: "POST", body: { kind: "credit_value", amountUsd: "5", credits: "2.5" } });
check("Genlixs credits must be whole", r.status === 422, code(r));
r = await req("/api/admin/pricing/references/impact", { method: "POST", body: { kind: "credit_value", amountUsd: 0.1 + 0.2, credits: "100" } });
check("amounts with more than 2 decimals refused", r.status === 422, code(r));
r = await req("/api/admin/pricing/references", { method: "POST", body: { kind: "credit_value", amountUsd: "5", credits: "250", expectedVersionId: "00000000-0000-4000-8000-000000000000" } });
check("reference save from a stale editor refused (nothing written)", r.status === 409 && r.json?.error?.code === "REFERENCE_CHANGED", code(r));

r = await req("/api/admin/catalog/bulk-pricing/preview", { method: "POST", body: { scope: "images", markupPercent: 100 } });
const flare = r.json?.data?.models?.find((m) => m.modelId === "gpt-flare-image");
const k1 = flare?.configs?.find((c) => c.key === "1K");
const rate = cat?.references?.credit?.usdPerCredit;
check("preview: 6 KIE credits at +100 % = ceil(0.06 / credit value)", k1 && k1.supplierCredits === 6 && k1.proposedUnits === Math.max(1, Math.ceil(Number((0.06 / rate).toFixed(9)))), `${k1?.proposedUnits} at ${rate}`);
r = await req("/api/admin/catalog/bulk-pricing/save", {
  method: "POST",
  body: { scope: "images", markupPercent: 100, previewRevision: "0".repeat(32), selected: ["gpt-flare-image"], publish: true },
});
check("bulk save as published refused for non-owner", r.status === 403 && r.json?.error?.code === "FORBIDDEN", code(r));
r = await req("/api/admin/catalog/bulk-pricing/save", {
  method: "POST",
  body: { scope: "images", markupPercent: 100, previewRevision: "0".repeat(32), selected: ["gpt-flare-image"], publish: false },
});
check("bulk save with a stale/forged preview refused", r.status === 409 && r.json?.error?.code === "PREVIEW_STALE", code(r));
r = await req("/api/admin/catalog/bulk-pricing/save", {
  method: "POST",
  body: { scope: "images", markupPercent: 100, previewRevision: "0".repeat(32), selected: ["gpt-flare-image"], kept: { "gpt-flare-image": "1K" } },
});
check("malformed kept settings refused", r.status === 422, code(r));
r = await req("/api/admin/catalog/models/gpt-flare-image/price", { method: "POST", body: { units: { "1K": 3, "2K": 5, "4K": 8 }, publish: true } });
check("price publish refused for non-owner", r.status === 403 && r.json?.error?.code === "FORBIDDEN", code(r));
r = await req("/api/admin/catalog/models/gpt-flare-image/price", {
  method: "POST",
  body: { units: { "1K": 3, "2K": 5, "4K": 8 }, publish: false, expectedPriceVersionId: "00000000-0000-4000-8000-000000000000" },
});
check("draft from a stale editor refused (nothing written)", r.status === 409 && r.json?.error?.code === "PRICE_CHANGED", code(r));
r = await req("/api/admin/packages/starter", {
  method: "POST",
  body: { name: "Starter", amountMinor: 900, includedCredits: 200, bonusCredits: 0, offered: true, expectedVersionId: "00000000-0000-4000-8000-000000000000" },
});
check("offering a package refused for non-owner", r.status === 403 && r.json?.error?.code === "FORBIDDEN", code(r));
r = await req("/api/admin/packages/BAD%20KEY", { method: "POST", body: {} });
check("invalid package key 422", r.status === 422, code(r));
r = await req("/api/admin/catalog/models/veo-3-1/availability", { method: "POST", body: { state: "enabled" } });
check("switch on refused without KIE credentials (409)", r.status === 409 && r.json?.error?.code === "CREDENTIALS_MISSING", code(r));
r = await req("/api/admin/catalog/packages/impact", { method: "POST", body: { changes: {} } });
check("retired package-impact endpoint is gone", r.status === 404, code(r));

const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 1));
