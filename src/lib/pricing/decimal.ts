/**
 * Exact decimal arithmetic for prices: a BigInt mantissa with a base-10 scale, so $0.03 × 2 ÷ $0.02 is exactly 3
 * (binary floating point gives 3.0000000000000004, which a ceiling turns into 4). Rounding is half away from zero,
 * like Postgres round(numeric).
 */
export type Dec = { m: bigint; s: number };

const TEN = BigInt(10);
const pow10 = (n: number) => TEN ** BigInt(n);
const abs = (n: bigint) => (n < BigInt(0) ? -n : n);

/** Parses "12", "0.005", "-1.5", "1e-7" or a finite number. Returns null for anything else. */
export function dec(v: string | number | null | undefined): Dec | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const text = (typeof v === "number" ? String(v) : v).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const [, sign, int, frac = "", exp = "0"] = match;
  let m = BigInt(`${int || "0"}${frac}` || "0");
  let s = frac.length - Number(exp);
  if (s < 0) {
    m *= pow10(-s);
    s = 0;
  }
  return { m: sign === "-" ? -m : m, s };
}

const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s);
  return [a.m * pow10(s - a.s), b.m * pow10(s - b.s), s];
};

export const add = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { m: x + y, s };
};
export const sub = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { m: x - y, s };
};
export const mul = (a: Dec, b: Dec): Dec => ({ m: a.m * b.m, s: a.s + b.s });
export const cmp = (a: Dec, b: Dec): number => {
  const [x, y] = align(a, b);
  return x === y ? 0 : x < y ? -1 : 1;
};

/** Integer division rounded half away from zero. */
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  if (r === BigInt(0)) return q;
  const up = abs(r) * BigInt(2) >= abs(den);
  if (!up) return q;
  return (num < BigInt(0)) !== (den < BigInt(0)) ? q - BigInt(1) : q + BigInt(1);
}

/** a ÷ b rounded to `scale` decimals. */
export function div(a: Dec, b: Dec, scale: number): Dec {
  if (b.m === BigInt(0)) throw new RangeError("division by zero");
  const num = a.m * pow10(b.s + scale);
  const den = b.m * pow10(a.s);
  return { m: divRound(num, den), s: scale };
}

/** Rounded to `scale` decimals. */
export function round(a: Dec, scale: number): Dec {
  if (a.s <= scale) return a;
  return { m: divRound(a.m, pow10(a.s - scale)), s: scale };
}

/** Smallest integer ≥ a. */
export function ceil(a: Dec): bigint {
  if (a.s <= 0) return a.m * pow10(-a.s);
  const d = pow10(a.s);
  const q = a.m / d;
  return a.m > q * d ? q + BigInt(1) : q;
}

export const fromInt = (n: bigint | number): Dec => ({ m: BigInt(n), s: 0 });
export const toNumber = (a: Dec) => Number(toString(a));

/** Plain decimal text without trailing zeros ("0.02", "3", "-1.5"). */
export function toString(a: Dec): string {
  const neg = a.m < BigInt(0);
  const digits = abs(a.m).toString().padStart(a.s + 1, "0");
  const int = a.s ? digits.slice(0, -a.s) : digits;
  const frac = a.s ? digits.slice(-a.s).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}
