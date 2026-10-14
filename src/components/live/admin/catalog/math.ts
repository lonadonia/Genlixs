import type { Assumptions, Contribution, RevenueBasis } from "./types";

/**
 * Display-only mirror of app_private.contribution() for live editing. The database recomputes every figure with
 * exact numeric arithmetic when a price is saved or published; these values only preview an unsaved edit.
 * contribution = revenue × (1 − affiliate rate − payment fee rate) − KIE cost − fixed fee share − operating cost,
 * with revenue = credits charged × the lowest package revenue per credit. Unknown fees are left out and listed.
 */
export function contributionOf(units: number | null, supplierUsd: number | null, basis: RevenueBasis | undefined, a: Assumptions | undefined): Contribution {
  const rpc = basis?.minRevenuePerCredit ?? null;
  if (units === null || !Number.isFinite(units) || supplierUsd === null || rpc === null || !a) return null;
  const pack = Number(basis?.conservative?.credits ?? 0);
  const fee = a.paymentFeeBps ?? null;
  const fixed = a.paymentFixedFeeUsd ?? null;
  const op = a.operatingCostUsdPerJob ?? null;
  const rev = units * rpc;
  const costs = supplierUsd + (fixed !== null && pack > 0 ? (fixed / pack) * units : 0) + (op ?? 0);
  const feeRate = (fee ?? 0) / 10000;
  const excludes = [fee === null ? "variable payment fees" : null, fixed === null ? "fixed payment fees" : null, op === null ? "operating costs" : null].filter(
    (x): x is string => x !== null,
  );
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    revenueUsd: round6(rev),
    direct: round6(rev * (1 - feeRate) - costs),
    affiliateBase: round6(rev * (1 - a.affiliate.baseBps / 10000 - feeRate) - costs),
    affiliateUplift: round6(rev * (1 - a.affiliate.upliftBps / 10000 - feeRate) - costs),
    excludes,
  };
}

/** Keys of a schedule's rate table (dimension values joined by "|"), in the order the database enumerates them. */
export function scheduleKeys(dims: string[], options: Record<string, { values: (string | number)[] }>): { key: string; options: Record<string, string | number> }[] {
  let set: Record<string, string | number>[] = [{}];
  for (const d of dims) {
    const values = options[d]?.values;
    if (!values) return [];
    set = set.flatMap((c) => values.map((v) => ({ ...c, [d]: v })));
  }
  return set.map((o) => ({ key: dims.map((d) => String(o[d])).join("|"), options: o }));
}
