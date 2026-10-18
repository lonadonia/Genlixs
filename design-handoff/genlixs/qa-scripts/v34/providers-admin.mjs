// Providers & routing admin checks (mocked staff session, real running app). The admin API is answered from fixtures
// produced by the isolated local database (FIXTURES=path to the JSON written by the fixture script); nothing reaches a
// provider, nothing is saved. Checks: four tabs, truthful balances (unknown is never $0), key entry (password field,
// sent once, cleared, only the masked hint shown), comparison drawer, routing review preview/apply, usage and CSV,
// owner-only controls hidden for operations staff, and no horizontal overflow on a phone.
import { mkdirSync, readFileSync } from "node:fs";
import { BASE, launch, mockAccount, overflowX, sleep } from "./mock.mjs";

const OUT = process.env.OUT ?? "out-v34/providers";
mkdirSync(OUT, { recursive: true });
const FX = JSON.parse(readFileSync(process.env.FIXTURES, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
// Optional axe-core scan (AXE_PATH, WCAG 2.1 A/AA) of each tab and the open dialogs.
const AXE = process.env.AXE_PATH ? readFileSync(process.env.AXE_PATH, "utf8") : null;
async function axeScan(page, name) {
  if (!AXE) return;
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  check(`axe: no WCAG A/AA violations on ${name}`, v.length === 0, v.join(" ; "));
}
const STAFF = (caps) => ({ isStaff: true, capabilities: caps });
const OWNER_CAPS = ["admin.access", "provider.read", "provider.manage", "catalog.test", "jobs.read"];
const OPS_CAPS = ["admin.access", "provider.read", "jobs.read"];

async function mockAdmin(ctx, caps, log) {
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data, requestId: "mock" }) });
  const owner = caps.includes("provider.manage");
  await ctx.route("**/api/admin/me", (r) => json(r, { userId: "u", email: "staff@genlixs.test", roles: [owner ? "owner" : "operations"], capabilities: caps }));
  await ctx.route("**/api/admin/providers/overview", (r) => json(r, { ...FX.overview, canManage: owner, runtime: RUNTIME }));
  await ctx.route("**/api/admin/providers/models", (r) => json(r, FX.models));
  await ctx.route("**/api/admin/providers/review", (r) => json(r, FX.review));
  await ctx.route(/\/api\/admin\/providers\/usage\/export/, (r) => json(r, { filename: "genlixs-supplier-costs.csv", rows: 1, csv: "time_utc,job\r\n2026-10-18,J1\r\n" }));
  await ctx.route(/\/api\/admin\/providers\/usage(\?.*)?$/, (r) => {
    log.usageQueries.push(new URL(r.request().url()).search);
    return json(r, FX.usage);
  });
  await ctx.route(/\/api\/admin\/providers\/offers\/[0-9a-f-]+$/, (r) => {
    if (r.request().method() === "POST") {
      log.offerPosts.push(JSON.parse(r.request().postData() ?? "{}"));
      return json(r, FX.offer);
    }
    return json(r, FX.offer);
  });
  await ctx.route(/\/api\/admin\/providers\/jobs\/[0-9a-f-]+\/route$/, (r) => json(r, FX.jobRoute));
  await ctx.route("**/api/admin/providers/preview", (r) => {
    log.previews.push(JSON.parse(r.request().postData() ?? "{}"));
    return json(r, FX.preview);
  });
  await ctx.route("**/api/admin/providers/review/apply", (r) => {
    log.applies.push(JSON.parse(r.request().postData() ?? "{}"));
    return json(r, { applied: true, changed: 0, switchedOff: 0, switchedOn: 0 });
  });
  await ctx.route(/\/api\/admin\/providers\/[0-9a-f-]+\/key$/, (r) => {
    log.keyPosts.push(JSON.parse(r.request().postData() ?? "{}"));
    return json(r, FX.keySaved);
  });
  await ctx.route("**/api/admin/providers/balances/refresh", (r) => json(r, { ...FX.overview, canManage: owner, runtime: RUNTIME, refreshed: [] }));
}
const RUNTIME = {
  paidSubmissionsAllowed: true,
  kieEnvironmentKey: true,
  fakeProvider: false,
  providers: Object.fromEntries(["kie", "duomi", "poyo", "nezhagate", "cuddler", "apimart"].map((p) => [p, { adapters: [`${p}-x`], resultHosts: p === "cuddler" ? [] : [`files.${p}.example`], balance: "api", usage: true }])),
};

const browser = await launch();
try {
  const log = { usageQueries: [], offerPosts: [], previews: [], applies: [], keyPosts: [] };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAccount(ctx, { me: STAFF(OWNER_CAPS) });
  await mockAdmin(ctx, OWNER_CAPS, log);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });

  // Overview
  check("page title and four tabs", (await page.getByRole("heading", { name: "Providers & routing" }).count()) === 1
    && JSON.stringify(await page.getByRole("tablist", { name: "Providers and routing" }).getByRole("tab").allInnerTexts()).includes("Usage"));
  const text = await page.locator("main").innerText();
  check("unknown balances are shown as unknown, never as $0", text.includes("No key saved") && !/\$0\.00 left|0 KIE credits/.test(text));
  check("NezhaGate balance shows value, source and unit", text.includes("$12.50") && text.includes("From provider API"));
  check("confirmed and estimated spending are separate tiles", text.includes("Confirmed today (UTC)") && text.includes("estimated, awaiting confirmation"));
  check("small supplier amounts keep their decimals ($0.005 is not shown as $0.01)", text.includes("$0.005") && !text.includes("$0.01 estimated"));
  check("nav has the new section", (await page.getByRole("link", { name: "Providers & routing" }).count()) >= 1);
  await page.screenshot({ path: `${OUT}/overview-1440.png`, fullPage: true });
  await axeScan(page, "Overview");

  // Providers + key entry
  await page.getByRole("tab", { name: /Providers/ }).click();
  check("six provider cards", (await page.getByRole("button", { name: /Add key|Replace key/ }).count()) === 6);
  await page.getByRole("button", { name: "Replace key" }).first().click();
  const keyField = page.locator("dialog[open] input[name^=provider-key-]");
  check("key field is a password field without autocomplete", (await keyField.getAttribute("type")) === "password" && (await keyField.getAttribute("autocomplete")) === "off");
  await axeScan(page, "the key dialog");
  await keyField.fill("nz-SECRET-typed-key-9999");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByText("Saved as version 1").waitFor({ timeout: 5000 });
  const dialogText = await page.locator("dialog[open]").innerText();
  check("key sent once in the body", log.keyPosts.length === 1 && log.keyPosts[0].key === "nz-SECRET-typed-key-9999");
  check("after saving only the masked hint is shown and the field is empty", !dialogText.includes("SECRET") && dialogText.includes("••••AB12") && (await keyField.inputValue()) === "");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${OUT}/providers-1440.png`, fullPage: true });
  await axeScan(page, "Providers");

  // Models + comparison
  await page.getByRole("tab", { name: "Models" }).click();
  await page.getByRole("button", { name: "Compare" }).first().waitFor();
  const rows = await page.locator("table tbody tr").count();
  check("image models listed with their route", rows >= 5, `${rows} rows`);
  await page.getByRole("button", { name: "Compare" }).first().click();
  await page.getByRole("button", { name: "Compare for these settings" }).click();
  await page.getByText("Whole-request cost (funded)").waitFor({ timeout: 5000 });
  const cmp = await page.locator("dialog[open]").innerText();
  check("comparison shows the chosen supplier and the exclusions", cmp.includes("Chosen") && cmp.includes("No integration for this offer in this release"));
  check("saving against KIE only for an equivalent verified baseline", cmp.includes("against the verified KIE price"));
  check("preview request carries exact settings", log.previews.length === 1 && typeof log.previews[0].options === "object" && "resolution" in log.previews[0].options);
  await page.screenshot({ path: `${OUT}/compare-1440.png` });
  await axeScan(page, "the comparison drawer");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Review routing" }).click();
  await page.getByRole("button", { name: /Apply/ }).waitFor();
  await page.getByRole("button", { name: "Everything" }).click();
  check("review lists decisions with reasons", (await page.locator("dialog[open] table tbody tr").count()) > 10);
  await page.getByRole("button", { name: /Apply/ }).click();
  await sleep(500);
  check("apply sends the preview revision", log.applies.length === 1 && log.applies[0].revision === FX.review.revision);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: /Review inventory/ }).click();
  const inv = await page.locator("main").innerText();
  check("inventory shows unmapped products with decisions and blockers", inv.includes("PixVerse V6") && inv.includes("Dominated") && inv.includes("Unresolved"));
  await axeScan(page, "Models (inventory)");
  await page.getByRole("button", { name: "PoYo" }).first().click();
  await page.locator("dialog[open]").getByRole("tab", { name: /Price/ }).click();
  await page.locator("dialog[open]").getByText("New price version").waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/offer-price-1440.png` });
  await axeScan(page, "the offer drawer (price editor)");
  await page.keyboard.press("Escape");

  // Usage
  await page.getByRole("tab", { name: "Usage" }).click();
  await page.getByText("Jobs and attempts").waitFor();
  const usage = await page.locator("main").innerText();
  check("usage separates confirmed, estimated, pending and unknown", ["Confirmed", "Estimated, awaiting confirmation", "Pending", "Without a known cost"].every((s) => usage.includes(s)));
  const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: "Export CSV" }).click();
  check("CSV export downloads a file", Boolean(await dl));
  await page.locator("table tbody tr button").first().click();
  await page.getByText("Why this supplier").waitFor({ timeout: 5000 });
  check("job drawer explains the route", (await page.locator("dialog[open]").innerText()).includes("Cheapest eligible offer"));
  await page.keyboard.press("Escape");
  await axeScan(page, "Usage");
  check("no page errors (owner)", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // Operations staff: read only
  const log2 = { usageQueries: [], offerPosts: [], previews: [], applies: [], keyPosts: [] };
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAccount(ctx2, { me: STAFF(OPS_CAPS) });
  await mockAdmin(ctx2, OPS_CAPS, log2);
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
  await p2.getByRole("tab", { name: /Providers/ }).click();
  check("operations staff see no key or switch controls", (await p2.getByRole("button", { name: /Add key|Replace key|Test connection/ }).count()) === 0
    && (await p2.getByRole("switch").first().isDisabled()));
  await ctx2.close();

  // Phone
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mockAccount(ctx3, { me: STAFF(OWNER_CAPS) });
  await mockAdmin(ctx3, OWNER_CAPS, { usageQueries: [], offerPosts: [], previews: [], applies: [], keyPosts: [] });
  const p3 = await ctx3.newPage();
  await p3.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
  const READY = { Overview: "Balances", Providers: "Funding terms", Models: "Review routing", Usage: "Jobs and attempts" };
  for (const t of ["Overview", "Providers", "Models", "Usage"]) {
    await p3.getByRole("tab", { name: new RegExp(`^${t}`) }).click();
    await p3.getByText(READY[t]).first().waitFor({ timeout: 8000 });
    await sleep(300);
    check(`phone: no horizontal overflow on ${t}`, (await overflowX(p3)) === 0, `${await overflowX(p3)} px`);
    await p3.screenshot({ path: `${OUT}/${t.toLowerCase()}-390.png`, fullPage: true });
  }
  await ctx3.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
