// Live-mode API smoke checks against a local `next start` built with only the public Supabase values plus throwaway
// INTERNAL_WORKER_TOKEN / KIE_WEBHOOK_HMAC_KEY / REFERRAL_COOKIE_SIGNING_KEY (no secret key, no provider or billing keys).
// Usage: WORKER_TOKEN=<same as server> BASE=http://localhost:3200 node live-api-smoke.mjs
const BASE = process.env.BASE ?? "http://localhost:3200";
// WORKER_TOKEN must equal the server INTERNAL_WORKER_TOKEN of the build under test (use a throwaway local value).
const local = { worker: process.env.WORKER_TOKEN ?? "" };
if (!local.worker) throw new Error("set WORKER_TOKEN");
const results = [];
const check = (name, cond, info = "") => results.push({ name, ok: Boolean(cond), info });

async function req(path, { method = "GET", headers = {}, body, redirect = "manual" } = {}) {
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const same = { Origin: BASE, "Content-Type": "application/json" };

let r = await req("/api/catalog");
check("catalog 200 with tools, no enabled models", r.status === 200 && Array.isArray(r.json?.data?.tools) && r.json.data.models.length === 0, JSON.stringify(r.json?.data?.tools?.map((t) => t.id)));
check("catalog cache header public", /public/.test(r.headers.get("cache-control") ?? ""));
r = await req("/api/plans");
check("plans 200 empty (nothing published)", r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length === 0);
r = await req("/api/me");
check("me 401 envelope", r.status === 401 && r.json?.error?.code === "UNAUTHENTICATED" && typeof r.json?.requestId === "string");
check("private no-store", /no-store/.test(r.headers.get("cache-control") ?? ""));
r = await req("/api/wallet");
check("wallet 401", r.status === 401);
r = await req("/api/generations", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: {} });
check("cross-site mutation 403", r.status === 403 && r.json?.error?.code === "FORBIDDEN");
r = await req("/api/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: {} });
check("mutation without origin 403", r.status === 403);
r = await req("/api/generations", { method: "POST", headers: same, body: { quoteId: "x" } });
check("same-origin mutation without session 401", r.status === 401);
r = await req("/api/billing/checkout", { method: "POST", headers: same, body: {} });
check("checkout without session 401", r.status === 401);
r = await req("/api/admin/overview");
check("admin without session 401", r.status === 401);
r = await req("/api/admin/does-not-exist");
check("unknown admin path without session 401 (auth first)", r.status === 401);
r = await req("/api/affiliate/overview");
check("affiliate without session 401", r.status === 401);
r = await req("/api/webhooks/kie", { method: "POST", headers: { "Content-Type": "application/json" }, body: { data: { taskId: "abc123" } } });
check("kie webhook fails closed without backend key 503", r.status === 503);
r = await req("/api/webhooks/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: {} });
check("billing webhook 503 without gateway", r.status === 503);
r = await req("/api/internal/workers/control", { method: "POST" });
check("worker without token 401", r.status === 401);
r = await req("/api/internal/workers/control", { method: "POST", headers: { Authorization: "Bearer wrong" } });
check("worker wrong token 401", r.status === 401);
r = await req("/api/internal/workers/nope", { method: "POST", headers: { Authorization: `Bearer ${local.worker}` } });
check("worker unknown queue 404", r.status === 404);
r = await req("/api/internal/workers/control", { method: "POST", headers: { Authorization: `Bearer ${local.worker}` } });
check("worker without secret key 503", r.status === 503 && r.json?.error === "not_configured");
r = await req("/api/internal/health", { headers: { Authorization: `Bearer ${local.worker}` } });
const cfg = r.json?.config ?? {};
check(
  "health reports presence only",
  r.status === 200 && cfg.supabasePublic === true && cfg.supabaseSecret === false && cfg.provider === "not_configured" && cfg.billing === "not_configured" && cfg.supabaseProjectsMatch === true && !r.text.includes(local.worker),
  JSON.stringify(cfg),
);
r = await req("/r/doesnotexist");
check("unknown referral slug redirects home, no cookie", [302, 307].includes(r.status) && new URL(r.headers.get("location"), BASE).pathname === "/" && !(r.headers.get("set-cookie") ?? "").includes("gx_ref"));
r = await req("/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAA");
check("share link not available 404", r.status === 404);
r = await req("/auth/callback");
check("auth callback without code -> sign-in", [302, 307].includes(r.status) && (r.headers.get("location") ?? "").includes("/sign-in?reason=link"));
r = await req("/api/auth/sign-in", { method: "POST", headers: same, body: { email: "nobody@genlixs.test", password: "wrong-password-123" } });
check("sign-in wrong credentials 401 generic", r.status === 401 && r.json?.error?.code === "INVALID_CREDENTIALS");
r = await req("/api/auth/sign-in", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: { email: "a@b.c", password: "x" } });
check("cross-site sign-in 403", r.status === 403);
r = await req("/billing/test-checkout/00000000-0000-0000-0000-000000000000");
check("test checkout hidden without test gateway", r.status === 404);
r = await req("/");
check("home 200 without preview banner", r.status === 200 && !r.text.includes("Design preview"));
check("home shows no sample pricing", !r.text.includes("Sample values — not approved pricing"));
for (const p of ["/studio", "/studio/image", "/studio/library", "/partner", "/admin", "/sign-in", "/partners/apply", "/account/reset"]) {
  r = await req(p);
  check(`page ${p} 200`, r.status === 200);
}

const failed = results.filter((x) => !x.ok);
for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.info && !x.ok ? `  ${x.info}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
