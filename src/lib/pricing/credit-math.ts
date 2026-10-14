import { ceil, cmp, dec, div, fromInt, mul, round, sub, toNumber, type Dec } from "./decimal";

/**
 * Credit pricing arithmetic shared by the admin editors. It mirrors the database (app_private.model_price_table and
 * the reference-value columns) step by step, with the same roundings, so a previewed charge is the charge the server
 * saves. The server recalculates and validates everything on save; quotes and debits only ever use saved prices.
 *
 *   USD per credit      = amount ÷ credits                          (10 decimals; KIE purchase or Genlixs credit value)
 *   KIE cost (USD)      = KIE credits × USD per KIE credit          (8 decimals)
 *   target (USD)        = KIE cost × (1 + markup ÷ 100)             (8 decimals)
 *   charge (credits)    = ceil(target ÷ USD per Genlixs credit)     (division to 12 decimals, at least 1)
 *   value (USD)         = charge × USD per Genlixs credit
 *   actual markup (%)   = (value ÷ KIE cost − 1) × 100
 */

/** USD per credit from an amount and a credit quantity (null when either is missing or not positive). */
export function perCredit(amountUsd: string | number | null | undefined, credits: string | number | null | undefined): Dec | null {
  const a = dec(amountUsd);
  const c = dec(credits);
  if (!a || !c || a.m <= BigInt(0) || c.m <= BigInt(0)) return null;
  return div(a, c, 10);
}

/** KIE cost in USD of a configuration. Unknown stays unknown (never zero). */
export function kieCostUsd(kieCredits: number | string | null | undefined, usdPerKieCredit: Dec | null): Dec | null {
  const k = dec(kieCredits);
  if (!k || !usdPerKieCredit) return null;
  return round(mul(k, usdPerKieCredit), 8);
}

const BPS = dec(10000)!;

/** Markup percentage (up to 2 decimals, 0–2000 %) as basis points, or null when not valid. */
export function markupBps(percent: string | number | null | undefined): number | null {
  const p = dec(percent);
  if (!p || p.m < BigInt(0)) return null;
  const bps = mul(p, fromInt(100));
  const r = round(bps, 0);
  if (cmp(r, bps) !== 0 || cmp(p, fromInt(2000)) > 0) return null;
  return Number(r.m);
}

/** Target USD for a markup above the KIE cost. */
export function targetFromMarkup(costUsd: Dec, bps: number): Dec {
  return round(div(mul(costUsd, fromInt(10000 + bps)), BPS, 12), 8);
}

/** Whole Genlixs credits needed to reach a target USD value at the Genlixs credit value (at least 1). */
export function chargeForTarget(targetUsd: Dec, usdPerGenlixsCredit: Dec): number {
  const n = ceil(div(targetUsd, usdPerGenlixsCredit, 12));
  return Number(n < BigInt(1) ? BigInt(1) : n);
}

/** Charge from a markup: the bulk tool and the "markup" field of the editor. */
export function chargeFromMarkup(costUsd: Dec, bps: number, usdPerGenlixsCredit: Dec): number {
  return chargeForTarget(targetFromMarkup(costUsd, bps), usdPerGenlixsCredit);
}

/** Reference value of a charge in USD. */
export const valueUsd = (credits: number, usdPerGenlixsCredit: Dec): Dec => mul(fromInt(credits), usdPerGenlixsCredit);

/** Actual markup above the KIE cost as a percentage (null when the cost is unknown or zero). */
export function actualMarkupPct(value: Dec, costUsd: Dec | null): number | null {
  if (!costUsd || costUsd.m <= BigInt(0)) return null;
  return toNumber(round(mul(sub(div(value, costUsd, 12), fromInt(1)), fromInt(100)), 4));
}

/** How a charge compares with the KIE credits it consumes, in numbers of credits (e.g. 3 vs 6 = 50 % fewer). */
export function creditCountDifferencePct(genlixsCredits: number, kieCredits: number | null): number | null {
  if (kieCredits === null || kieCredits <= 0) return null;
  return toNumber(round(mul(sub(div(fromInt(genlixsCredits), dec(kieCredits)!, 12), fromInt(1)), fromInt(100)), 2));
}

/**
 * Contribution of one generation before payment fees and running costs: value × (1 − partner commission) − KIE cost.
 * Estimates at a given USD value per credit (the reference value or a package's effective rate).
 */
export function contributionUsd(value: Dec, costUsd: Dec | null, commissionBps = 0): Dec | null {
  if (!costUsd) return null;
  const kept = div(mul(value, fromInt(10000 - commissionBps)), BPS, 12);
  return round(sub(kept, costUsd), 8);
}

/** Usable credits and effective USD per credit of a package (price ÷ (included + bonus)). */
export function packageRate(amountMinor: number | string, includedCredits: number | string, bonusCredits: number | string = 0) {
  const included = dec(includedCredits);
  const bonus = dec(bonusCredits) ?? fromInt(0);
  const amount = dec(amountMinor);
  if (!included || !amount || included.m < BigInt(1) || bonus.m < BigInt(0)) return null;
  const usable = included.m + bonus.m;
  const price = div(amount, fromInt(100), 2);
  return { usable: Number(usable), priceUsd: price, usdPerCredit: div(price, fromInt(usable), 10) };
}

/** Premium (+) or discount (−) of a package's effective rate against the reference rate, in percent. */
export function vsReferencePct(rate: Dec, reference: Dec | null): number | null {
  if (!reference || reference.m <= BigInt(0)) return null;
  return toNumber(round(mul(sub(div(rate, reference, 12), fromInt(1)), fromInt(100)), 2));
}

/** Credits a package would include at the reference rate (whole credits, rounded down so the package stays at or above it). */
export function creditsAtReference(amountMinor: number, reference: Dec | null): number | null {
  if (!reference || reference.m <= BigInt(0) || amountMinor < 1) return null;
  const n = div(div(fromInt(amountMinor), fromInt(100), 2), reference, 12);
  const whole = n.m / BigInt(10) ** BigInt(n.s);
  return Number(whole);
}

export { dec, toNumber, type Dec };
