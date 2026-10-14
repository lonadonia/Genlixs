// Credit pricing arithmetic used by the admin editors (it mirrors app_private.model_price_table step by step).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualMarkupPct,
  chargeForTarget,
  chargeFromMarkup,
  contributionUsd,
  creditCountDifferencePct,
  creditsAtReference,
  kieCostUsd,
  markupBps,
  packageRate,
  perCredit,
  targetFromMarkup,
  valueUsd,
  vsReferencePct,
} from "../../src/lib/pricing/credit-math";
import { ceil, dec, div, toNumber, toString } from "../../src/lib/pricing/decimal";

const s = (d: ReturnType<typeof dec>) => (d ? toString(d) : "null");

test("owner example: KIE $5 / 1,000 and Genlixs $5 / 250, an image of 6 KIE credits charged 3 Genlixs credits", () => {
  const kie = perCredit("5", "1000")!;
  const credit = perCredit("5.00", "250")!;
  assert.equal(s(kie), "0.005");
  assert.equal(s(credit), "0.02");
  const cost = kieCostUsd(6, kie)!;
  assert.equal(s(cost), "0.03");
  // +100 % above the KIE cost gives exactly 3 Genlixs credits worth $0.06.
  assert.equal(chargeFromMarkup(cost, markupBps("100")!, credit), 3);
  const value = valueUsd(3, credit);
  assert.equal(s(value), "0.06");
  assert.equal(actualMarkupPct(value, cost), 100);
  // 3 credits instead of 6 is 50 % fewer credits in number, not "100 % less".
  assert.equal(creditCountDifferencePct(3, 6), -50);
  // One Genlixs credit is worth 4 KIE credits: +300 % in value.
  assert.equal(toNumber(div(credit, kie, 4)), 4);
  // Contribution before payment and running costs: $0.03 direct, $0.012 with 30 %, $0 with 50 % commission.
  assert.equal(s(contributionUsd(value, cost, 0)), "0.03");
  assert.equal(s(contributionUsd(value, cost, 3000)), "0.012");
  assert.equal(s(contributionUsd(value, cost, 5000)), "0");
});

test("exact decimals: $0.07 at $0.01 per credit is 7 credits, not 8", () => {
  assert.equal(Math.ceil(0.07 / 0.01), 8, "binary floating point overshoots");
  assert.equal(chargeForTarget(dec("0.07")!, dec("0.01")!), 7);
  assert.equal(chargeForTarget(dec("0.06")!, dec("0.02")!), 3);
  assert.equal(chargeForTarget(dec("0.0600000001")!, dec("0.02")!), 4);
  assert.equal(chargeForTarget(dec("0.001")!, dec("0.02")!), 1, "at least one credit");
});

test("rounding up to whole credits and the actual markup it produces", () => {
  const credit = dec("0.02")!;
  const cost = kieCostUsd(3.24, dec("0.005")!)!; // a fractional KIE price
  assert.equal(s(cost), "0.0162");
  const target = targetFromMarkup(cost, markupBps(100)!);
  assert.equal(s(target), "0.0324");
  assert.equal(chargeForTarget(target, credit), 2);
  assert.equal(actualMarkupPct(valueUsd(2, credit), cost), 146.9136);
  // +0 % never charges below the KIE cost: the ceiling only rounds up.
  assert.equal(chargeFromMarkup(cost, 0, credit), 1);
  assert.ok(toNumber(valueUsd(1, credit)) >= toNumber(cost));
});

test("markup input: at most two decimals, 0–2000 %", () => {
  assert.equal(markupBps("300"), 30000);
  assert.equal(markupBps("12.5"), 1250);
  assert.equal(markupBps("0"), 0);
  assert.equal(markupBps("12.345"), null);
  assert.equal(markupBps("-1"), null);
  assert.equal(markupBps("2000.01"), null);
  assert.equal(markupBps("abc"), null);
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
});

test("unknown costs stay unknown (never zero)", () => {
  assert.equal(kieCostUsd(null, dec("0.005")), null);
  assert.equal(actualMarkupPct(dec("0.06")!, null), null);
  assert.equal(contributionUsd(dec("0.06")!, null), null);
  assert.equal(perCredit("5", "0"), null);
  assert.equal(perCredit("", "250"), null);
});

test("decimal parsing and ceiling", () => {
  assert.equal(s(dec("1e-7")), "0.0000001");
  assert.equal(s(dec(0.1 + 0.2)), "0.30000000000000004", "numbers are taken as printed; editors pass typed text");
  assert.equal(dec("1.2.3"), null);
  assert.equal(ceil(dec("2.0000")!), BigInt(2));
  assert.equal(ceil(dec("2.0001")!), BigInt(3));
  assert.equal(ceil(dec("-1.5")!), BigInt(-1));
});
