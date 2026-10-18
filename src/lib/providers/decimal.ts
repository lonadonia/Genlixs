/**
 * Exact decimal helpers for money sent to providers (no binary floating point). Amounts are decimal text.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const DEC = /^\s*(-?)(\d+)(?:\.(\d+))?\s*$/;

/** Decimal text → integer of 10^-scale units, rounding up (ceil) any further digits. */
export function toUnits(v: string | number, scale: number): bigint | null {
  const m = DEC.exec(typeof v === "number" ? (Number.isFinite(v) ? v.toString() : "") : v);
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(scale, "0");
  let units = BigInt(m[2] + frac.slice(0, scale));
  if (/[1-9]/.test(frac.slice(scale))) units += ONE;
  return m[1] === "-" ? -units : units;
}

export function fromUnits(units: bigint, scale: number): string {
  const neg = units < ZERO;
  const s = (neg ? -units : units).toString().padStart(scale + 1, "0");
  const int = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** value × num / den, rounded up at `scale` decimals (a ceiling never undercuts the estimate). */
export function scaleUp(v: string | number, num: bigint, den: bigint, scale = 6): string | null {
  const units = toUnits(v, scale);
  if (units === null) return null;
  const p = units * num;
  return fromUnits(p / den + (p % den > ZERO ? ONE : ZERO), scale);
}
