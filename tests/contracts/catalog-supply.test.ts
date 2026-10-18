// Catalog supply view (Admin › Models, Pricing, Supplier balances): which alternative counts as cheaper, how quotes and
// products are ordered, and the labels shown. Costs themselves are computed in the database (supabase/tests/09).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cheaperOption,
  orderedQuotes,
  perUnit,
  productCheapest,
  productNote,
  savingLabel,
  usablePrice,
  type ProductOffer,
  type SupplyModel,
  type SupplyProduct,
  type SupplyQuote,
} from "../../src/components/live/admin/catalog/supply";

const quote = (over: Partial<SupplyQuote>): SupplyQuote => ({
  offerId: over.provider ?? "x",
  provider: "x",
  providerName: "X",
  legacy: false,
  status: "capabilities_unverified",
  decision: "eligible",
  decisionReason: null,
  blocker: null,
  routingEnabled: false,
  supplierOn: false,
  hasKey: false,
  integrated: true,
  confidence: "documented",
  unit: "usd",
  unitBasis: "fixed",
  incompatible: null,
  native: null,
  usd: null,
  current: false,
  stage: "needs_key",
  ...over,
});

const model = (quotes: SupplyQuote[], routeUsd: number | null): SupplyModel => ({
  id: "m",
  example: { options: {}, mode: null, quantities: { outputs: 1, counts: {}, seconds: {}, promptChars: 100 } },
  defaultUnits: 9,
  route: { status: routeUsd === null ? "unavailable" : "ok", explanation: "", offerId: "kie", provider: "kie", providerName: "KIE", legacy: true, native: null, unit: "kie_credit", usd: routeUsd },
  quotes,
});

test("cheaper option: the cheapest usable, compatible quote below the current cost", () => {
  const m = model(
    [
      quote({ provider: "kie", current: true, usd: 0.09, legacy: true, stage: "serving" }),
      quote({ provider: "nezhagate", usd: 0.02 }),
      quote({ provider: "duomi", usd: 0.0224, unitBasis: "illustrative" }),
      quote({ provider: "apimart", usd: 0.001, confidence: "unverified" }),
      quote({ provider: "poyo", usd: 0.0001, incompatible: 'setting "resolution" is not supported' }),
    ],
    0.09,
  );
  const c = cheaperOption(m);
  assert.equal(c?.quote.provider, "nezhagate");
  assert.ok(Math.abs((c?.saving ?? 0) - (1 - 0.02 / 0.09)) < 1e-12);
});

test("cheaper option: none when nothing beats the current cost or the cost is unknown", () => {
  assert.equal(cheaperOption(model([quote({ provider: "kie", current: true, usd: 0.03 }), quote({ provider: "a", usd: 0.03 }), quote({ provider: "b", usd: 0.05 })], 0.03)), null);
  assert.equal(cheaperOption(model([quote({ provider: "a", usd: 0.01 })], null)), null);
});

test("quotes: the serving supplier first, then known costs from cheapest, unknown last", () => {
  const m = model(
    [quote({ provider: "b", providerName: "B", usd: null }), quote({ provider: "c", usd: 0.5 }), quote({ provider: "kie", current: true, usd: 0.9 }), quote({ provider: "d", usd: 0.1 })],
    0.9,
  );
  assert.deepEqual(orderedQuotes(m).map((q) => q.provider), ["kie", "d", "c", "b"]);
});

const offer = (over: Partial<ProductOffer>): ProductOffer => ({
  offerId: over.provider ?? "o",
  provider: "o",
  providerName: "O",
  label: "Product",
  status: "discovered",
  decision: "dominated",
  decisionReason: null,
  blocker: null,
  integrated: false,
  confidence: "documented",
  unit: "usd",
  unitBasis: "fixed",
  basis: "output_second",
  dims: ["resolution"],
  sourceUrl: null,
  ratesUsd: null,
  fromUsd: null,
  ...over,
});

test("products: one line each, cheapest usable quote first, settings-dependent when several win", () => {
  const p: SupplyProduct = {
    productKey: "wan-3.0",
    tool: "video",
    operation: "text_to_video",
    offers: [
      offer({ provider: "kie", fromUsd: 0.04 }),
      offer({ provider: "nezhagate", fromUsd: 0.04, decision: "eligible", label: "Wan 3.0 (NezhaGate)" }),
      offer({ provider: "apimart", fromUsd: 0.03288, decision: "eligible", label: "Wan 3.0" }),
      offer({ provider: "duomi", fromUsd: 0.001, confidence: "conflicting" }),
    ],
  };
  const r = productCheapest(p);
  assert.equal(r.offer?.provider, "apimart");
  assert.equal(r.dependsOnSettings, true);
  assert.deepEqual(r.others.map((o) => o.provider), ["kie", "nezhagate", "duomi"]);
  assert.equal(productCheapest({ ...p, offers: [offer({ provider: "x", fromUsd: null })] }).offer, null);
});

test("labels: billing units, savings never shown as 0 %, usable prices", () => {
  assert.equal(perUnit("output", "image"), "/ image");
  assert.equal(perUnit("request", "video"), "/ clip");
  assert.equal(perUnit("output_second", "video"), "/ s");
  assert.equal(perUnit("io_second", "video"), "/ s (in + out)");
  assert.equal(savingLabel(0.004), "−1 %");
  assert.equal(savingLabel(0.7778), "−78 %");
  assert.equal(usablePrice("estimate"), true);
  assert.equal(usablePrice("unverified"), false);
  assert.equal(usablePrice(null), false);
});

test("product notes drop the 'No Genlixs … model.' sentence and keep the rest", () => {
  assert.equal(productNote("No Genlixs FLUX.1 Kontext model."), null);
  assert.equal(productNote("No Genlixs GPT Image 2 model. Delivered 4K is resized; not native 4096 px."), "Delivered 4K is resized; not native 4096 px.");
  assert.equal(productNote("No Genlixs Grok Video model; exact version, duration and audio contract not verified."), "Exact version, duration and audio contract not verified.");
  assert.equal(productNote("No Genlixs Seedance Mini model (kept separate from Fast and standard)."), null);
  assert.equal(productNote("Restricted fixed 30-second product; not a per-second route for other lengths."), "Restricted fixed 30-second product; not a per-second route for other lengths.");
  assert.equal(productNote(null), null);
});
