// axe-core scan of the changed screens (WCAG 2.1 A/AA rules), mocked account, real local build.
import { readFileSync } from "node:fs";
import { BASE, launch, mockAccount, sleep } from "./mock.mjs";

const AXE = readFileSync(process.env.AXE_PATH ?? "node_modules/axe-core/axe.min.js", "utf8");
const STATES = [
  { name: "image edit", url: "/studio/image?mode=edit" },
  { name: "image generate", url: "/studio/image" },
  { name: "video motion", url: "/studio/video?tab=motion" },
  { name: "motion library", url: "/studio/video?view=library" },
  { name: "motion preview", url: "/studio/video?view=library", open: true },
  { name: "how it works", url: "/studio/video?view=how" },
  { name: "sign-in", url: "/sign-in" },
  { name: "landing", url: "/" },
];

const browser = await launch();
const summary = [];
try {
  for (const s of STATES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await mockAccount(ctx, {});
    const page = await ctx.newPage();
    await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle" });
    if (s.open) {
      await page.getByRole("button", { name: /Preview Pink pyjama dance/ }).click();
      await page.locator("dialog[open]").waitFor();
    }
    await sleep(800);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 2).map((x) => x.target.join(" ")).join(" | ") }));
    });
    summary.push({ state: s.name, violations: res.length, detail: res });
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const s of summary) {
  console.log(`\n${s.state}: ${s.violations} violation types`);
  for (const v of s.detail) console.log(`  [${v.impact}] ${v.id} ×${v.n} — ${v.sample}`);
}
