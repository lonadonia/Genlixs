// v3.4 browser checks: a signed-in studio without a real account. The account endpoints are answered locally (user,
// wallet, notifications, history, quotes, uploads, generations); pages, static media and the public catalog come from
// the running app. Nothing reaches a provider; no generation, upload or charge happens.
// Env: PLAYWRIGHT_PATH (playwright or playwright-core), CHROME_PATH (optional), BASE (default http://localhost:3200).
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
export const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright");
export const BASE = process.env.BASE ?? "http://localhost:3200";
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Horizontal overflow of the page (px beyond the viewport). */
export const overflowX = (page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

export const ME = {
  id: "00000000-0000-4000-8000-00000000c0de",
  email: "preview@genlixs.test",
  emailVerified: true,
  displayName: "Preview",
  locale: "en",
  accountStatus: "active",
  marketingOptIn: false,
  emailNotifications: false,
  capabilities: [],
  isStaff: false,
};
const wallet = { availableUnits: "240", reservedUnits: "0", spentUnits: "0", restricted: false, nearestExpiry: null, lots: [], periodSpentUnits: "0" };

export async function mockAccount(ctx, opts = {}) {
  const log = { quotes: [], generations: [], genHeaders: [], intents: [], uploads: [], finalized: [] };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ data, requestId: "mock" }) });
  const err = (route, code, message, status) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message }, requestId: "mock" }) });
  await ctx.route("**/api/me", (r) => json(r, { ...ME, ...(opts.me ?? {}) }));
  await ctx.route("**/api/wallet", (r) => json(r, wallet));
  await ctx.route("**/api/notifications**", (r) => json(r, { items: [], unread: 0 }));
  await ctx.route(/\/api\/generations(\?.*)?$/, async (r) => {
    if (r.request().method() === "POST") {
      log.generations.push(JSON.parse(r.request().postData() ?? "{}"));
      log.genHeaders.push(r.request().headers()["idempotency-key"] ?? null);
      if (opts.generationDelayMs) await sleep(opts.generationDelayMs);
      const res = opts.generationResponse?.(log.generations.length) ?? { status: 400, code: "BLOCKED", message: "Blocked in the preview harness." };
      if (res.abort) return r.abort("failed");
      if (res.status >= 400) return err(r, res.code, res.message, res.status);
      return json(r, res.data, res.status);
    }
    return json(r, opts.history ?? []);
  });
  if (opts.catalog) await ctx.route("**/api/catalog", (r) => json(r, opts.catalog));
  await ctx.route("**/api/generation/quotes", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    log.quotes.push(body);
    return json(r, { quoteId: "11111111-1111-4111-8111-" + String(log.quotes.length).padStart(12, "0"), creditUnits: "15", expiresAt: new Date(Date.now() + 600000).toISOString(), availableUnits: "240", options: body.options ?? {}, inputs: body.inputs ?? null }, 201);
  });
  let n = 0;
  await ctx.route("**/api/uploads/intents", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    n += 1;
    log.intents.push({ n, ...body });
    if (opts.failIntent?.(n, body)) return err(r, "UPLOAD_REFUSED", "The upload could not start (test).", 503);
    return json(r, { intentId: "22222222-2222-4222-8222-" + String(n).padStart(12, "0"), bucket: "generation-inputs", path: `${ME.id}/mock-${n}` }, 201);
  });
  await ctx.route("**/storage/v1/object/**", (r) => {
    log.uploads.push({ url: r.request().url(), bytes: r.request().postDataBuffer()?.length ?? 0, type: r.request().headers()["content-type"] });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "x" }) });
  });
  await ctx.route("**/storage/v1/upload/resumable**", (r) => {
    const m = r.request().method();
    if (m === "POST") return r.fulfill({ status: 201, headers: { location: r.request().url() + "/mock", "tus-resumable": "1.0.0" }, body: "" });
    if (m === "HEAD") return r.fulfill({ status: 200, headers: { "upload-offset": "0", "tus-resumable": "1.0.0" }, body: "" });
    return r.fulfill({ status: 204, headers: { "upload-offset": String(Number(r.request().headers()["upload-offset"] ?? 0) + (r.request().postDataBuffer()?.length ?? 0)), "tus-resumable": "1.0.0" }, body: "" });
  });
  await ctx.route("**/api/uploads/*/finalize", (r) => {
    const id = r.request().url().split("/uploads/")[1].split("/")[0].replace("22222222-2222-4222-8222", "33333333-3333-4333-8333");
    log.finalized.push(id);
    return json(r, { assetId: id, state: "validated" });
  });
  await ctx.route("**/api/assets/*/probe", (r) => json(r, { assetId: r.request().url().split("/assets/")[1].split("/")[0], mime: "image/png", width: 1024, height: 1536, durationMs: null }));
  await ctx.route("**/api/assets/*/download**", (r) => json(r, { url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", expiresAt: new Date(Date.now() + 300000).toISOString() }));
  return log;
}

/** The catalog served by the running app. */
export async function liveCatalog() {
  return (await (await fetch(`${BASE}/api/catalog`)).json()).data;
}

/** Per-model reference limits set by migration 20261018013256 (production since 18 Oct 2026). */
export const EDIT_LIMITS = { "gpt-flare-edit": 16, "gpt-sunburst-edit": 16, "nano-banana-pro-edit": 8, "flux-2-pro-edit": 8, "seedream-5-flash-edit": 10 };

/** The app's catalog with fixed reference limits for the edit models, so a run does not depend on the live values. */
export async function catalogWithEditLimits(limits) {
  const c = await liveCatalog();
  return { ...c, models: c.models.map((m) => (m.tool === "edit" ? { ...m, references: { ...m.references, max: typeof limits === "number" ? limits : (limits[m.id] ?? m.references.max) } } : m)) };
}

// ------------------------------------------------------------ PNG fixtures (no image library needed)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** A solid-colour RGB PNG with a darker square in the middle, so thumbnails differ. */
export function png(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const inner = x > width / 3 && x < (2 * width) / 3 && y > height / 3 && y < (2 * height) / 3;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = inner ? r >> 1 : r;
      raw[o + 1] = inner ? g >> 1 : g;
      raw[o + 2] = inner ? b >> 1 : b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Writes a.png … l.png (640×800) and character.png (720×1080) to a temporary folder; returns name → path. */
export function fixtures() {
  const dir = join(tmpdir(), "genlixs-qa-v34");
  mkdirSync(dir, { recursive: true });
  const colors = [[228, 87, 87], [242, 163, 58], [232, 216, 74], [91, 194, 107], [63, 182, 201], [79, 108, 240], [154, 92, 240], [224, 90, 176], [138, 143, 153], [201, 132, 77], [74, 194, 154], [214, 95, 95]];
  const out = {};
  "abcdefghijkl".split("").forEach((l, i) => {
    out[l] = join(dir, `${l}.png`);
    writeFileSync(out[l], png(640, 800, colors[i]));
  });
  out.character = join(dir, "character.png");
  writeFileSync(out.character, png(720, 1080, [81, 101, 248]));
  return out;
}
