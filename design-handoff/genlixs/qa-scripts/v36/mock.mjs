// v3.6 browser context for the two-page admin check (Models & pricing, Providers & balances). The admin API is answered
// from fixtures: FIXTURES holds dump-local-fixtures.mjs output (catalog, supply, policy, previews, apply result, state
// after it, one model detail) plus four read-only provider.read captures (overview.json = /api/admin/providers/overview,
// summary.json = /api/admin/provider/summary, routing-models.json = /api/admin/providers/models, health.json =
// /api/admin/generation/health). Nothing reaches Supabase, KIE or any other provider: every /api/* call is intercepted;
// anything not in the fixture set is refused and logged, and a request to a generation endpoint fails the run.
// Env: FIXTURES, PLAYWRIGHT_PATH (playwright or playwright-core), CHROME_PATH (optional), BASE (default http://localhost:3200).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
export const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright-core");
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const FX = (f) => JSON.parse(readFileSync(join(process.env.FIXTURES, f), "utf8"));
const PROD = { overview: FX("overview.json"), summary: FX("summary.json") };
const ROUTING = FX("routing-models.json");
const HEALTH = FX("health.json");
export const BASE = process.env.BASE ?? "http://localhost:3200";

const ALL_CAPS = ["admin.access", "affiliates.fraud", "affiliates.review", "audit.read", "billing.read", "billing.refund", "catalog.operate", "catalog.publish", "catalog.test", "credits.adjust", "jobs.operate", "jobs.read", "payouts.approve", "payouts.prepare", "pricing.review", "provider.manage", "provider.read", "reports.read", "settings.manage", "staff.manage", "support.read", "support.reply", "users.manage", "users.read"];
const ROLES = {
  owner: { caps: ALL_CAPS, access: { canSeeCosts: true, canPrice: true, canPublish: true, canOperate: true, canTest: true, canReadProvider: true } },
  finance: {
    caps: ["admin.access", "jobs.read", "credits.adjust", "billing.read", "billing.refund", "pricing.review", "provider.read", "reports.read", "users.read", "audit.read"],
    access: { canSeeCosts: true, canPrice: true, canPublish: false, canOperate: false, canTest: false, canReadProvider: true },
  },
  support: {
    caps: ["admin.access", "support.read", "support.reply", "users.read"],
    access: { canSeeCosts: false, canPrice: false, canPublish: false, canOperate: false, canTest: false, canReadProvider: false },
  },
};
const USAGE = { from: "2026-10-01T00:00:00Z", to: "2026-10-19T00:00:00Z", timezone: "UTC", totals: { entries: 0, confirmedUsd: 0, estimatedAwaitingUsd: 0, pendingUsd: 0, estimateOfConfirmedUsd: 0, notChargedOrFailed: 0, unknownCost: 0, historicalUnknown: 0, byProvider: [], byModel: [] }, adjustments: [], accountReported: [], rows: [] };

export async function mockContext(browser, { role = "owner", width = 1440, height = 900 } = {}) {
  const R = ROLES[role];
  const canProv = R.caps.includes("provider.read");
  const canPolicy = canProv || R.caps.includes("pricing.review");
  const ctx = await browser.newContext({ viewport: { width, height } });
  const state = { applied: false };
  const log = { posts: [], refused: [], generation: [] };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data, requestId: "mock" }) });
  const error = (route, code, message, status) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message } }) });
  const forbidden = (route) => error(route, "FORBIDDEN", "Your role does not allow this action.", 403);

  // Anything under /api that is not answered below is refused (and generation endpoints are flagged).
  await ctx.route(/\/api\//, (r) => {
    const u = new URL(r.request().url());
    if (/\/api\/(generation|generations|uploads)/.test(u.pathname) || /\/tests$/.test(u.pathname)) log.generation.push(`${r.request().method()} ${u.pathname}`);
    log.refused.push(`${r.request().method()} ${u.pathname}`);
    return error(r, "NOT_MOCKED", "Not in the fixture set.", 404);
  });
  await ctx.route("**/api/me", (r) => json(r, { id: "u", email: "owner@genlixs.test", emailVerified: true, displayName: "Staff", locale: "en", accountStatus: "active", capabilities: R.caps, isStaff: true }));
  await ctx.route("**/api/wallet", (r) => json(r, { availableUnits: "0", reservedUnits: "0", spentUnits: "0", restricted: false, nearestExpiry: null, lots: [], periodSpentUnits: "0" }));
  await ctx.route("**/api/notifications**", (r) => json(r, { items: [], unread: 0 }));
  await ctx.route("**/api/admin/me", (r) => json(r, { userId: "u", email: "owner@genlixs.test", roles: [role], capabilities: R.caps }));

  const catalog = () => {
    const c = FX(state.applied ? "catalog-after.json" : "catalog.json");
    return { ...c, access: R.access, references: R.access.canSeeCosts ? c.references : null, runtime: { submitsEnabled: true, kieKeyPresent: true, fakeProvider: false, balanceReadable: true, adaptersInCode: [] } };
  };
  await ctx.route(/\/api\/admin\/catalog(\?.*)?$/, (r) => json(r, catalog()));
  await ctx.route(/\/api\/admin\/catalog\/supply(\?.*)?$/, (r) => (!canProv ? forbidden(r) : json(r, FX(state.applied ? "supply-after.json" : "supply.json"))));
  await ctx.route(/\/api\/admin\/catalog\/policy(\?.*)?$/, (r) => {
    if (!canPolicy) return forbidden(r);
    const p = FX(state.applied ? "policy-after.json" : "policy.json");
    return json(r, { ...p, canPreview: R.caps.includes("pricing.review"), canApply: R.caps.includes("catalog.publish") && R.caps.includes("pricing.review") });
  });
  await ctx.route("**/api/admin/catalog/policy/preview", (r) => {
    const b = r.request().postDataJSON();
    log.posts.push(`preview ${b.markupPercent} ${b.usdPerCredit}`);
    if (!R.caps.includes("pricing.review")) return forbidden(r);
    if (b.markupPercent === "150" && b.usdPerCredit === "0.02") return json(r, FX("preview-150.json"));
    if (b.markupPercent === "100" && b.usdPerCredit === "0.025") return json(r, FX("preview-100-0.025.json"));
    return error(r, "NOT_MOCKED", "No preview fixture for these values.", 404);
  });
  await ctx.route("**/api/admin/catalog/policy/apply", (r) => {
    const b = r.request().postDataJSON();
    log.posts.push(`apply ${b.markupPercent} ${b.usdPerCredit} ${b.expectedPolicyId}`);
    if (!R.caps.includes("catalog.publish")) return forbidden(r);
    if (b.markupPercent !== "150" || b.usdPerCredit !== "0.02" || b.expectedPolicyId !== FX("policy.json").policy.policyId) return error(r, "POLICY_CHANGED", "Fixture mismatch.", 409);
    state.applied = true;
    return json(r, FX("apply-150.json"));
  });
  await ctx.route(/\/api\/admin\/catalog\/models\/[^/]+$/, (r) => json(r, { ...FX("detail-wan.json"), runtime: catalog().runtime }));

  const overview = () => ({
    ...PROD.overview,
    canManage: role === "owner",
    runtime: { paidSubmissionsAllowed: true, kieEnvironmentKey: true, fakeProvider: false, providers: Object.fromEntries(["kie", "duomi", "poyo", "nezhagate", "cuddler", "apimart"].map((p) => [p, { adapters: [], resultHosts: [], balance: "api", usage: true }])) },
    refreshed: [],
  });
  await ctx.route(/\/api\/admin\/providers\/overview$/, (r) => (!canProv ? forbidden(r) : json(r, overview())));
  await ctx.route(/\/api\/admin\/providers\/balances\/refresh$/, (r) => {
    log.posts.push("balances refresh (answered from the snapshot)");
    return !canProv ? forbidden(r) : json(r, overview());
  });
  await ctx.route(/\/api\/admin\/providers\/[^/]+\/refresh$/, (r) => {
    log.posts.push(`provider refresh ${new URL(r.request().url()).pathname}`);
    return json(r, { skipped: true });
  });
  // The KIE summary the page reads every minute (a live balance read in production) — answered from the snapshot.
  await ctx.route(/\/api\/admin\/provider\/balance\/refresh$/, (r) => (!canProv ? forbidden(r) : json(r, { ...PROD.summary, configured: true, refreshed: false })));
  await ctx.route("**/api/admin/generation/health", (r) => json(r, HEALTH));
  await ctx.route("**/api/admin/providers/models", (r) => (!canProv ? forbidden(r) : json(r, ROUTING)));
  await ctx.route(/\/api\/admin\/providers\/usage\?.*$/, (r) => (!canProv ? forbidden(r) : json(r, USAGE)));
  return { ctx, log, state };
}
