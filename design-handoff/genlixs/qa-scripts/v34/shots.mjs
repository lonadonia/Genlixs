// Screenshots of the affected pages at 1440, 1024, 768, 390, 360 and a short desktop (1440×700), with overflow,
// panel-scroll and focus-colour checks. Mocked account; real local build and catalog.
import { mkdirSync } from "node:fs";
import { BASE, launch, mockAccount, overflowX, sleep } from "./mock.mjs";

const OUT = process.env.OUT ?? "out-v34/shots";
mkdirSync(OUT, { recursive: true });
const VIEWS = (process.env.VIEWS ?? "1440x900,1024x768,768x1024,390x844,360x740,1440x700").split(",");
const PAGES = (process.env.PAGES ?? "/studio/image,/studio/image?mode=edit,/studio/video,/studio/video?tab=motion,/studio/video?view=library,/studio/video?view=how,/sign-in,/#reel").split(",");
const slug = (p) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/[/?=&#]+/g, "-"));
const rows = [];

const browser = await launch();
try {
  for (const v of VIEWS) {
    const [w, h] = v.split("x").map(Number);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800, deviceScaleFactor: 1 });
    await mockAccount(ctx, {});
    for (const p of PAGES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      if (p.includes("#reel")) await page.locator("#reel").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight && i.getBoundingClientRect().bottom > 0).every((i) => i.complete), null, { timeout: 8000 }).catch(() => {});
      await sleep(600);
      const ov = await overflowX(page);
      const panel = await page.evaluate(() => {
        const s = document.querySelector("section.panel-scroll");
        if (!s) return null;
        const cs = getComputedStyle(s);
        return { scrollbar: cs.scrollbarWidth, scrolls: s.scrollHeight > s.clientHeight + 1, overflowY: cs.overflowY };
      });
      await page.screenshot({ path: `${OUT}/${v}-${slug(p)}.png` });
      rows.push({ view: v, page: p, overflowX: ov, panel: panel ? `${panel.scrollbar}/${panel.overflowY}${panel.scrolls ? "/scrolls" : ""}` : "-", errors: errors.length });
      await page.close();
    }
    await ctx.close();
  }

} finally {
  await browser.close();
}
console.table(rows);
const bad = rows.filter((r) => r.overflowX > 0 || r.errors > 0);
console.log(bad.length ? `PROBLEMS: ${bad.length}` : "no overflow, no page errors");
