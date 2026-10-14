// Simplified admin (Models, Pricing & packages, KIE balance) — browser checks (live mode, local build on :3200).
// Usage: QA_EMAIL=… QA_PASSWORD=… PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=…/axe.min.js node pricing-flows.mjs
// The account needs the `operations` + `finance` staff roles (not owner). Part A runs against the real database and
// only reads (bulk preview and reference impact are read-only RPCs; the balance refresh is rewritten to the read-only
// summary). Part B checks the write flows (switch, price, reference, package, bulk save) against intercepted
// responses. A request guard fails the run if any write reaches the server.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright-core");
const axeSource = readFileSync(process.env.AXE_PATH ?? require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = "http://localhost:3200";
const qa = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!qa.email || !qa.password) throw new Error("set QA_EMAIL and QA_PASSWORD");

const READ_ONLY_POSTS = ["/api/admin/catalog/bulk-pricing/preview", "/api/admin/pricing/references/impact", "/api/auth/sign-in"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const results = [];
const consoleErrors = [];
const writes = [];
const intercepted = new Set();
const check = (name, ok, info = "") => results.push({ name, ok: Boolean(ok), info: String(info).slice(0, 300) });
ctx.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
ctx.on("weberror", (e) => consoleErrors.push(`pageerror ${e.error().message}`));
// Guard: every non-GET API call must be a read-only RPC or an intercepted (fulfilled in the browser) request.
ctx.on("request", (r) => {
  const u = new URL(r.url());
  if (u.origin === BASE && r.method() !== "GET" && u.pathname.startsWith("/api/") && !READ_ONLY_POSTS.includes(u.pathname) && !intercepted.has(u.pathname)) {
    writes.push(`${r.method()} ${u.pathname}`);
  }
});
await ctx.route("**/api/admin/provider/balance/refresh", (route) =>
  route.fetch({ url: `${BASE}/api/admin/provider/summary`, method: "GET" }).then((response) => route.fulfill({ response })),
);
intercepted.add("/api/admin/provider/balance/refresh");

const settle = async (p = page, ms = 800) => {
  await p.waitForFunction(() => !document.querySelector("main [aria-busy=true]") && document.querySelector("main h1"), null, { timeout: 25000 }).catch(() => null);
  await p.waitForLoadState("networkidle").catch(() => null);
  await p.waitForTimeout(ms);
};
const text = async (p = page, sel = "main") => (await p.locator(sel).first().innerText().catch(() => "")) || "";
const axe = async (name, include, p = page) => {
  await p.addScriptTag({ content: axeSource });
  const r = await p.evaluate(async (inc) => (await window.axe.run(inc ? document.querySelector(inc) : document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}(${v.nodes.length})`), include ?? null);
  check(`axe ${name}`, r.length === 0, r.join(", "));
};
const overflow = async (name, p = page) => {
  for (const w of [1440, 1024, 768, 390]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(250);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow: ${name} @${w}`, o <= 1, `${o}px`);
  }
  await p.setViewportSize({ width: 1366, height: 900 });
};
const LEGACY = /Record verification|Set experimental|Set maintenance|Publish price|Models & pricing|Lowest revenue per credit|"base":|"units":|"rates":/;

// ---------------------------------------------------------------------------------------------- part A

await page.goto(`${BASE}/sign-in?next=/admin/catalog`);
await page.fill("#email", qa.email);
await page.fill("#password", qa.password);
await page.click("button[type=submit]");
await page.waitForURL(`${BASE}/admin/catalog`, { timeout: 25000 });
await settle(page, 1500);
let t = await text();
check("Models page heading", /^Models\b/m.test(t), t.slice(0, 80));
const switches = () => page.getByRole("switch").count();
check("one On/Off switch per model (18)", (await switches()) === 18, await switches());
check("no legacy buttons, prices or raw JSON on the Models page", !LEGACY.test(t) && !/credits|\$\d/.test(t), t.match(LEGACY)?.[0]);
check("variants are distinguishable", /Veo 3\.1 Fast/.test(t) && /Veo 3\.1 Lite/.test(t) && /Veo 3\.1 Quality/.test(t) && /\bFast\b/.test(t) && /\bQuality\b/.test(t));
const nav = await text(page, "nav");
check("navigation: Models, Pricing & packages, KIE balance", /Models/.test(nav) && /Pricing & packages/.test(nav) && /KIE balance/.test(nav) && !/Models & pricing/.test(nav), nav.slice(0, 300));
await axe("models page");
await page.getByRole("button", { name: "Videos", exact: true }).click();
check("video filter", (await switches()) === 7, await switches());
await page.getByRole("button", { name: "Images", exact: true }).click();
check("image filter", (await switches()) === 11, await switches());
await page.getByRole("button", { name: "All", exact: true }).click();
await page.getByPlaceholder("Search models").fill("veo");
check("search", (await switches()) === 3, await switches());
await page.getByPlaceholder("Search models").fill("");
// Switching on without the KIE key (local build) is explained in one sentence, nothing is sent, the switch stays off.
const flare = page.getByRole("switch", { name: "GPT Image 2.5 Flare: available to customers" });
await flare.click();
await page.waitForTimeout(400);
t = await text();
check("switch on blocked with one short message", /cannot send work to KIE yet/.test(t), t.match(/[^\n]*KIE[^\n]*/)?.[0]);
check("switch returns to Off", (await flare.getAttribute("aria-checked")) === "false");
// Optional diagnostics
await page.getByRole("button", { name: "Details for GPT Image 2.5 Flare", exact: true }).click();
let dlg = page.getByRole("dialog");
await dlg.waitFor();
await page.waitForFunction(() => !document.querySelector("dialog [aria-busy=true]"), null, { timeout: 15000 });
let d = await dlg.innerText();
check("details: status with optional test", /What switching on needs/.test(d) && /Private test \(optional\)/.test(d) && /never blocks switching/.test(d), d.slice(0, 200));
check("details: special states live here", /Paused for maintenance/.test(d) && /labelled experimental/.test(d));
check("details: tabs", ["Status", "Private test", "KIE cost", "Activity", "Advanced"].every((x) => d.includes(x)));
check("details: no manual verification form", !/Record evidence|Record manual/.test(d));
await axe("details dialog", "dialog[open]");
await dlg.getByRole("tab", { name: "Private test" }).click();
await page.waitForTimeout(300);
d = await dlg.innerText();
check("details: private test shows the cost before a paid request", /Expected KIE cost: 6 KIE/.test(d) && /spends credits from the owner’s KIE balance/.test(d), d.match(/Expected KIE cost[^\n]*/)?.[0]);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes details", (await page.getByRole("dialog").count()) === 0);
await overflow("models");

// Pricing & packages
await page.goto(`${BASE}/admin/pricing`);
await settle(page, 1500);
t = await text();
check("Pricing heading and three sections", /Pricing & packages/.test(t) && /Reference values/.test(t) && /Packages/.test(t) && /Model prices/.test(t));
check("KIE credit cost card: $0.005 per KIE credit", /KIE credit cost/.test(t) && /\$0\.005\s*per KIE credit/.test(t), t.match(/\$[\d.]+\s*per KIE credit/)?.[0]);
check("Genlixs credit value card: $0.02 per Genlixs credit", /Genlixs credit value/.test(t) && /\$0\.02\s*per Genlixs credit/.test(t), t.match(/\$[\d.]+\s*per Genlixs credit/)?.[0]);
check("example value labelled", /Example value, not confirmed/.test(t));
check("ratio: one Genlixs credit worth 4 KIE credits (+300 %)", /worth 4 KIE credits \(\+300 % in value\)/.test(t), t.match(/worth [^)]*\)/)?.[0]);
check("units never equated", /never the same thing as a KIE credit/.test(t));
check("no legacy pricing words or raw JSON", !LEGACY.test(t), t.match(LEGACY)?.[0]);
const pkgCards = await page.locator("section[aria-labelledby^='pkg-']").count();
check("package editor for every package", pkgCards >= 3, pkgCards);
check("package economics", /Usable credits/.test(t) && /Value per credit/.test(t) && /Against the credit value/.test(t));
check("Starter at the credit value: $9 / 200 = $0.045 (+125 % premium)", /\$0\.045/.test(t) && /\+125 % premium/.test(t));
check("finance cannot offer packages", (await page.getByRole("switch", { name: /offered to customers/ }).first().isDisabled()) === true);
check("price list for every model", (await page.getByRole("button", { name: /Set price|Edit price|View price/ }).count()) === 18);
await axe("pricing page");
// reference card: live rate, unchanged = no save
const creditCard = page.locator("section[aria-labelledby='ref-credit_value-h']");
await creditCard.getByLabel("Genlixs credits").fill("100");
await page.waitForTimeout(300);
check("credit value updates live ($5 / 100 = $0.05)", /\$0\.05\s*per Genlixs credit/.test(await creditCard.innerText()));
await creditCard.getByLabel("Genlixs credits").fill("250");
// price editor
await page.goto(`${BASE}/admin/pricing?model=gpt-flare-image`);
await settle(page, 1200);
dlg = page.getByRole("dialog");
await dlg.waitFor();
await page.waitForFunction(() => !document.querySelector("dialog [aria-busy=true]"), null, { timeout: 15000 });
d = await dlg.innerText();
check("editor: KIE cost per setting", /6 KIE/.test(d) && /\$0\.03\b/.test(d) && /10 KIE/.test(d) && /16 KIE/.test(d));
check("editor: no raw JSON", !/[{}]/.test(d));
await dlg.getByLabel("Markup for every setting (%)").fill("100");
await dlg.getByRole("button", { name: "Apply to all settings" }).click();
await page.waitForTimeout(300);
const credits = await dlg.locator("tbody input[aria-label^='Genlixs credits']").evaluateAll((els) => els.map((e) => e.value));
check("+100 %: 3 / 5 / 8 credits", credits.join(",") === "3,5,8", credits.join(","));
d = await dlg.innerText();
check("+100 %: values $0.06 / $0.10 / $0.16 and actual markup", /3 cr = \$0\.06 · \+100 %/.test(d) && /5 cr = \$0\.10 · \+100 %/.test(d) && /8 cr = \$0\.16 · \+100 %/.test(d), d.match(/\d+ cr = [^\n]*/g)?.join(" | "));
check("example contribution: $0.03 direct, $0.012 at 30 %, $0.00 at 50 %", /\$0\.03\b[\s\S]*\$0\.012[\s\S]*\$0\.00\b/.test(d.slice(d.indexOf("Package comparison"))), d.slice(d.indexOf("Package comparison"), d.indexOf("Package comparison") + 400));
check("50 % fewer credits, +100 % in value", /3 Genlixs credits for 6 KIE: 50 % fewer credits in\s+number, worth \+100 % in value/.test(d), d.match(/Genlixs credits for[^\n]*/)?.[0]);
// target USD drives the charge (rounded up)
await dlg.getByLabel("Value in USD for 1K").fill("0.055");
await page.waitForTimeout(200);
d = await dlg.innerText();
check("target $0.055 rounds up to 3 credits ($0.06)", (await dlg.getByLabel("Genlixs credits for 1K").inputValue()) === "3" && /rounded up from \$0\.055/.test(d));
// below cost is flagged and needs a confirmation
await dlg.getByLabel("Genlixs credits for 1K").fill("1");
await page.waitForTimeout(200);
d = await dlg.innerText();
check("below KIE cost flagged with confirmation", /below KIE cost/.test(d) && /Save anyway \(recorded in the audit log\)/.test(d));
check("finance: draft only, owner applies", (await dlg.getByRole("button", { name: "Save price" }).count()) === 0 && (await dlg.getByRole("button", { name: "Save as draft" }).count()) === 1);
await axe("price editor", "dialog[open]");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
// bulk preview (read-only)
await page.getByRole("button", { name: "Apply a markup to several models" }).click();
dlg = page.getByRole("dialog");
await dlg.waitFor();
check("bulk uses the stated credit value", /\$0\.02 per Genlixs credit/.test(await dlg.innerText()));
await dlg.getByRole("radio", { name: "Images" }).check();
await dlg.getByLabel("Markup above KIE cost (%)").fill("100");
await dlg.getByRole("button", { name: "Preview" }).click();
await page.waitForFunction(() => /Preview: \+100/.test(document.querySelector("dialog[open]")?.textContent ?? ""), null, { timeout: 20000 });
d = await dlg.innerText();
check("bulk preview lists image models", /GPT Image 2\.5 Flare/.test(d) && /Seedream 5\.0 Flash/.test(d) && /3–8 credits/.test(d), d.match(/\d+–\d+ credits/g)?.slice(0, 4).join(" "));
await dlg.getByRole("button", { name: "Settings" }).first().click();
await page.waitForTimeout(200);
d = await dlg.innerText();
check("bulk preview per setting with keep option", /Actual markup/.test(d) && /Untick a setting to keep its current charge/.test(d));
check("finance: Save as drafts only", (await dlg.getByRole("button", { name: "Save changes" }).count()) === 0 && (await dlg.getByRole("button", { name: "Save as drafts" }).count()) === 1);
await axe("bulk dialog", "dialog[open]");
await page.keyboard.press("Escape");
await overflow("pricing");

// KIE balance
await page.goto(`${BASE}/admin/kie`);
await settle(page, 1500);
t = await text();
check("KIE balance page", /KIE balance/.test(t) && /KIE credits used/.test(t) && /Refresh now/.test(t));
check("no fabricated zero locally (not configured)", /Not configured|No reading yet/.test(t) && !/\b0 KIE\b(?! customers)/.test(t.split("KIE credits used")[0]));
check("details folded away", /More details/.test(t) && !(await page.locator("details[open]").count()));
await axe("KIE page");
await overflow("kie");

// Settings moved to their sections
await page.goto(`${BASE}/admin`);
await settle(page, 1500);
t = await text();
check("overview: service settings in plain words", /Service settings/.test(t) && /Pause all new generations/.test(t) && /A price check stays valid for/.test(t) && !/quote_ttl_seconds/.test(t));
await page.goto(`${BASE}/admin/affiliates`);
await settle(page, 1200);
t = await text();
check("partners: commission terms", /Partner commission terms/.test(t) && /30 % commission/.test(t));
check("part A sent no writes to the server", writes.length === 0, writes.join(", "));

// ---------------------------------------------------------------------------------------------- part B

const fx = await ctx.newPage();
const sent = {};
const capture = (path, respond) => {
  intercepted.add(new URL(path, BASE).pathname);
  return fx.route(`${BASE}${path}`, async (route) => {
    sent[path] = route.request().postDataJSON();
    return respond(route);
  });
};
// Catalog with the KIE key present and GPT Image 2.5 Flare ready (priced), so the switch reaches the server.
const live = await (await fx.request.get(`${BASE}/api/admin/catalog`)).json();
const cat = structuredClone(live.data);
cat.runtime.submitsEnabled = true;
const fm = cat.models.find((m) => m.id === "gpt-flare-image");
fm.readiness.checks = fm.readiness.checks.map((c) => ({ ...c, ok: c.key === "verification" ? c.ok : true }));
await fx.route(`${BASE}/api/admin/catalog`, (route) => route.fulfill({ json: { data: cat, requestId: "fixture" } }));
let fail = false;
await capture("/api/admin/catalog/models/gpt-flare-image/availability", (route) =>
  fail
    ? route.fulfill({ status: 409, json: { error: { code: "PROVIDER_PAUSED", message: "The KIE account is paused in Genlixs." } } })
    : // the fixture catalog then reflects the saved state, as the real reload would
      ((fm.state = "enabled"), route.fulfill({ json: { data: { modelId: "gpt-flare-image", state: "enabled", enableBasis: "documented_cost", verificationStatus: "untested" } } })),
);
await fx.goto(`${BASE}/admin/catalog`);
await settle(fx, 1200);
const sw = fx.getByRole("switch", { name: "GPT Image 2.5 Flare: available to customers" });
await sw.click();
await fx.waitForTimeout(500);
check("switch on: sends the real availability request", sent["/api/admin/catalog/models/gpt-flare-image/availability"]?.state === "enabled", JSON.stringify(sent));
check("switch on: shows On on success", (await sw.getAttribute("aria-checked")) === "true");
// failure restores the switch
cat.models.find((m) => m.id === "gpt-flare-image").state = "disabled";
fail = true;
await fx.reload();
await settle(fx, 1200);
await fx.getByRole("switch", { name: "GPT Image 2.5 Flare: available to customers" }).click();
await fx.waitForTimeout(500);
check("switch failure: back to Off with the reason", (await fx.getByRole("switch", { name: "GPT Image 2.5 Flare: available to customers" }).getAttribute("aria-checked")) === "false" && /Not changed: The KIE account is paused/.test(await text(fx)));

// price save (finance → draft) with the server-computed body
await capture("/api/admin/catalog/models/gpt-flare-image/price", (route) => route.fulfill({ json: { data: { unchanged: false, priceVersionId: "00000000-0000-4000-8000-000000000001", version: 1, state: "draft", belowCost: [] } } }));
await fx.goto(`${BASE}/admin/pricing?model=gpt-flare-image`);
await settle(fx, 1200);
let fd = fx.getByRole("dialog");
await fd.waitFor();
await fx.waitForFunction(() => !document.querySelector("dialog [aria-busy=true]"), null, { timeout: 15000 });
await fd.getByLabel("Markup for every setting (%)").fill("100");
await fd.getByRole("button", { name: "Apply to all settings" }).click();
await fd.getByRole("button", { name: "Save as draft" }).click();
await fx.waitForTimeout(800);
const pb = sent["/api/admin/catalog/models/gpt-flare-image/price"];
check("price save body: whole credits per setting, draft, concurrency token", pb && JSON.stringify(pb.units) === JSON.stringify({ "1K": 3, "2K": 5, "4K": 8 }) && pb.publish === false && "expectedPriceVersionId" in pb, JSON.stringify(pb));
check("price save confirmation", /Saved as draft v1/.test(await fd.innerText()));
await fx.keyboard.press("Escape");

// reference save
await capture("/api/admin/pricing/references", (route) =>
  route.fulfill({ json: { data: { unchanged: false, reference: { ...cat.references.credit, version: 2, amountUsd: 5, credits: 100, usdPerCredit: 0.05, isExample: false } } } }),
);
const cc = fx.locator("section[aria-labelledby='ref-credit_value-h']");
await cc.getByLabel("Genlixs credits").fill("100");
await cc.getByRole("button", { name: "Save" }).click();
await fx.waitForTimeout(600);
const rb = sent["/api/admin/pricing/references"];
check("reference save body: exact decimal text and concurrency token", rb?.kind === "credit_value" && rb.amountUsd === "5" && rb.credits === "100" && rb.expectedVersionId === cat.references.credit.id, JSON.stringify(rb));
check("reference saved: balances and prices untouched message", /Wallet balances, purchases, quotes, running jobs and current prices did not change/.test(await cc.innerText()));

// package save (draft package edited by finance, not offered)
const starter = cat.products.filter((p) => p.key === "starter").sort((a, b) => b.version - a.version)[0];
await capture("/api/admin/packages/starter", (route) => route.fulfill({ json: { data: { unchanged: false, productVersionId: starter.id, offered: false } } }));
const sc = fx.locator("section[aria-labelledby='pkg-starter-h']");
await sc.getByLabel("Bonus credits").fill("50");
await fx.waitForTimeout(200);
check("bonus counts in usable credits and the rate", /250/.test(await sc.innerText()) && /\$0\.036/.test(await sc.innerText()), (await sc.innerText()).slice(0, 300));
await sc.getByRole("button", { name: "Save package" }).click();
await fx.waitForTimeout(600);
const kb = sent["/api/admin/packages/starter"];
check("package save body", kb?.includedCredits === 200 && kb.bonusCredits === 50 && kb.amountMinor === 900 && kb.offered === false && kb.expectedVersionId === starter.id, JSON.stringify(kb));

// bulk save sends kept settings and the preview revision
await capture("/api/admin/catalog/bulk-pricing/save", (route) => route.fulfill({ json: { data: { ref: "PB-QA0001", action: "draft", items: [{}, {}] } } }));
await fx.getByRole("button", { name: "Apply a markup to several models" }).click();
fd = fx.getByRole("dialog");
await fd.waitFor();
await fd.getByRole("radio", { name: "Images" }).check();
await fd.getByRole("button", { name: "Preview" }).click();
await fx.waitForFunction(() => /Preview: \+100/.test(document.querySelector("dialog[open]")?.textContent ?? ""), null, { timeout: 20000 });
await fd.getByRole("button", { name: "Save as drafts" }).click();
await fx.waitForTimeout(700);
const bb = sent["/api/admin/catalog/bulk-pricing/save"];
check("bulk save body: revision, selection, all-or-nothing", bb?.previewRevision?.length === 32 && Array.isArray(bb.selected) && bb.selected.length >= 1 && bb.publish === false, JSON.stringify(bb)?.slice(0, 200));
check("bulk saved message", /Saved as drafts: 2 model price/.test(await fd.innerText()));

check("no write reached the server", writes.length === 0, writes.join(", "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results: failed.length ? failed : results.map((r) => r.name), consoleErrors: consoleErrors.slice(0, 20) }, null, 1));
