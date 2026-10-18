import { dec, div, fromInt, mul, round, sub, toNumber, type Dec } from "./decimal";

/**
 * Package arithmetic for the admin package editor, with exact decimals. Model prices are never calculated in the
 * browser: they come from the database's global pricing policy (KIE reference × markup ÷ USD per Genlixs credit), the
 * same numbers quotes and debits use.
 */

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
