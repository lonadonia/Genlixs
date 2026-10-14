// Admin catalog workspace + studio catalog checks (live mode, local build on :3200).
// Usage: QA_EMAIL=… QA_PASSWORD=… PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=…/axe.min.js node catalog-flows.mjs
// The account needs the `operations` + `finance` staff roles (not owner). Part A runs against the real database and
// only performs reads: previews and impact checks are read-only RPCs, and the balance refresh is rewritten to the
// read-only summary so no balance attempt is recorded. Part B checks write flows (enable, publish, tests) against
// intercepted responses, so nothing is written. A request guard fails the run if any other write reaches the server.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright-core");
const axeSource = readFileSync(process.env.AXE_PATH ?? require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = "http://localhost:3200";
const qa = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!qa.email || !qa.password) throw new Error("set QA_EMAIL and QA_PASSWORD");

const READ_ONLY_POSTS = ["/api/admin/catalog/bulk-pricing/preview", "/api/admin/catalog/packages/impact", "/api/auth/sign-in"];
// Rewritten in the browser (page.route below) to the read-only summary; it never reaches the server as a POST.
const REWRITTEN = ["/api/admin/provider/balance/refresh"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const results = [];
const consoleErrors = [];
const writes = [];
const check = (name, ok, info = "") => results.push({ name, ok: Boolean(ok), info: String(info).slice(0, 300) });
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(`${page.url()} :: ${m.text()}`));
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: pageerror ${e.message}`));
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.origin === BASE && r.method() !== "GET" && u.pathname.startsWith("/api/") && !READ_ONLY_POSTS.includes(u.pathname) && !REWRITTEN.includes(u.pathname)) writes.push(`${r.method()} ${u.pathname}`);
});
// Balance refresh is replaced by the read-only summary in part A.
await page.route("**/api/admin/provider/balance/refresh", (route) =>
  route.fetch({ url: `${BASE}/api/admin/provider/summary`, method: "GET" }).then((response) => route.fulfill({ response })),
);
const settle = async (ms = 800) => {
  await page.waitForFunction(() => !document.querySelector("[aria-busy=true]") && document.querySelector("main h1"), null, { timeout: 25000 }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.waitForTimeout(ms);
};
const text = async (sel = "main") => (await page.locator(sel).first().innerText().catch(() => "")) || "";
const axe = async (name, include) => {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async (inc) => (await window.axe.run(inc ? document.querySelector(inc) : document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}(${v.nodes.length})`), include ?? null);
  check(`axe ${name}`, r.length === 0, r.join(", "));
};
const overflow = async (name) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow: ${name}`, o <= 1, `${o}px`);
};
const tab = (name) => page.getByRole("tab", { name, exact: false }).first().click();
const rows = () => page.locator("main table tbody tr").count();

// ---------------------------------------------------------------------------------------------- part A

await page.goto(`${BASE}/sign-in?next=/admin/catalog`);
await page.fill("#email", qa.email);
await page.fill("#password", qa.password);
await page.click("button[type=submit]");
await page.waitForURL(`${BASE}/admin/catalog`, { timeout: 25000 });
await settle(1500);
let t = await text();
check("workspace heading", /Models & pricing/.test(t), t.slice(0, 120));
check("18 curated models listed", (await rows()) === 18, await rows());
check("corrected display names", /GPT Image 2\.5 Flare/.test(t) && /Veo 3\.1 Fast/.test(t) && /Veo 3\.1 Lite/.test(t) && /Kling 3\.0/.test(t) && !/Flare image\b/.test(t));
check("honest deployment notice (no KIE key locally)", /cannot send work to KIE/.test(t));
check("draft-package basis notice", /draft packages/.test(t));
check("KIE cost shown per configuration range", /6 KIE – 16 KIE/.test(t), t.match(/\d+ KIE – \d+ KIE/)?.[0]);
check("blocked enable explained with a fix", /Can’t enable yet/.test(t) && /Resolve/.test(t));
check("no raw price-rule JSON on the list", !/"base":|"units":/.test(t));
await axe("models tab");
await page.getByRole("button", { name: "Videos", exact: true }).click();
check("video filter", (await rows()) === 7, await rows());
await page.getByRole("button", { name: "Images & edits" }).click();
check("image filter", (await rows()) === 11, await rows());
await page.getByRole("button", { name: "All", exact: true }).click();
await page.getByPlaceholder("Search models").fill("veo");
check("search", (await rows()) === 3, await rows());
await page.getByPlaceholder("Search models").fill("");
// Switch on → explained block (no write).
await page.getByRole("switch", { name: "GPT Image 2.5 Flare: available to customers" }).click();
let dlg = page.getByRole("dialog");
await dlg.waitFor({ timeout: 8000 });
check("enable blocked with a reason", /can’t be enabled yet/i.test(await dlg.innerText()) && /cannot send work to KIE/.test(await dlg.innerText()), await dlg.innerText());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the dialog", (await page.getByRole("dialog").count()) === 0);
// Selection + bulk actions bar.
await page.getByRole("checkbox", { name: "Select Veo 3.1 Fast" }).first().check();
await page.getByRole("checkbox", { name: "Select Kling 3.0" }).first().check();
t = await text();
check("selection bar", /2 selected/.test(t) && /Enable selected/.test(t) && /Price selected/.test(t));

// Model panel: pricing, availability, test, cost, activity, advanced.
await page.locator("main table tbody tr").filter({ hasText: "GPT Image 2.5 Flare" }).first().getByRole("button", { name: "Edit pricing" }).click();
dlg = page.getByRole("dialog");
await dlg.waitFor();
await page.waitForFunction(() => !document.querySelector("dialog [aria-busy=true]"), null, { timeout: 15000 });
let d = await dlg.innerText();
check("panel opens on pricing", /GPT Image 2\.5 Flare/.test(d) && /New charge/.test(d) && /Lowest revenue per credit/.test(d), d.slice(0, 200));
await dlg.getByLabel("Markup above KIE cost (%)").fill("300");
await dlg.getByRole("button", { name: "Fill charges from markup" }).click();
await page.waitForTimeout(1500);
const vals = await dlg.locator("tbody input").evaluateAll((els) => els.map((e) => e.value));
check("fill from markup uses server math (+300 %: 4/6/10)", vals.join(",") === "4,6,10", vals.join(","));
d = await dlg.innerText();
check("live revenue and 30 %/50 % contribution", /\$0\.138/.test(d) && /\$0\.0666/.test(d) && /\$0\.039/.test(d), d.match(/\$0\.0\d+/g)?.slice(0, 6).join(" "));
check("contribution labelled not net profit", /not net profit/.test(d));
await axe("model panel pricing", "dialog[open]");
await dlg.getByRole("tab", { name: "Availability" }).click();
d = await dlg.innerText();
check("readiness checklist", /Integration implemented/.test(d) && /Server credentials/.test(d) && /\(not met\)/.test(d) && /Verified with a real test/.test(d));
check("one coherent state selector with customer explanations", /Hidden from customers/.test(d) && /temporarily unavailable/.test(d) && /labelled Experimental/.test(d));
check("save disabled until changed", await dlg.getByRole("button", { name: "Save availability" }).isDisabled());
await axe("model panel availability", "dialog[open]");
await dlg.getByRole("tab", { name: /^Test/ }).click();
d = await dlg.innerText();
check("test: spend warning + expected cost", /spends credits from the owner’s KIE balance/.test(d) && /6 KIE \(\$0\.03\)/.test(d), d.match(/Expected KIE cost[^\n]*/)?.[0]);
check("test: disabled without KIE key", await dlg.getByRole("button", { name: "Run paid test" }).isDisabled());
await axe("model panel test", "dialog[open]");
await dlg.getByRole("tab", { name: "KIE cost" }).click();
d = await dlg.innerText();
check("cost: manual sourced update path, no fake sync", /no documented price API/.test(d) && /Record new cost version/.test(d) && /Cost versions/.test(d));
await axe("model panel cost", "dialog[open]");
await dlg.getByRole("tab", { name: "Advanced" }).click();
await dlg.locator("summary").first().click();
d = await dlg.innerText();
check("advanced view holds ids and raw JSON", /gpt-image-2-5-flare-text-to-image/.test(d) && /"jobKind"/.test(d));
await dlg.getByRole("tab", { name: "Activity" }).click();
check("activity section", /Activity/.test(await dlg.innerText()));
await page.keyboard.press("Escape");

// Bulk pricing preview (read-only).
await tab("Bulk pricing");
await settle(500);
await page.getByLabel("Markup above KIE cost (%)").fill("300");
await page.getByRole("button", { name: "Preview prices" }).click();
await page.waitForSelector("text=Basis of this preview", { timeout: 20000 });
t = await text();
check("bulk: markup definition explained", /\+100 % = 2× cost, \+300 % = 4× cost/.test(t) && /not net profit margin/.test(t));
check("bulk: conservative credit value", /\$0\.0345 per credit/.test(t));
check("bulk: every model previewed", (await page.locator("main details").count()) >= 18, await page.locator("main details").count());
check("bulk: per-configuration (Kling 18 configurations)", /Kling 3\.0[\s\S]{0,80}18 configurations/.test(t));
check("bulk: owner-only publish explained", /Publishing prices needs the owner/.test(t) && /Save drafts/.test(t));
await axe("bulk preview");
await overflow("bulk preview 1366");
await page.getByLabel("Markup above KIE cost (%)").fill("0");
await page.getByRole("button", { name: "Preview prices" }).click();
await page.waitForTimeout(2500);
check("bulk: 50 % partner loss warning at +0 %", /lose money when a partner earns 50 %/.test(await text()));
await page.getByLabel("Markup above KIE cost (%)").fill("abc");
check("bulk: invalid markup blocks preview", await page.getByRole("button", { name: "Preview prices" }).isDisabled());

// Packages: impact (read-only).
await tab("Packages");
await settle(500);
t = await text();
check("packages: revenue per credit per package", /\$0\.045/.test(t) && /\$0\.04\b/.test(t) && /\$0\.0345/.test(t));
await page.getByLabel("studio price in USD").fill("50");
check("packages: live revenue per credit", /\$0\.025/.test(await text()));
await page.getByRole("button", { name: "Preview impact of these values" }).click();
await page.waitForSelector("text=Impact on generation prices", { timeout: 15000 });
t = await text();
check("packages: impact shows lower credit value", /lower: every credit earns less/.test(t));
check("packages: no mechanical multiplication by model cost", /never multiplied by a model cost/.test(t));
await axe("packages");

// Provider balance & usage (refresh rewritten to the read-only summary).
await tab("KIE balance");
await page.waitForSelector("text=KIE balance", { timeout: 15000 });
await page.waitForTimeout(1500);
t = await text();
check("provider: honest not-configured state, no fabricated balance", /Not configured/.test(t) && /Unknown/.test(t) && !/\b0 KIE\b(?! customers)/.test(t.split("KIE spend today")[0]));
check("provider: spend, jobs, committed estimate", /KIE spend today/.test(t) && /Jobs now/.test(t) && /Committed to in-flight work \(estimate\)/.test(t));
check("provider: billing link", (await page.getByRole("link", { name: /KIE billing/ }).count()) > 0);
await axe("provider tab");
await tab("Terms & settings");
await settle(300);
check("settings tab", /Partner agreement/.test(await text()) && /Operational settings/.test(await text()));

// Responsive checks.
await tab("Models");
for (const w of [1440, 1024, 768, 390, 360]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  await overflow(`models ${w}`);
}
await page.setViewportSize({ width: 390, height: 900 });
await page.getByRole("button", { name: "Edit pricing" }).first().click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(1200);
await overflow("panel 390");
await axe("panel mobile", "dialog[open]");
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1366, height: 900 });
// Keyboard: tabs are reachable and operable.
await page.getByRole("tab", { name: "Packages" }).focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
check("keyboard: tab activation", /Credit packages/.test(await text()));

check("part A sent no writes to the server", writes.length === 0, writes.join(", "));

// ---------------------------------------------------------------------------------------------- part B

const fx = await ctx.newPage();
fx.on("pageerror", (e) => consoleErrors.push(`${fx.url()} :: pageerror ${e.message}`));
const real = await (await fx.request.get(`${BASE}/api/admin/catalog`)).json();
const cat = structuredClone(real.data);
cat.access.canPublish = true;
cat.runtime.submitsEnabled = true;
const lite = cat.models.find((m) => m.id === "veo-3-1-lite");
lite.readiness.checks = lite.readiness.checks.map((c) => (c.key === "price" ? { ...c, ok: true, fix: null, detail: "Price v2 is published." } : c));
lite.pricing.published = { id: "00000000-0000-4000-8000-000000000001", version: 2, source: "bulk", currentCapability: true };
const fast = cat.models.find((m) => m.id === "veo-3-1");
fast.readiness.checks = fast.readiness.checks.map((c) =>
  c.key === "price" ? { ...c, ok: false, fix: "publish_draft", draftPriceVersionId: "00000000-0000-4000-8000-000000000002", detail: "Draft v3 is ready to publish." } : c,
);
const posted = [];
await fx.route("**/api/admin/catalog", (route) => route.fulfill({ json: { data: cat, requestId: "fixture" } }));
await fx.route("**/api/admin/catalog/models/*/availability", (route) => {
  posted.push(JSON.parse(route.request().postData() ?? "{}"));
  return route.fulfill({ json: { data: { modelId: "x", state: "enabled", enableBasis: "documented_cost", verificationStatus: "untested" } } });
});
await fx.goto(`${BASE}/admin/catalog`);
await fx.waitForSelector("text=Models & pricing");
await fx.waitForTimeout(800);
await fx.getByRole("switch", { name: "Veo 3.1 Lite: available to customers" }).click();
let fd = fx.getByRole("dialog");
await fd.waitFor();
let ft = await fd.innerText();
check("B: untested owner decision shows one explicit warning", /has not passed a private test/.test(ft) && /stays marked “Untested”/.test(ft));
const enableBtn = fd.getByRole("button", { name: "Enable using documented cost" });
check("B: confirm disabled until acknowledged", await enableBtn.isDisabled());
await fd.getByRole("checkbox").check();
await enableBtn.click();
await fx.waitForTimeout(800);
check("B: enable sends acceptUntested, no typed reason", posted[0]?.acceptUntested === true && posted[0]?.state === "enabled" && !posted[0]?.reason, JSON.stringify(posted[0]));
await fx.getByRole("switch", { name: "Veo 3.1 Fast: available to customers" }).click();
fd = fx.getByRole("dialog");
await fd.waitFor();
ft = await fd.innerText();
check("B: publish-draft offered in the same flow", /Price draft v3 will be published first/.test(ft));
await fd.getByRole("checkbox").check();
await fd.getByRole("button", { name: "Publish price and enable" }).click();
await fx.waitForTimeout(800);
check("B: publish+enable request", posted[1]?.publishPriceVersionId === "00000000-0000-4000-8000-000000000002" && posted[1]?.acceptUntested === true, JSON.stringify(posted[1]));

// Bulk publish result and stale preview.
let applyMode = "ok";
await fx.route("**/api/admin/catalog/bulk-pricing/apply", (route) =>
  applyMode === "ok"
    ? route.fulfill({ json: { data: { ref: "PB-QA0001", action: "publish", items: [{ name: "GPT Image 2.5 Flare", version: 7 }] } } })
    : route.fulfill({ status: 409, json: { error: { code: "PREVIEW_STALE", message: "Prices, supplier costs or packages changed since this preview. Review the refreshed preview before applying." } } }),
);
await fx.getByRole("tab", { name: "Bulk pricing" }).click();
await fx.getByRole("button", { name: "Preview prices" }).click();
await fx.waitForSelector("text=Basis of this preview", { timeout: 20000 });
await fx.getByRole("button", { name: "Publish selected changes" }).click();
fd = fx.getByRole("dialog");
await fd.waitFor();
check("B: publish confirmation explains immutability and all-or-nothing", /immutable price version/.test(await fd.innerText()) && /All rows apply together or none do/.test(await fd.innerText()));
await fd.getByRole("button", { name: /^Publish \d+ price/ }).click();
await fx.waitForSelector("text=Batch PB-QA0001", { timeout: 8000 }).catch(() => null);
check("B: batch result shown", /Batch PB-QA0001: published/.test(await fx.locator("main").innerText()));
applyMode = "stale";
await fx.getByRole("button", { name: "Preview prices" }).click();
await fx.waitForSelector("text=Basis of this preview", { timeout: 20000 });
await fx.getByRole("button", { name: "Publish selected changes" }).click();
await fx.getByRole("dialog").getByRole("button", { name: /^Publish \d+ price/ }).click();
await fx.waitForTimeout(800);
const ftx = await fx.locator("main").innerText();
check("B: stale preview refused with refresh action", /Something changed since this preview/.test(ftx) && (await fx.getByRole("button", { name: "Refresh preview" }).count()) === 1);

// Studio: badges, maintenance, single-value tier, audio labels (catalog fixture; nothing submitted).
const studioCat = {
  generationPaused: false,
  tools: [
    { id: "image", label: "Image", enabled: true },
    { id: "edit", label: "Edit image", enabled: true },
    { id: "video", label: "Video", enabled: true },
  ],
  models: [
    { id: "gpt-sunburst-image", tool: "image", name: "GPT Image 2.5 Sunburst", badges: ["recommended", "premium"], purpose: "Quality-optimised.", state: "enabled", note: null, capabilityVersion: 1,
      options: { aspect_ratio: { values: ["1:1", "16:9"], default: "1:1", label: "Aspect ratio" }, resolution: { values: ["1K", "2K"], default: "1K", label: "Resolution" } },
      prompt: { min: 3, max: 4000 }, references: { min: 0, max: 0 }, output: { kind: "image", count: 1 }, fixed: null, priced: true },
    { id: "flux-2-pro-image", tool: "image", name: "FLUX.2 Pro", badges: ["budget"], purpose: "Low cost.", state: "maintenance", note: "Back later today", capabilityVersion: 1,
      options: {}, prompt: { min: 3, max: 4000 }, references: { min: 0, max: 0 }, output: { kind: "image", count: 1 }, fixed: null, priced: true },
    { id: "veo-3-1", tool: "video", name: "Veo 3.1 Fast", badges: ["recommended"], purpose: "Balanced.", state: "enabled", note: null, capabilityVersion: 2,
      options: { variant: { values: ["veo3_fast"], default: "veo3_fast", label: "Tier", labels: { veo3_fast: "Fast" } }, resolution: { values: ["720p", "1080p"], default: "720p", label: "Resolution" } },
      prompt: { min: 3, max: 2000 }, references: { min: 0, max: 0 }, output: { kind: "video", count: 1 }, fixed: null, priced: true },
    { id: "kling-3-0", tool: "video", name: "Kling 3.0", badges: [], purpose: "Single-shot clips.", state: "experimental", note: null, capabilityVersion: 1,
      options: { audio: { values: ["on", "off"], default: "on", label: "Sound", labels: { on: "With audio", off: "No audio" } } },
      prompt: { min: 3, max: 2500 }, references: { min: 0, max: 0 }, output: { kind: "video", count: 1 }, fixed: null, priced: true },
  ],
};
await fx.route("**/api/catalog", (route) => route.fulfill({ json: { data: studioCat, requestId: "fixture" } }));
await fx.goto(`${BASE}/studio/image`);
await fx.waitForSelector("text=GPT Image 2.5 Sunburst", { timeout: 20000 });
await fx.waitForTimeout(600);
let st = await fx.locator("main").innerText();
check("studio: badges on models", /Recommended/.test(st) && /Premium/.test(st));
check("studio: maintenance shown unavailable with note", /Temporarily unavailable/.test(st) && /Back later today/.test(st));
check("studio: no supplier data", !/KIE|supplier|\$0\./.test(st));
await fx.addScriptTag({ content: axeSource });
const sv = await fx.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
check("axe studio image (fixture)", sv.length === 0, sv.join(", "));
await fx.goto(`${BASE}/studio/video`);
await fx.waitForSelector("text=Veo 3.1 Fast", { timeout: 20000 });
await fx.waitForTimeout(600);
st = await fx.locator("main").innerText();
check("studio: single-value tier shown as text", /Tier:\s*Fast/.test(st));
await fx.getByRole("radio", { name: /Kling 3.0/ }).check();
await fx.waitForTimeout(400);
st = await fx.locator("main").innerText();
check("studio: audio option labels", /With audio/.test(st) && /No audio/.test(st));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, results, consoleErrors: consoleErrors.slice(0, 20) }, null, 1));
