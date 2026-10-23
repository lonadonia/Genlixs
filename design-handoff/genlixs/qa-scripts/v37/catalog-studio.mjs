// v3.7 browser check of the full catalog on a running app (also safe against the live site): a signed-in studio without a
// real account (v34/mock.mjs answers the account, quote, upload and generation endpoints locally), the public catalog
// from the app itself. Nothing reaches a provider; a generation request is answered "blocked" and fails the run.
// Env: PLAYWRIGHT_PATH, CHROME_PATH, BASE, SHOTS (folder for screenshots, optional).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, launch, liveCatalog, mockAccount, overflowX, sleep } from "../v34/mock.mjs";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- the public catalog
const cat = await liveCatalog();
const by = (t) => cat.models.filter((m) => m.tool === t);
check(`the catalog lists 118 models (${cat.models.length})`, cat.models.length === 118);
check(`33 image, 32 edit, 53 video (${by("image").length}/${by("edit").length}/${by("video").length})`, by("image").length === 33 && by("edit").length === 32 && by("video").length === 53);
check("every model is priced", cat.models.every((m) => m.priced && m.priceRules));
const hailuo = cat.models.find((m) => m.id === "hailuo-2-3-standard");
check("excluded combinations are published (Hailuo 2.3: 1080p 10 s)", JSON.stringify(hailuo?.exclude) === JSON.stringify([{ duration: 10, resolution: "1080P" }]) && !!hailuo?.excludeMessage);
check("the avatar workflow is published (Kling AI Avatar, OmniHuman)", cat.models.filter((m) => m.operation === "avatar").length === 3);
check("Wan 2.6 offers text, start frame and reference videos", (cat.models.find((m) => m.id === "wan-2-6")?.modes ?? []).map((x) => x.id).join(",") === "text,image,video");

const browser = await launch();
for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const log = await mockAccount(ctx);
  const errors = [];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // ------------------------------------------------------------ video studio
  await page.goto(`${BASE}/studio/video`, { waitUntil: "networkidle" });
  const tabs = await page.getByRole("tablist", { name: "Video mode" }).getByRole("tab").allInnerTexts();
  check(`[${label}] video studio has Create, Edit, Motion Control and Avatar (${tabs.join(" / ")})`, ["Create Video", "Edit Video", "Motion Control", "Avatar"].every((t) => tabs.some((x) => x.includes(t))));
  const picker = page.locator('button[aria-haspopup="dialog"]', { hasText: /available/ }).first();
  const count = Number((await picker.innerText()).match(/(\d+) available/)?.[1] ?? 0);
  const creates = cat.models.filter((m) => m.tool === "video" && m.operation === "create").length;
  check(`[${label}] the create picker offers every video-creation model (${count} of ${creates})`, count === creates);
  await picker.click();
  const dialog = page.getByRole("dialog", { name: /Choose a/ });
  await dialog.waitFor();
  const options = await dialog.getByRole("option").count();
  check(`[${label}] the picker lists them, grouped by maker (${options} options)`, options === count && (await dialog.getByText("ByteDance").count()) > 0 && (await dialog.getByText("Kuaishou (Kling)").count()) > 0);
  await dialog.getByRole("searchbox", { name: "Search models" }).or(dialog.getByLabel("Search models")).first().fill("hailuo 2.3");
  check(`[${label}] search narrows the list`, (await dialog.getByRole("option").count()) === 2);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label}-video-picker.png`) });
  await page.keyboard.press("Escape");
  check(`[${label}] video studio: no horizontal overflow`, (await overflowX(page)) === 0);

  await page.getByRole("tablist", { name: "Video mode" }).getByRole("tab", { name: /Avatar/ }).click();
  await sleep(400);
  const avatarPicker = Number((await page.locator('button[aria-haspopup="dialog"]', { hasText: /available/ }).first().innerText()).match(/(\d+) available/)?.[1] ?? 1);
  check(`[${label}] the Avatar tab offers the three avatar models (${avatarPicker})`, avatarPicker === 3);
  check(`[${label}] the Avatar tab asks for a portrait and speech audio`, (await page.getByText("Portrait").count()) > 0 && (await page.getByText("Speech audio").count()) > 0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label}-avatar.png`), fullPage: false });

  // ------------------------------------------------------------ image studio
  await page.goto(`${BASE}/studio/image`, { waitUntil: "networkidle" });
  const imgCount = Number((await page.locator('button[aria-haspopup="dialog"]', { hasText: /available/ }).first().innerText()).match(/(\d+) available/)?.[1] ?? 0);
  check(`[${label}] the image picker offers the image models (${imgCount})`, imgCount >= 30);
  await page.goto(`${BASE}/studio/image?mode=edit`, { waitUntil: "networkidle" });
  const editPicker = page.locator('button[aria-haspopup="dialog"]', { hasText: /available/ }).first();
  await editPicker.click();
  const ed = page.getByRole("dialog", { name: /Choose a/ });
  await ed.waitFor();
  check(`[${label}] the edit picker lists the edit tools`, (await ed.getByRole("option").count()) >= 30);
  await ed.getByLabel("Search models").fill("remove background");
  await ed.getByRole("option").first().click();
  await sleep(300);
  check(`[${label}] a prompt-free tool hides the prompt`, (await page.locator("textarea").count()) === 0);
  check(`[${label}] image studio: no horizontal overflow`, (await overflowX(page)) === 0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label}-edit-tool.png`) });

  check(`[${label}] no generation was requested (${log.generations.length})`, log.generations.length === 0);
  check(`[${label}] no page errors (${errors.slice(0, 2).join(" | ")})`, errors.length === 0);
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
