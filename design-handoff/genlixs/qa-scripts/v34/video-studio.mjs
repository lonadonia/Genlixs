// Video studio verification (mocked account, real local build and real catalog): canvas views, the walkthrough
// carousel, the Motion Control banner, the Motion Library preview and the Recreate handoff — the library clip's own
// bytes uploaded as the motion video, the quote, duplicate-submission and failure handling, and the job in History.
// No provider call, no real upload, no charge.
import { mkdirSync } from "node:fs";
import { BASE, fixtures, launch, mockAccount, overflowX, sleep } from "./mock.mjs";

const OUT = process.env.OUT ?? "out-v34/video";
const FX = fixtures();
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const now = () => new Date().toISOString();
const job = (id, state) => ({
  id, ref: "J-TEST1", tool: "video", modelId: "kling-3-0-motion", modelName: "Kling 3.0 Motion Control", title: "in a neon-lit studio",
  prompt: "in a neon-lit studio", options: { mode: "720p", orientation: "video" }, units: "15", state, settlementState: "reserved",
  failureCode: null, failureMessage: null, delayedAfterAt: now(), customerDeadlineAt: now(), createdAt: now(), completedAt: null,
  favorite: false, outputs: [], events: [{ event: "queued", message: "Waiting in queue. 15 credits reserved.", at: now() }], operation: "motion", mode: "motion",
});

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const JOB = "44444444-4444-4444-8444-000000000001";
  let created = false;
  const log = await mockAccount(ctx, {
    generationDelayMs: 900,
    generationResponse: (n) =>
      n === 1 ? { status: 400, code: "BLOCKED", message: "Blocked in the preview harness." }
      : n === 2 ? { abort: true }
      : ((created = true), { status: 201, data: { job: job(JOB, "queued"), replayed: false } }),
  });
  await ctx.route(`**/api/generations/${JOB}`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: job(JOB, "queued") }) }));
  await ctx.route(/\/api\/generations\?tool=video/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: created ? [job(JOB, "queued")] : [] }) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/studio/video`, { waitUntil: "networkidle" });

  // ------------------------------------------------------------ canvas views
  check("the studio opens on How it works", (await page.getByRole("tab", { name: "How it works" }).getAttribute("aria-selected")) === "true" && (await page.locator("#canvas-panel-how video").count()) === 1);
  const tabs = await page.getByRole("tablist", { name: "Studio views" }).getByRole("tab").allInnerTexts();
  check("History, Motion Library and How it works sit together", JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(["History", "Motion Library", "How it works"]), JSON.stringify(tabs));
  await page.getByRole("tab", { name: "History" }).focus();
  await page.keyboard.press("ArrowRight");
  check("arrow keys move between the views", (await page.getByRole("tab", { name: "Motion Library" }).getAttribute("aria-selected")) === "true" && new URL(page.url()).searchParams.get("view") === "library");
  check("the library shows posters only (no players on load)", (await page.locator("#canvas-panel-library video").count()) === 0 && (await page.locator("#canvas-panel-library li").count()) === 9);
  await page.keyboard.press("ArrowRight");
  await page.locator("#canvas-panel-how video").waitFor();
  const v1 = await page.locator("#canvas-panel-how video").elementHandle();
  check("How it works shows one player", (await page.locator("#canvas-panel-how video").count()) === 1);
  check("two blurred previews sit behind it", (await page.locator('#canvas-panel-how [aria-hidden="true"] img').count()) === 2);
  check("the first walkthrough has its own title", (await page.locator("#canvas-panel-how h3").first().innerText()).toLowerCase() === "one ride, many versions");
  await sleep(1200);
  const st1 = await v1.evaluate((v) => ({ muted: v.muted, paused: v.paused }));
  check("the active walkthrough plays muted", st1.muted && !st1.paused, JSON.stringify(st1));
  await page.screenshot({ path: `${OUT}/how-it-works-1440.png` });
  await page.getByRole("button", { name: "Next video" }).click();
  await sleep(700);
  check("Next shows the next walkthrough and replaces the player", (await page.locator("#canvas-panel-how h3").first().innerText()).toLowerCase() === "an action scene, beat by beat" && !(await v1.evaluate((v) => v.isConnected)) && (await page.locator("#canvas-panel-how video").count()) === 1);
  await page.getByRole("button", { name: "Previous video" }).focus();
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  check("the arrow keys move the carousel too", (await page.locator("#canvas-panel-how h3").first().innerText()).toLowerCase() === "one ride, many versions");
  await page.getByRole("tab", { name: "History" }).click();
  check("leaving How it works removes (stops) the player", (await page.locator('video[src*="/media/tutorials/"]').count()) === 0);

  // ------------------------------------------------------------ Motion Control banner → library → preview
  await page.getByRole("tab", { name: "Motion Control" }).click();
  check("Motion Control shows the text-and-cards banner", (await page.getByText(/Copy any move\s*onto your character/i).count()) === 1 && (await page.locator("#video-panel img").count()) >= 3);
  check("the functional inputs stay right below it", (await page.getByText("Add motion to copy").count()) === 1 && (await page.getByText("Add your character").count()) === 1);
  await page.screenshot({ path: `${OUT}/motion-banner-1440.png` });
  await page.locator("#video-panel").getByRole("button", { name: "Motion Library" }).click();
  check("the banner opens the Motion Library", (await page.getByRole("tab", { name: "Motion Library" }).getAttribute("aria-selected")) === "true");
  await page.screenshot({ path: `${OUT}/motion-library-1440.png` });

  const card = page.getByRole("button", { name: /Preview Pink pyjama dance/ });
  await card.click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  check("a card opens the preview with the clip", (await dialog.locator("video").getAttribute("src")) === "/media/client/pajama-dance.mp4");
  check("opening a preview requests no price and no job", log.quotes.length === 0 && log.generations.length === 0);
  await page.keyboard.press("Escape");
  await sleep(300);
  check("Escape closes the preview and removes its player", (await page.locator("dialog[open]").count()) === 0 && (await page.locator('video[src="/media/client/pajama-dance.mp4"]').count()) === 0);
  check("focus returns to the card", (await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Pink pyjama dance"));

  // Recreate: Oversized-tee dance (8 s).
  await page.getByRole("button", { name: /Preview Oversized-tee dance/ }).click();
  await dialog.waitFor();
  const recreateBtn = dialog.getByRole("button", { name: "Recreate" });
  check("Recreate waits for the character image", await recreateBtn.isDisabled());
  await dialog.locator('input[type="file"]').setInputFiles(FX.character);
  await dialog.getByAltText(/Your character/).waitFor();
  await dialog.locator("textarea").fill("in a neon-lit studio");
  await page.screenshot({ path: `${OUT}/motion-preview-1440.png` });
  await recreateBtn.click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  check("Recreate closes the preview and opens Motion Control", (await page.getByRole("tab", { name: "Motion Control" }).getAttribute("aria-selected")) === "true");
  check("the composer says where the motion came from", (await page.getByText(/Motion from the library: Oversized-tee dance/).count()) === 1);
  await page.waitForFunction(() => /Generate · /.test(document.querySelector(".gen-bar")?.textContent ?? ""), null, { timeout: 20000 });
  const vid = log.intents.find((i) => i.mime === "video/mp4");
  const img = log.intents.find((i) => i.mime === "image/png");
  check("the library clip itself is uploaded as the motion video", vid?.name === "tee-dance.mp4" && vid.bytes === 857651 && log.uploads.some((u) => u.url.endsWith(`/mock-${vid.n}`) && u.bytes >= 857651), JSON.stringify({ vid, uploads: log.uploads.map((u) => ({ path: u.url.split("/").pop(), bytes: u.bytes, type: u.type })) }));
  const asset = (i) => "33333333-3333-4333-8333-" + String(i.n).padStart(12, "0");
  const q = log.quotes.at(-1);
  check("the priced request carries the clip, the character and the prompt", q.modelId === "kling-3-0-motion" && q.prompt === "in a neon-lit studio" && q.inputs?.motion_video?.[0] === asset(vid) && q.inputs?.character_image?.[0] === asset(img), JSON.stringify(q));
  await page.screenshot({ path: `${OUT}/recreate-handoff-1440.png` });

  // Duplicate clicks: one request. A refused request shows its reason; a network failure retries with the same key.
  const gen = page.locator(".gen-bar button").last();
  await gen.dblclick();
  await sleep(1400);
  check("a double click sends one request", log.generations.length === 1, `${log.generations.length}`);
  check("a refused request shows the reason", (await page.getByText("Blocked in the preview harness.").count()) === 1);
  await gen.click();
  await page.getByText(/Pressing the button again resumes the same request/).waitFor({ timeout: 8000 });
  check("a network failure explains that retrying is safe", true);
  await gen.click();
  await page.waitForFunction(() => document.querySelector("#canvas-panel-history")?.textContent?.includes("J-TEST1") || document.body.textContent.includes("Waiting in queue"), null, { timeout: 15000 });
  check("all attempts for this quote use one idempotency key", log.genHeaders.length === 3 && new Set(log.genHeaders).size === 1, JSON.stringify(log.genHeaders));
  check("the created job appears in History", (await page.getByRole("tab", { name: "History" }).getAttribute("aria-selected")) === "true" && new URL(page.url()).searchParams.get("job") === JOB);
  await page.screenshot({ path: `${OUT}/recreate-submitted-1440.png` });
  check("no page errors", errors.length === 0, errors.join(" | "));
  check("no horizontal overflow at 1440", (await overflowX(page)) === 0);
  await ctx.close();

  // ------------------------------------------------------------ the clip cannot be fetched; a setting is adjusted
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log2 = await mockAccount(ctx2, {});
  await ctx2.route("**/media/client/hair-rollers.mp4", (r) => r.abort("failed"));
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/studio/video?tab=motion&view=library`, { waitUntil: "networkidle" });
  check("?view=library opens the library", (await p2.getByRole("tab", { name: "Motion Library" }).getAttribute("aria-selected")) === "true");
  await p2.getByRole("radio", { name: "Keep the image's pose" }).click();
  await p2.getByRole("button", { name: /Preview Rollers to waves/ }).click();
  const d2 = p2.locator("dialog[open]");
  await d2.waitFor();
  await d2.locator('input[type="file"]').setInputFiles(FX.character);
  await d2.getByAltText(/Your character/).waitFor();
  check("a setting that blocks the clip is changed with an explanation", (await d2.getByText(/set to “Follow the video”/).count()) === 1);
  await d2.getByRole("button", { name: "Recreate" }).click();
  await p2.getByText("The library clip could not be loaded. Check the connection and press Recreate again.").waitFor({ timeout: 15000 });
  check("a clip that cannot be loaded is reported in the slot", true);
  check("orientation now follows the video", (await p2.getByRole("radio", { name: "Follow the video" }).getAttribute("aria-checked")) === "true");
  check("nothing is priced without the motion clip", !log2.quotes.some((x) => x.inputs?.motion_video?.length));
  const reason = await p2.locator(".gen-bar button").last().innerText();
  check("the action names what to fix", /Remove the file that could not be used/.test(reason), reason);
  await ctx2.close();

  // ------------------------------------------------------------ a job link opens History
  const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await mockAccount(ctx4, {});
  const JOB4 = "44444444-4444-4444-8444-000000000004";
  await ctx4.route(`**/api/generations/${JOB4}`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: job(JOB4, "queued") }) }));
  const p4 = await ctx4.newPage();
  await p4.goto(`${BASE}/studio/video?job=${JOB4}`, { waitUntil: "networkidle" });
  check("a link to a job opens History", (await p4.getByRole("tab", { name: "History" }).getAttribute("aria-selected")) === "true");
  await ctx4.close();

  // ------------------------------------------------------------ phone: How it works first, then the tools
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mockAccount(ctx3, {});
  const p3 = await ctx3.newPage();
  await p3.goto(`${BASE}/studio/video`, { waitUntil: "networkidle" });
  const order = await p3.evaluate(() => ({ canvas: document.getElementById("video-canvas").getBoundingClientRect().top, composer: document.getElementById("video-composer").getBoundingClientRect().top }));
  check("on a phone How it works comes before the tools", order.canvas < order.composer, JSON.stringify(order));
  await p3.screenshot({ path: `${OUT}/how-it-works-first-390.png` });
  await p3.getByRole("button", { name: "Start creating" }).click();
  await sleep(1200);
  const after = await p3.evaluate(() => ({ top: Math.round(document.getElementById("video-composer").getBoundingClientRect().top), focus: document.activeElement?.id }));
  check("Start creating leads to the tools", after.top >= -4 && after.top < 160 && after.focus === "video-tab-create", JSON.stringify(after));
  await p3.goto(`${BASE}/studio/video?tab=motion&view=library`, { waitUntil: "networkidle" });
  await p3.getByRole("button", { name: /Preview Doorway dance/ }).click();
  await p3.locator("dialog[open]").waitFor();
  await sleep(500);
  const box = await p3.locator("dialog[open]").boundingBox();
  const rb = await p3.locator("dialog[open]").getByRole("button", { name: "Recreate" }).boundingBox();
  check("on a phone the preview fills the screen and Recreate is on screen", box.width <= 390 && rb && rb.y + rb.height <= 844, JSON.stringify({ box, rb }));
  await p3.screenshot({ path: `${OUT}/motion-preview-390.png` });
  await p3.keyboard.press("Escape");
  await p3.getByRole("tab", { name: "How it works" }).click();
  await p3.locator("#canvas-panel-how video").waitFor();
  await sleep(1000);
  const stage = await p3.locator("#canvas-panel-how video").boundingBox();
  check("on a phone the active walkthrough stays fully visible", stage.x >= 0 && stage.x + stage.width <= 390 && stage.y >= 0 && stage.y + stage.height <= 844, JSON.stringify(stage));
  check("no horizontal overflow at 390", (await overflowX(p3)) === 0);
  await p3.locator("#canvas-panel-how").screenshot({ path: `${OUT}/how-it-works-390.png` });
  await ctx3.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
