// v3.6 — one focused check of the two-page admin flow against a running app (mocked API; see mock.mjs): retired URLs
// redirect, exactly two catalog pages in the navigation, the pricing panel (defaults, server preview, Save & apply), the
// model table (prices, serving supplier and cost, effective markup, KIE reference needed), type filters and search, the
// model drawer (KIE reference → target → credits, serving supplier apart from cheaper offers), packages collapsed, Add
// models, Providers & balances (one row per provider, drawer, details on demand, ?routing=), 390 px overflow, roles,
// axe-core WCAG 2.1 AA when AXE_PATH is set, and no generation, upload or paid-test request.
// Env: FIXTURES, PLAYWRIGHT_PATH, CHROME_PATH, AXE_PATH, BASE, OUT.
import { mkdirSync, readFileSync } from "node:fs";
import { BASE, launch, mockContext } from "./mock.mjs";

const out = process.env.OUT ?? "out-v36/two-page-admin";
mkdirSync(out, { recursive: true });
const AXE = process.env.AXE_PATH ? readFileSync(process.env.AXE_PATH, "utf8") : null;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};
const browser = await launch();
const shot = (page, name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const overflow = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const axe = async (page, name) => {
  if (!AXE) return;
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  check(`axe WCAG 2.1 AA: ${name}`, v.length === 0, v.join("; "));
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");

try {
  // ------------------------------------------------------------------ redirects (server, no browser)
  for (const [from, to] of [
    ["/admin/pricing", "/admin/catalog"],
    ["/admin/pricing?tab=packages", "/admin/catalog?tab=packages"],
    ["/admin/balances", "/admin/providers"],
    ["/admin/kie", "/admin/providers"],
  ]) {
    const r = await fetch(BASE + from, { redirect: "manual" });
    const loc = r.headers.get("location") ?? "";
    check(`redirect ${from} → ${to}`, r.status === 307 && loc.endsWith(to), `${r.status} ${loc}`);
  }

  // ------------------------------------------------------------------ owner, desktop: Models & pricing
  const { ctx, log } = await mockContext(browser, { role: "owner" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/admin/catalog`, { waitUntil: "networkidle" });
  await settle(page);

  const nav = await text(page.locator("nav").first());
  check("nav: exactly the two catalog pages", nav.includes("Models & pricing") && nav.includes("Providers & balances") && !/Pricing & packages|Supplier balances|Providers & routing/.test(nav), nav);
  check("page: title Models & pricing", (await page.locator("h1").innerText()).trim() === "Models & pricing");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Pricing", exact: true }) });
  check("panel: helper sentence", (await text(panel)).includes("Selling prices follow KIE × your markup. Cheaper suppliers increase your profit."));
  const markup = panel.getByLabel("Markup on KIE cost (%)");
  const credit = panel.getByLabel("USD value of one Genlixs credit");
  check("panel: markup starts at 100 and the credit value at the current setting ($0.02)", (await markup.inputValue()) === "100" && (await credit.inputValue()) === "0.02");
  const apply = panel.getByRole("button", { name: "Save & apply" });
  check("panel: Save & apply disabled until a value changes", await apply.isDisabled());
  const rows = await page.locator("table tbody tr").count();
  check("table: one row per model (21)", rows === 21, `${rows}`);
  const flare = await text(page.locator("tr", { hasText: "GPT Image 2.5 Flare" }).first());
  check("table: Flare 3 cr · $0.06 · KIE $0.03 · +100 %", /3 cr\s*\$0\.06/.test(flare) && /KIE\s*\$0\.03/.test(flare) && flare.includes("+100 %"), flare);
  const nbp = await text(page.locator("tr", { hasText: "Nano Banana Pro" }).first());
  check("table: a cheaper supplier serving keeps 9 cr and raises the effective markup (+800 %)", /9 cr\s*\$0\.18/.test(nbp) && /NezhaGate\s*\$0\.02/.test(nbp) && nbp.includes("+800 %"), nbp);
  const flux = await text(page.locator("tr", { hasText: "FLUX.2 Pro" }).first());
  check("table: whole-credit rounding shows its effective markup (+140 %)", flux.includes("+140 %"), flux);
  const wan = await text(page.locator("tr", { hasText: "Wan 2.6" }).first());
  check("table: a model without a KIE rate says KIE reference needed", wan.includes("KIE reference needed"), wan);
  check("notice: KIE reference needed banner names the model", (await page.getByText(/KIE reference needed for 1 model/).count()) === 1);
  check("table: no per-model price editor on the page", (await page.getByRole("button", { name: /Edit price|Set price|Apply a markup/ }).count()) === 0);
  await shot(page, "01-models-pricing-1440");
  await axe(page, "Models & pricing");

  // type filters and search
  await page.getByRole("group", { name: "Model type" }).getByRole("button", { name: /Video editing/ }).click();
  await settle(page, 300);
  check("filter: Video editing shows 3 models", (await page.locator("table tbody tr").count()) === 3);
  await page.getByRole("group", { name: "Model type" }).getByRole("button", { name: /^All/ }).click();
  await page.getByPlaceholder("Search models").fill("seedream");
  await settle(page, 300);
  check("search: seedream finds 2 models", (await page.locator("table tbody tr").count()) === 2);
  await page.getByPlaceholder("Search models").fill("");

  // drawer: KIE reference, target, charge, serving cost, effective markup; cheaper offers apart from the serving one
  await page.getByRole("button", { name: "Nano Banana Pro", exact: true }).click();
  await settle(page, 600);
  check("drawer: deep link ?model=", page.url().includes("model=nano-banana-pro-image"));
  const dlg = page.getByRole("dialog");
  const d = await text(dlg);
  check("drawer: KIE reference $0.09 → target $0.18 at +100 % → 9 cr $0.18", /KIE reference \(B\).*\$0\.09/.test(d) && /Target at \+100 %.*\$0\.18/.test(d) && /Customer pays.*9 cr · \$0\.18/.test(d), d.slice(0, 600));
  check("drawer: serving cost NezhaGate $0.02, effective markup +800 %, saving kept by Genlixs", /Serving cost \(C\) · NezhaGate.*\$0\.02/.test(d) && d.includes("+800 %") && d.includes("kept by Genlixs"), d.slice(0, 900));
  check("drawer: serving supplier and cheaper offers are separate sections", /serving customers now/i.test(d) && /cheaper offers, not serving yet/i.test(d), d.slice(0, 1200));
  await shot(page, "02-drawer-nezhagate", false);
  await axe(page, "model drawer");
  await page.keyboard.press("Escape");
  await settle(page, 300);
  await page.getByRole("button", { name: "Wan 2.6", exact: true }).click();
  await settle(page, 500);
  check("drawer: KIE reference needed explained, no other supplier price used", (await text(page.getByRole("dialog"))).includes("Another supplier's price is never used instead"));
  await page.keyboard.press("Escape");
  await settle(page, 300);

  // packages (collapsed) and Add models (drawer)
  const pk = page.getByRole("button", { name: /Packages/ });
  check("packages: collapsed by default", (await pk.getAttribute("aria-expanded")) === "false");
  await pk.click();
  await settle(page, 300);
  check("packages: expands to the package editor", (await page.getByRole("button", { name: "Save package" }).count()) > 0);
  await pk.click();
  await page.getByRole("button", { name: "Add models" }).click();
  await settle(page, 500);
  check("Add models: supplier inventory in a drawer", (await text(page.getByRole("dialog"))).includes("One line per product"));
  await page.keyboard.press("Escape");
  await settle(page, 300);

  // Save & apply: preview from the server, then apply (both answered by fixtures)
  await markup.fill("150");
  await settle(page, 1200);
  const pv = await text(panel);
  check("preview: affected-model count and representative changes", /20 models change price/.test(pv) && pv.includes("1 need a KIE reference") && /GPT Image 2\.5 Flare.*3 cr.*4 cr/.test(pv), pv);
  check("panel: Save & apply enabled after a change", await apply.isEnabled());
  await shot(page, "03-preview", false);
  await apply.click();
  await settle(page, 1500);
  const after = await text(panel);
  check("apply: saved as policy v2, re-priced models reported", /Saved as pricing policy v2\. 20 models re-priced/.test(after), after);
  check("apply: panel now shows the saved markup", (await panel.getByLabel("Markup on KIE cost (%)").inputValue()) === "150");
  const flareAfter = await text(page.locator("tr", { hasText: "GPT Image 2.5 Flare" }).first());
  check("apply: table shows the new prices (Flare 4 cr, +166.67 % on KIE)", /4 cr\s*\$0\.08/.test(flareAfter) && flareAfter.includes("+166.7 %"), flareAfter);
  check("apply: one preview and one apply request, expected policy id sent", log.posts.filter((x) => x.startsWith("apply")).length === 1 && log.posts.some((x) => x.startsWith("preview 150 0.02")));
  await shot(page, "04-after-apply");

  // narrow screen
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 600);
  check("390 px: no horizontal page scroll on Models & pricing", (await overflow(page)) === 0, `${await overflow(page)} px`);
  await shot(page, "05-models-pricing-390");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ------------------------------------------------------------------ owner: Providers & balances
  await page.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
  await settle(page, 1500);
  check("page: title Providers & balances", (await page.locator("h1").innerText()).trim() === "Providers & balances");
  const list = page.locator("ul", { has: page.getByRole("button", { name: /details$/ }) }).first();
  const provRows = await list.locator(":scope > li").count();
  check("providers: one compact row per provider (6)", provRows === 6, `${provRows}`);
  const kieRow = await text(list.locator(":scope > li", { hasText: "KIE" }).first());
  check("providers: KIE row shows status, balance with unit and source, today and month, switch, refresh, key", /Serving \d+ model/.test(kieRow) && /KIE credits/.test(kieRow) && /Provider API|Manual entry|No reading/.test(kieRow) && kieRow.includes("Today") && kieRow.includes("This month") && kieRow.includes("Refresh") && /Replace key|Add key/.test(kieRow), kieRow);
  check("providers: switches for enable/disable", (await page.getByRole("switch", { name: /available for new jobs/ }).count()) === 6);
  check("providers: no Overview/Usage/Models tabs on the page", (await page.getByRole("tab").count()) === 0);
  await shot(page, "06-providers-1440");
  await axe(page, "Providers & balances");

  await page.getByRole("button", { name: "KIE details" }).click();
  await settle(page, 600);
  const pd = page.getByRole("dialog");
  let tabs = 0;
  for (const t of ["Status", "Funding & limits", "Spending", "KIE activity"]) tabs += await pd.getByRole("tab", { name: t, exact: true }).count();
  check("provider drawer: status, funding & limits, spending and KIE activity on demand", tabs === 4, `${tabs}`);
  await pd.getByRole("tab", { name: "Funding & limits" }).click();
  await settle(page, 300);
  check("provider drawer: funding fee and bonus fields", (await pd.getByLabel(/Funding fee/).count()) === 1 && (await pd.getByLabel(/Credit bonus/).count()) === 1);
  await pd.getByRole("tab", { name: "KIE activity" }).click();
  await settle(page, 400);
  check("provider drawer: KIE spend by model and reliability", (await text(pd)).includes("KIE spend by model"));
  await shot(page, "07-provider-drawer", false);
  await axe(page, "provider drawer");
  await page.keyboard.press("Escape");
  await settle(page, 300);

  for (const [label, expect] of [
    ["Spending by job", "Confirmed"],
    ["Generation pipeline", "Background workers"],
    ["Routing & offers", "Review routing"],
  ]) {
    await page.getByRole("button", { name: label }).click();
    await settle(page, 900);
    const body = await text(page.locator("main"));
    check(`details on demand: ${label}`, body.includes(expect), body.slice(-300));
  }
  await page.getByRole("button", { name: "Routing & offers" }).click();

  await page.goto(`${BASE}/admin/providers?routing=gpt-flare-image`, { waitUntil: "networkidle" });
  await settle(page, 1500);
  check("model drawer link: ?routing= opens routing for that model", (await page.getByRole("button", { name: "Routing & offers" }).getAttribute("aria-expanded")) === "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
  await settle(page, 1200);
  check("390 px: no horizontal page scroll on Providers & balances", (await overflow(page)) === 0, `${await overflow(page)} px`);
  await shot(page, "08-providers-390");

  await page.goto(`${BASE}/admin/pricing?tab=packages`, { waitUntil: "networkidle" });
  await settle(page, 1200);
  check("redirected packages link opens the packages section", page.url().endsWith("/admin/catalog?tab=packages") && (await page.getByRole("button", { name: /Packages/ }).getAttribute("aria-expanded")) === "true");

  check("no page errors", errors.length === 0, errors.join(" | "));
  check("no generation, upload or paid-test request was made", log.generation.length === 0, log.generation.join(", "));
  console.log("posts:", log.posts.join(" | "));
  console.log("refused:", [...new Set(log.refused)].join(" | ") || "none");
  await ctx.close();

  // ------------------------------------------------------------------ roles
  {
    const { ctx: c2 } = await mockContext(browser, { role: "finance" });
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/admin/catalog`, { waitUntil: "networkidle" });
    await settle(p2);
    check("finance: can preview, cannot apply", (await p2.getByRole("button", { name: "Save & apply" }).count()) === 0 && (await p2.getByText("only the owner can apply it").count()) === 1);
    await c2.close();
  }
  {
    const { ctx: c3 } = await mockContext(browser, { role: "support" });
    const p3 = await c3.newPage();
    await p3.goto(`${BASE}/admin/catalog`, { waitUntil: "networkidle" });
    await settle(p3);
    check("support: sees models without costs or the pricing panel", (await p3.locator("table tbody tr").count()) === 21 && (await p3.getByLabel("Markup on KIE cost (%)").count()) === 0);
    await p3.goto(`${BASE}/admin/providers`, { waitUntil: "networkidle" });
    await settle(p3);
    check("support: providers page says the role cannot see providers", (await p3.getByText("Your role cannot see providers, balances or spending.").count()) === 1);
    await c3.close();
  }
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
