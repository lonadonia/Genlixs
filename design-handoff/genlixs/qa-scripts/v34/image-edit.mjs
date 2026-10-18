// Image studio checks (mocked account, real running app): routes, Generate/Edit drafts, several references
// (multi-select, append, remove, failed upload + retry, model-limit change), the priced request's order, and the
// production state (one image per model until the pending migration is applied).
import { mkdirSync, readFileSync } from "node:fs";
import { BASE, fixtures, launch, liveCatalog, mockAccount, overflowX, raisedCatalog } from "./mock.mjs";

const OUT = process.env.OUT ?? "out-v34/image";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const FX = fixtures();
const fx = (n) => FX[n];

const browser = await launch();
try {
  // ------------------------------------------------------------ raised limits (after the migration)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let failNext = false;
  const log = await mockAccount(ctx, { catalog: await raisedCatalog(), failIntent: () => (failNext ? ((failNext = false), true) : false) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/studio/edit?ref=abc&ref=def`, { waitUntil: "networkidle" });
  const u = new URL(page.url());
  check("old /studio/edit URL lands on Image with Edit selected, query kept", u.pathname === "/studio/image" && u.searchParams.get("mode") === "edit" && u.searchParams.getAll("ref").join(",") === "abc,def", page.url());
  check("Edit mode is the selected local mode", (await page.getByRole("radio", { name: "Edit" }).getAttribute("aria-checked")) === "true");
  const railEdit = await page.locator("aside nav a", { hasText: /^Edit$/ }).count();
  check("main navigation has no separate Edit item", railEdit === 0, `links named Edit: ${railEdit}`);
  check("counter shows the model's real limit", (await page.getByText("0 / 16").count()) === 1);

  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles([fx("a"), fx("b"), fx("c")]);
  await page.waitForFunction(() => document.querySelectorAll('img[alt^="Image "]').length === 3 && !document.body.innerText.includes("Checking"), null, { timeout: 15000 });
  const names = () => page.$$eval('img[alt^="Image "]', (els) => els.map((e) => e.getAttribute("alt").replace(/^Image \d+ of \d+: /, "")));
  check("three files selected at once are all added in order", JSON.stringify(await names()) === JSON.stringify(["a.png", "b.png", "c.png"]), JSON.stringify(await names()));

  await page.locator('input[type="file"]').first().setInputFiles([fx("d"), fx("e")]);
  await page.waitForFunction(() => document.querySelectorAll('img[alt^="Image "]').length === 5, null, { timeout: 15000 });
  check("a later selection appends after the existing images", JSON.stringify(await names()) === JSON.stringify(["a.png", "b.png", "c.png", "d.png", "e.png"]), JSON.stringify(await names()));

  await page.getByRole("button", { name: "Remove image 2 (b.png)" }).click();
  check("one image is removed; the others keep their order", JSON.stringify(await names()) === JSON.stringify(["a.png", "c.png", "d.png", "e.png"]), JSON.stringify(await names()));

  await page.locator("#live-prompt").fill("Put the hat from image 2 on the person in image 1");
  await page.waitForFunction(() => /Generate · /.test(document.body.innerText), null, { timeout: 15000 });
  const idOf = (name) => {
    const n = log.intents.filter((i) => i.name === name).at(-1).n;
    return "33333333-3333-4333-8333-" + String(n).padStart(12, "0");
  };
  const lastQuote = () => log.quotes.at(-1);
  check("the priced request carries every image in the order shown", JSON.stringify(lastQuote().referenceAssetIds) === JSON.stringify(["a.png", "c.png", "d.png", "e.png"].map(idOf)), JSON.stringify(lastQuote()));
  await page.screenshot({ path: `${OUT}/edit-4-refs-1440.png` });

  // A failed upload stays visible, blocks the price, and can be retried without losing the others.
  failNext = true;
  await page.locator('input[type="file"]').first().setInputFiles([fx("f")]);
  await page.getByText("Not added").waitFor({ timeout: 15000 });
  const btn = page.locator(".gen-bar button").last();
  check("a failed upload blocks the price with a clear reason", /Remove the image that could not be used/.test(await btn.innerText()), await btn.innerText());
  await page.getByRole("button", { name: "Retry image 5" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Not added") && /Generate · /.test(document.body.innerText), null, { timeout: 15000 });
  check("retry succeeds and keeps the earlier images", JSON.stringify(await names()) === JSON.stringify(["a.png", "c.png", "d.png", "e.png", "f.png"]), JSON.stringify(await names()));

  // Ten images, then a model that takes eight: explained, nothing dropped, compatible models offered.
  await page.locator('input[type="file"]').first().setInputFiles([fx("g"), fx("h"), fx("i"), fx("j"), fx("k")]);
  await page.waitForFunction(() => document.querySelectorAll('img[alt^="Image "]').length === 10 && !document.body.innerText.includes("Checking"), null, { timeout: 20000 });
  await page.getByRole("button", { name: /^Model/ }).click();
  await page.getByRole("option", { name: /Nano Banana Pro Edit/ }).click();
  await page.getByText("This model takes up to 8 images — remove 2 or choose a model that takes 10").first().waitFor({ timeout: 5000 });
  check("a lower limit is explained and nothing is discarded", (await page.$$eval('img[alt^="Image "]', (e) => e.length)) === 10);
  check("the action names the problem instead of a price", /Too many images for this model/.test(await btn.innerText()), await btn.innerText());
  const offers = await page.getByRole("button", { name: /^Use / }).allInnerTexts();
  check("compatible models are offered", offers.length >= 1 && offers.every((t) => !/Nano Banana|FLUX/.test(t)), JSON.stringify(offers));
  check("no price is requested for a request the model would refuse", !log.quotes.some((q) => q.modelId === "nano-banana-pro-edit" && q.referenceAssetIds.length > 8));
  await page.screenshot({ path: `${OUT}/edit-limit-conflict-1440.png` });
  await page.getByRole("button", { name: /^Use Seedream/ }).click();
  await page.waitForFunction(() => /Generate · /.test(document.body.innerText), null, { timeout: 15000 });
  const all10 = ["a.png", "c.png", "d.png", "e.png", "f.png", "g.png", "h.png", "i.png", "j.png", "k.png"].map(idOf);
  check("after choosing a compatible model all ten images are priced, in order", lastQuote().modelId === "seedream-5-flash-edit" && JSON.stringify(lastQuote().referenceAssetIds) === JSON.stringify(all10), JSON.stringify(lastQuote()));

  // Drafts per mode survive switching.
  await page.getByRole("radio", { name: "Generate" }).click();
  const genPrompt = await page.locator("#live-prompt").inputValue();
  await page.locator("#live-prompt").fill("A lighthouse at dawn");
  await page.getByRole("radio", { name: "Edit" }).click();
  check("switching modes keeps each mode's draft", genPrompt === "" && (await page.locator("#live-prompt").inputValue()) === "Put the hat from image 2 on the person in image 1" && (await page.$$eval('img[alt^="Image "]', (e) => e.length)) === 10);
  await page.getByRole("radio", { name: "Generate" }).click();
  check("the Generate draft is kept too", (await page.locator("#live-prompt").inputValue()) === "A lighthouse at dawn");
  check("URL follows the mode", !new URL(page.url()).searchParams.has("mode"));
  check("no page errors", errors.length === 0, errors.join(" | "));
  check("no horizontal overflow at 1440", (await overflowX(page)) === 0);
  await ctx.close();

  // ------------------------------------------------------------ production today: one image per edit model
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const log2 = await mockAccount(ctx2, { catalog: await liveCatalog() });
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/studio/image?mode=edit`, { waitUntil: "networkidle" });
  check("production limit is shown as 0 / 1", (await p2.getByText("0 / 1").count()) === 1);
  check("the file picker takes one file for a one-image model", (await p2.locator('input[type="file"]').first().getAttribute("multiple")) === null);
  // Dropping three files at once onto the drop area.
  const files = ["a", "b", "c"].map((n) => ({ name: n + ".png", b64: readFileSync(fx(n)).toString("base64") }));
  await p2.evaluate(async (files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "image/png" }));
    const zone = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Add an image"));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
  await p2.getByText(/was not added: this model takes up to 1 image/).first().waitFor({ timeout: 10000 });
  await p2.waitForFunction(() => document.querySelectorAll('img[alt^="Image "]').length === 1, null, { timeout: 10000 });
  check("a single-image model takes one file and says why the others were not added", (await p2.$$eval('img[alt^="Image "]', (e) => e.length)) === 1);
  check("no add tile once the limit is reached", (await p2.locator('label:has(span.sr-only:text-matches("Add more images"))').count()) === 0);
  await p2.locator("#live-prompt").fill("Make the colours warmer");
  await p2.waitForFunction(() => /Generate · /.test(document.body.innerText), null, { timeout: 15000 });
  check("the single image is priced", log2.quotes.at(-1).referenceAssetIds.length === 1);
  check("no horizontal overflow at 390", (await overflowX(p2)) === 0);
  await p2.screenshot({ path: `${OUT}/edit-single-390.png`, fullPage: true });
  await ctx2.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
