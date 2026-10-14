// Live-mode browser checks with a temporary QA account (no provider/billing keys configured).
// Usage: QA_EMAIL=… QA_PASSWORD=… PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=…/axe.min.js node live-flows.mjs
// The admin checks expect the account to hold the `operations` staff role.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright-core");
const axeSource = readFileSync(process.env.AXE_PATH ?? require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = "http://localhost:3200";
// A temporary confirmed QA account (create it, run, then delete it and its rows — see docs/VERIFICATION.md).
const qa = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!qa.email || !qa.password) throw new Error("set QA_EMAIL and QA_PASSWORD");

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()} :: ${m.text()}`));
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: pageerror ${e.message}`));
const results = [];
const check = (name, ok, info = "") => results.push({ name, ok: Boolean(ok), info });
const text = async () => (await page.locator("main").innerText().catch(() => "")) || "";
const settle = async (ms = 1500) => {
  // Wait until loading skeletons are gone and the page has its heading, then a short idle.
  await page.waitForFunction(() => !document.querySelector("[aria-busy=true]") && document.querySelector("main h1"), null, { timeout: 25000 }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.waitForTimeout(Math.min(ms, 800));
};
const axe = async (name) => {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
  check(`axe ${name}`, r.length === 0, r.join(", "));
};

// 1. sign in through the real form
await page.goto(`${BASE}/sign-in?next=/studio`);
await page.fill("#email", qa.email);
await page.fill("#password", "wrong-password-xyz");
await page.click("button[type=submit]");
const wrong = await page.waitForSelector("text=The email or password is not correct.", { timeout: 15000 }).catch(() => null);
check("wrong password shows generic error", Boolean(wrong));
await page.fill("#password", qa.password);
await page.click("button[type=submit]");
await page.waitForURL(`${BASE}/studio`, { timeout: 20000 });
await settle(2500);
let t = await text();
check("studio overview after sign-in", /Available credits/.test(t) && /Not available yet/.test(t), t.slice(0, 200));
check("no preview pill in live studio", !(await page.content()).includes("Design preview"));
await axe("studio overview");

// 2. tools are honestly unavailable (models disabled, prices draft)
await page.goto(`${BASE}/studio/image`);
await settle(2500);
t = await text();
check("image studio unavailable state", /not available yet/i.test(t), t.slice(0, 160));
await axe("studio image unavailable");

// 3. credits / billing / library
await page.goto(`${BASE}/studio/credits`);
await settle(2500);
t = await text();
check("credits: no packs on sale, zero balance", /not on sale yet/i.test(t) && /No credits yet/i.test(t), t.slice(0, 200));
await axe("studio credits");
await page.goto(`${BASE}/studio/billing`);
await settle(2500);
t = await text();
check("billing: payments not available", /Payments are not available yet/i.test(t), t.slice(0, 200));
await page.goto(`${BASE}/studio/library`);
await settle(2500);
check("library empty", /Nothing here yet/i.test(await text()));
await axe("studio library");

// 4. support request round-trip (persisted in the database)
await page.goto(`${BASE}/studio/support`);
await settle(2000);
await page.getByLabel("Subject").fill("QA check — please ignore");
await page.getByLabel("Message").fill("Automated QA request created and deleted by the implementation run.");
await page.getByRole("button", { name: "Send request" }).click();
await page.waitForSelector("text=QA check — please ignore", { timeout: 15000 });
check("support ticket persisted and listed", true);
await axe("studio support");

// 5. partner application
await page.goto(`${BASE}/partner`);
await settle(2500);
const already = /Application under review/.test(await text());
check("partner portal: not a partner yet (or already applied)", already || /Join the partner program/.test(await text()));
await page.goto(`${BASE}/partners/apply`);
await settle(2500);
if (!already) {
await page.getByLabel("Name or brand").fill("QA Partner");
await page.getByLabel("Country").fill("Morocco");
await page.getByLabel("Main channel link").fill("https://example.com/qa-channel");
await page.getByLabel(/accept the partner program terms/i).check();
await page.getByRole("button", { name: "Submit application" }).click();
}
await page.waitForSelector("text=Application under review", { timeout: 15000 }).catch(() => null);
t = await (await page.locator("main")).innerText();
check("partner application recorded", /Application under review/.test(t), t.slice(0, 300));
await page.goto(`${BASE}/partner`);
await settle(2500);
check("partner portal reflects application", /Application under review/.test(await text()));
await axe("partner overview");

// 6. admin console with the temporary operations role
await page.goto(`${BASE}/admin`);
await settle(3000);
t = await text();
check("admin overview loads real counts", /Operations overview/.test(t) && /Jobs \(24 h\)/.test(t), t.slice(0, 200));
await axe("admin overview");
await page.goto(`${BASE}/admin/jobs`);
check("admin jobs empty", Boolean(await page.waitForSelector("text=No jobs match.", { timeout: 15000 }).catch(() => null)));
await page.goto(`${BASE}/admin/catalog`);
await settle(2500);
t = await text();
check("admin models list shows every model switched off", /\b0 of \d+ on\b/.test(t) && /\bOff\b/.test(t), t.slice(0, 200));
await axe("admin catalog");
await page.goto(`${BASE}/admin/affiliates`);
await settle(2500);
t = await text();
if (/QA Partner|qa-/.test(t) && (await page.getByRole("button", { name: "Approve" }).count())) {
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByLabel(/Reason/).fill("QA: expect refusal without a published agreement");
  await page.getByRole("button", { name: /Confirm approve/i }).click();
  await settle(2500);
  const err = await page.locator("form .text-error-text").first().innerText().catch(() => "");
  check("approval refused (agreement unpublished or role lacks capability)", /agreement|not allowed|role/i.test(err), err);
} else {
  check("admin affiliates lists the application or denies access", /not allowed|role|Partners/i.test(t), t.slice(0, 200));
}
await page.goto(`${BASE}/admin/staff`);
await settle(2500);
t = await text();
check("staff page denies operations role", /not allowed|role/i.test(t), t.slice(0, 200));

// 7. sign out
await page.goto(`${BASE}/studio`);
await settle(2000);
await page.locator("summary").filter({ hasText: "Account menu" }).click();
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 15000 });
const me = await page.evaluate(async () => (await fetch("/api/me")).status);
check("signed out: /api/me is 401", me === 401);

// 8. mobile overflow on key live pages (signed out views)
await page.setViewportSize({ width: 375, height: 800 });
for (const p of ["/", "/sign-in", "/studio", "/partners/apply", "/admin"]) {
  await page.goto(BASE + p);
  await settle(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`no horizontal overflow ${p} @375`, overflow <= 1, String(overflow));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.info ? `  :: ${r.info}` : ""}`);
const relevant = consoleErrors.filter((e) => !/401|Unauthorized|favicon/i.test(e));
console.log(`\nconsole errors (excluding expected 401s): ${relevant.length}`);
for (const e of relevant.slice(0, 15)) console.log("  " + e);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
