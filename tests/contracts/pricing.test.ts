// Pricing in the browser: only the policy panel's input rules and the package editor's arithmetic. Model prices are
// calculated by the database's global policy (supabase/tests/10_automatic_pricing_tests.sql covers the formula and the
// brief's examples); the admin pages display those numbers and never compute a price themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as creditMath from "../../src/lib/pricing/credit-math";
import { creditsAtReference, packageRate, vsReferencePct } from "../../src/lib/pricing/credit-math";
import { ceil, dec, toString } from "../../src/lib/pricing/decimal";
import { modelKind, parseCreditValue, parseMarkup } from "../../src/components/live/admin/catalog/policy";

const s = (d: ReturnType<typeof dec>) => (d ? toString(d) : "null");

test("policy panel: markup is a percentage on the KIE cost, 0–2000 with at most two decimals", () => {
  assert.equal(parseMarkup("100"), 100);
  assert.equal(parseMarkup("150"), 150);
  assert.equal(parseMarkup("12.5"), 12.5);
  assert.equal(parseMarkup("0"), 0);
  assert.equal(parseMarkup("12.345"), null);
  assert.equal(parseMarkup("-1"), null);
  assert.equal(parseMarkup("2000.01"), null);
  assert.equal(parseMarkup(""), null);
  assert.equal(parseMarkup("abc"), null);
});

test("policy panel: the USD value of one Genlixs credit is above $0 with at most six decimals (never assumed to be $0.01)", () => {
  assert.equal(parseCreditValue("0.02"), 0.02);
  assert.equal(parseCreditValue("$0.01"), 0.01);
  assert.equal(parseCreditValue("0.012345"), 0.012345);
  assert.equal(parseCreditValue("0.0123456"), null);
  assert.equal(parseCreditValue("0"), null);
  assert.equal(parseCreditValue("-0.02"), null);
  assert.equal(parseCreditValue("101"), null);
});

test("type filters: image, image editing, video and video editing", () => {
  const kind = (tool: "image" | "edit" | "video", jobKind: string) =>
    modelKind({ tool, capability: { id: "c", version: 1, spec: { jobKind } as never } });
  assert.equal(kind("image", "text_to_image"), "image");
  assert.equal(kind("edit", "image_edit"), "edit");
  assert.equal(kind("video", "text_to_video"), "video");
  assert.equal(kind("video", "video_edit"), "video_edit");
  assert.equal(kind("video", "video_extend"), "video_edit");
  assert.equal(kind("video", "motion_control"), "video_edit");
});

test("no model-price formula in the browser: credit math covers packages only", () => {
  assert.deepEqual(Object.keys(creditMath).sort(), ["creditsAtReference", "dec", "packageRate", "toNumber", "vsReferencePct"]);
  const dir = new URL("../../src/components/live/admin/catalog/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /chargeFromMarkup|targetFromMarkup|chargeForTarget|kieCostUsd/, `${f} computes a model price`);
  }
});

test("packages: usable credits include the bonus; rate compared with the credit value", () => {
  const pack = packageRate(900, 200, 50)!;
  assert.equal(pack.usable, 250);
  assert.equal(s(pack.usdPerCredit), "0.036");
  assert.equal(vsReferencePct(pack.usdPerCredit, dec("0.02")), 80);
  assert.equal(vsReferencePct(packageRate(500, 250)!.usdPerCredit, dec("0.02")), 0);
  assert.equal(creditsAtReference(900, dec("0.02")), 450);
  assert.equal(creditsAtReference(1000, dec("0.03")), 333, "rounded down so the package stays at or above the credit value");
  assert.equal(packageRate(900, 0), null);
  assert.equal(vsReferencePct(dec("0.02")!, null), null, "unknown stays unknown");
});

test("decimal parsing and ceiling", () => {
  assert.equal(s(dec("1e-7")), "0.0000001");
  assert.equal(s(dec(0.1 + 0.2)), "0.30000000000000004", "numbers are taken as printed; editors pass typed text");
  assert.equal(dec("1.2.3"), null);
  assert.equal(ceil(dec("2.0000")!), BigInt(2));
  assert.equal(ceil(dec("2.0001")!), BigInt(3));
  assert.equal(ceil(dec("-1.5")!), BigInt(-1));
});
