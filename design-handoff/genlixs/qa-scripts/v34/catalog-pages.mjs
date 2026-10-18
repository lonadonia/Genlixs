// Catalog pages after the multi-supplier rebuild (Models, Pricing & packages, Supplier balances) against a running app with
// a mocked staff session. Every admin read is answered from saved API responses (FIXTURES directory); every write is
// blocked and reported. Nothing reaches Supabase or a supplier.
//
// FIXTURES must contain the `data` of these GET responses, saved as a staff member with provider.read:
//   catalog.json (/api/admin/catalog) · supply.json (/api/admin/catalog/supply) · overview.json (/api/admin/providers/overview)
//   summary.json (/api/admin/provider/summary) · routing-models.json (/api/admin/providers/models)
//   health.json (/api/admin/generation/health)
// Env: FIXTURES, PLAYWRIGHT_PATH, CHROME_PATH, BASE (default http://localhost:3200), OUT.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, launch, overflowX, sleep } from "./mock.mjs";

const OUT = process.env.OUT ?? "out-v34/catalog";
mkdirSync(OUT, { recursive: true });
const fx = (f) => JSON.parse(readFileSync(join(process.env.FIXTURES, f), "utf8"));
const CATALOG = fx("catalog.json");
const SUPPLY = fx("supply.json");
const OVERVIEW = fx("overview.json");
const SUMMARY = fx("summary.json");
const ROUTING = fx("routing-models.json");
const HEALTH = fx("health.json");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const ROLES = {
  owner: {
    caps: ["admin.access", "provider.read", "provider.manage", "catalog.operate", "catalog.publish", "catalog.test", "pricing.review", "jobs.read"],
    access: { canSeeCosts: true, canPrice: true, canPublish: true, canOperate: true, canTest: true, canReadProvider: true },
  },
  support: {
    caps: ["admin.access", "support.read", "users.read"],
    access: { canSeeCosts: false, canPrice: false, canPublish: false, canOperate: false, canTest: false, canReadProvider: false },
  },
};

async function context(browser, role, width = 1440, height = 900) {
  const R = ROLES[role];
  const ctx = await browser.newContext({ viewport: { width, height } });
  const json = (route, data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data, requestId: "mock" }) });
  const forbidden = (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Your role cannot do this." } }) });
  const writes = [];
  await ctx.route(/\/api\/admin\/.*/, (r) => {
    if (r.request().method() !== "GET") writes.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
    return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_MOCKED", message: "Not in the fixtures." } }) });
  });
  await ctx.route("**/api/me", (r) => json(r, { id: "u", email: "staff@genlixs.test", emailVerified: true, displayName: "Staff", locale: "en", accountStatus: "active", capabilities: R.caps, isStaff: true }));
  await ctx.route("**/api/wallet", (r) => json(r, { availableUnits: "0", reservedUnits: "0", spentUnits: "0", restricted: false, nearestExpiry: null, lots: [], periodSpentUnits: "0" }));
  await ctx.route("**/api/notifications**", (r) => json(r, { items: [], unread: 0 }));
  await ctx.route("**/api/admin/me", (r) => json(r, { userId: "u", email: "staff@genlixs.test", roles: [role], capabilities: R.caps }));
  const prov = R.caps.includes("provider.read");
  await ctx.route(/\/api\/admin\/catalog(\?.*)?$/, (r) => json(r, { ...CATALOG, access: R.access, references: R.access.canSeeCosts ? CATALOG.references : null }));
  await ctx.route(/\/api\/admin\/catalog\/supply(\?.*)?$/, (r) => (prov ? json(r, SUPPLY) : forbidden(r)));
  await ctx.route(/\/api\/admin\/provider\/(summary|balance\/refresh)$/, (r) => (prov ? json(r, SUMMARY) : forbidden(r)));
  await ctx.route("**/api/admin/generation/health", (r) => json(r, HEALTH));
  await ctx.route(/\/api\/admin\/providers\/overview$/, (r) => (prov ? json(r, OVERVIEW) : forbidden(r)));
  await ctx.route("**/api/admin/providers/models", (r) => (prov ? json(r, ROUTING) : forbidden(r)));
  return { ctx, writes };
}

const groupsIn = (models) => new Set(models.map((m) => m.tool)).size;
const browser = await launch();
try {
  {
    const { ctx, writes } = await context(browser, "owner");
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${BASE}/admin/catalog`, { waitUntil: "networkidle" });
    await sleep(1200);
    const rows = await page.locator("table tbody tr").count();
    check("Models: each model once, grouped by type", rows === CATALOG.models.length + groupsIn(CATALOG.models), `${rows} rows`);
    const sample = SUPPLY.models.find((m) => m.quotes.length > 1) ?? SUPPLY.models[0];
    const name = CATALOG.models.find((m) => m.id === sample.id)?.name;
    await page.getByRole("button", { name, exact: true }).click();
    await sleep(500);
    const sheet = await page.getByRole("dialog").innerText();
    check(`Model sheet lists every supplier quote of ${name}`, sample.quotes.every((q) => sheet.includes(q.providerName)), sheet.slice(0, 160).replace(/\s+/g, " "));
    await page.screenshot({ path: `${OUT}/model-sheet.png` });
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: /Available at suppliers/ }).click();
    await sleep(400);
    await page.getByRole("checkbox", { name: "Only products with a price" }).uncheck();
    await sleep(300);
    const prodRows = await page.locator("table tbody tr").count();
    const kinds = new Set(SUPPLY.products.map((p) => (p.tool === "video" ? "video" : "image"))).size;
    check("Available at suppliers: each product once", prodRows === SUPPLY.products.length + kinds, `${prodRows} rows`);
    await page.screenshot({ path: `${OUT}/available.png`, fullPage: true });

    await page.goto(`${BASE}/admin/pricing?tab=references`, { waitUntil: "networkidle" });
    await sleep(1000);
    const ref = await page.locator("main").innerText();
    check("Pricing: reference values with supplier currencies", ref.includes("Supplier currencies") && ref.includes("Genlixs credit value"));

    await page.goto(`${BASE}/admin/kie`, { waitUntil: "networkidle" });
    await sleep(1200);
    check("Old KIE address opens Supplier balances", page.url().endsWith("/admin/balances"), page.url());
    check("Supplier balances: one card per supplier", (await page.locator("article").count()) === OVERVIEW.accounts.length);
    const nav = await page.locator("nav").first().innerText();
    check("Navigation: Supplier balances", nav.includes("Supplier balances") && !nav.includes("KIE balance"));
    await page.screenshot({ path: `${OUT}/balances.png`, fullPage: true });

    check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    check("No write request left the browser", writes.length === 0, writes.join(", "));
    await ctx.close();
  }
  {
    const { ctx } = await context(browser, "support");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/catalog`, { waitUntil: "networkidle" });
    await sleep(1000);
    const t = await page.locator("main").innerText();
    check("Support role: models without supplier columns", !t.includes("Served by") && !t.includes("Margin"));
    await ctx.close();
  }
  for (const [w, h] of [[390, 844], [1024, 768], [1440, 900]]) {
    const { ctx } = await context(browser, "owner", w, h);
    const page = await ctx.newPage();
    for (const p of ["/admin/catalog", "/admin/pricing", "/admin/balances"]) {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      await sleep(1000);
      const o = await overflowX(page);
      check(`No horizontal overflow at ${w}px on ${p}`, o === 0, `${o}px`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
