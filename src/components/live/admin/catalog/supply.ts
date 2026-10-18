/* Supply view of the catalog (admin_catalog_supply): which supplier serves each model now, what every supplier would
   charge for the same default request, and the products outside the catalog with each supplier's quote. Amounts are
   numbers for display only (every cost is computed in the database); null always means unknown, never zero. */

import type { Tone } from "@/components/ui/badge";
import type { Policy } from "./policy";

/** First step still missing before an offer can serve customers, in the order the steps are done. */
export type SupplyStage =
  | "serving"
  | "standby"
  | "routing_off"
  | "supplier_off"
  | "needs_test"
  | "needs_key"
  | "price_unverified"
  | "needs_integration";

export type SupplyQuote = {
  offerId: string;
  provider: string;
  providerName: string;
  legacy: boolean;
  status: string;
  decision: string;
  decisionReason: string | null;
  blocker: string | null;
  routingEnabled: boolean;
  supplierOn: boolean;
  hasKey: boolean;
  integrated: boolean;
  confidence: string | null;
  unit: string | null;
  unitBasis: string | null;
  incompatible: string | null;
  native: number | null;
  usd: number | null;
  /** Effective markup if this offer served the default request at the current customer price. */
  markupIfServedPct: number | null;
  current: boolean;
  stage: SupplyStage;
};

/** Automatic price of the default request: B (KIE reference), B × (1 + markup), credits charged and their value. */
export type SupplyPricing = {
  status: "ok" | "partial" | "kie_reference_needed";
  reason: string | null;
  followsPolicy: boolean;
  priceVersion: number | null;
  priceSource: string | null;
  policyVersion: number | null;
  kieUsd: number | null;
  targetUsd: number | null;
  chargedUsd: number | null;
  cost: { version: number; sourceKind: string; sourceUrl: string | null; checkedAt: string } | null;
};

export type SupplyModel = {
  id: string;
  example: {
    options: Record<string, string | number>;
    mode: string | null;
    quantities: { outputs: number; counts: Record<string, number>; seconds: Record<string, number>; promptChars: number };
  };
  /** Genlixs credits charged for the default request (null when not priced). */
  defaultUnits: number | null;
  pricing: SupplyPricing;
  route: {
    status: "ok" | "blocked" | "unavailable";
    explanation: string;
    offerId: string | null;
    provider: string | null;
    providerName: string | null;
    legacy: boolean | null;
    native: number | null;
    unit: string | null;
    /** C: what the serving supplier costs for the whole default request, funding terms applied. */
    usd: number | null;
    /** (charged value − C) ÷ C, from the database. */
    effectiveMarkupPct: number | null;
  };
  quotes: SupplyQuote[];
};

export type ProductOffer = {
  offerId: string;
  provider: string;
  providerName: string;
  label: string;
  status: string;
  decision: string;
  decisionReason: string | null;
  blocker: string | null;
  integrated: boolean;
  confidence: string | null;
  unit: string | null;
  unitBasis: string | null;
  basis: "output" | "request" | "output_second" | "io_second" | null;
  dims: string[] | null;
  sourceUrl: string | null;
  ratesUsd: Record<string, number | null> | null;
  fromUsd: number | null;
};

export type SupplyProduct = { productKey: string; tool: string | null; operation: string | null; offers: ProductOffer[] };

export type Supply = {
  generatedAt: string;
  policy: Policy | null;
  suppliers: { provider: string; name: string; on: boolean; hasKey: boolean }[];
  models: SupplyModel[];
  products: SupplyProduct[];
};

export const STAGE_INFO: Record<SupplyStage, { label: string; tone: Tone; hint: string }> = {
  serving: { label: "Serving", tone: "success", hint: "The router sends this model's default request here now." },
  standby: { label: "Ready as backup", tone: "info", hint: "Verified and switched on; used when it is the cheapest for a request or the cheaper one is unavailable." },
  routing_off: { label: "Verified · routing off", tone: "info", hint: "Switch routing on for this offer, or run Review routing, to let it serve customers." },
  supplier_off: { label: "Supplier switched off", tone: "neutral", hint: "Switch the supplier on in Providers & balances." },
  needs_test: { label: "Needs a paid test", tone: "attention", hint: "Not verified yet: run one private paid test of this offer, check the result and mark it Verified." },
  needs_key: { label: "Needs an API key", tone: "attention", hint: "Add the supplier's API key in Providers & balances, then test the connection." },
  price_unverified: { label: "Price unverified", tone: "attention", hint: "The published price is missing, conflicting or not confirmed; it is never used to route." },
  needs_integration: { label: "Not integrated", tone: "neutral", hint: "This release cannot send work to this supplier for this product yet." },
};

const USABLE = new Set(["authoritative", "documented", "estimate"]);
/** A price that may be compared (the router ignores conflicting and unverified prices). */
export const usablePrice = (confidence: string | null | undefined) => Boolean(confidence && USABLE.has(confidence));

/** The cheapest quote that beats the current route for the default request, with the saving as a fraction. */
export function cheaperOption(m: SupplyModel): { quote: SupplyQuote; saving: number } | null {
  const base = m.route.usd;
  if (base === null || base <= 0) return null;
  let best: SupplyQuote | null = null;
  for (const q of m.quotes) {
    if (q.current || q.usd === null || q.incompatible || !usablePrice(q.confidence)) continue;
    if (q.usd < base && (!best || q.usd < (best.usd ?? Infinity))) best = q;
  }
  return best ? { quote: best, saving: 1 - (best.usd ?? 0) / base } : null;
}

/** Quotes in display order: the current supplier, then known costs from cheapest, then unknown ones. */
export function orderedQuotes(m: SupplyModel) {
  return [...m.quotes].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.usd === null && b.usd === null) return a.providerName.localeCompare(b.providerName);
    if (a.usd === null) return 1;
    if (b.usd === null) return -1;
    return a.usd - b.usd;
  });
}

/** The product's cheapest usable quote and whether the cheapest supplier changes with the settings. */
export function productCheapest(p: SupplyProduct): { offer: ProductOffer | null; dependsOnSettings: boolean; others: ProductOffer[] } {
  const priced = p.offers.filter((o) => o.fromUsd !== null && usablePrice(o.confidence)).sort((a, b) => (a.fromUsd ?? 0) - (b.fromUsd ?? 0));
  const offer = priced[0] ?? null;
  const winners = p.offers.filter((o) => o.decision === "eligible").length;
  return { offer, dependsOnSettings: winners > 1, others: p.offers.filter((o) => o !== offer) };
}

/** Billing basis as a short unit: "/ image", "/ s", "/ clip". */
export function perUnit(basis: ProductOffer["basis"], tool: string | null) {
  switch (basis) {
    case "output":
      return tool === "video" ? "/ video" : "/ image";
    case "request":
      return tool === "video" ? "/ clip" : "/ request";
    case "output_second":
      return "/ s";
    case "io_second":
      return "/ s (in + out)";
    default:
      return "";
  }
}

/** Display name of a product: the label its cheapest supplier uses, else the first label. */
export const productName = (p: SupplyProduct) => productCheapest(p).offer?.label ?? p.offers[0]?.label ?? p.productKey;

/**
 * A supplier note for a product outside the catalog without its first sentence "No Genlixs … model." (true of every
 * such product); null when nothing else is said.
 */
export function productNote(note: string | null) {
  if (!note) return null;
  const rest = note.replace(/^No Genlixs .*? model(?: \([^)]*\))?(?:[.;]\s*|$)/, "").trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
}

/** Saving as a whole percentage, never rounded to 0 % when there is one. */
export const savingLabel = (fraction: number) => `−${Math.max(1, Math.round(fraction * 100))} %`;
