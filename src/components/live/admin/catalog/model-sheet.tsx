"use client";

import type { ReactNode } from "react";
import { ArrowRight, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/format";
import { money, UNIT_LABEL } from "../providers/parts";
import { configLabel, fmtMarkup, range, STATE_INFO } from "./shared";
import { orderedQuotes, STAGE_INFO, usablePrice, type SupplyModel } from "./supply";
import { SavingTag, StageBadge, SupplierMark, TYPE_LABEL } from "./supply-parts";
import type { Access, AdminModel } from "./types";

const CONFIDENCE: Record<string, string> = {
  authoritative: "Confirmed by the supplier",
  documented: "Published price",
  estimate: "Supplier estimate",
  conflicting: "Conflicting prices",
  unverified: "Unverified price",
};

/**
 * One model, every supplier: the default request's cost at each supplier that sells this model, which one serves it
 * now, and the first step missing for each of the others. Customers keep seeing this model once.
 */
export function ModelSheet({
  model: m,
  supply: s,
  access,
  creditUsd,
  onClose,
  onTechnical,
}: {
  model: AdminModel;
  supply: SupplyModel | null;
  access: Access;
  creditUsd: number | null;
  onClose: () => void;
  onTechnical: () => void;
}) {
  const state = STATE_INFO[m.state];
  const p = m.pricing;
  const priced = Boolean(p.published?.currentCapability) && p.minUnits !== null;
  const settings = s ? configLabel(m.capability.spec, s.example.options) : null;
  const defaultPriceUsd = s?.defaultUnits !== null && s?.defaultUnits !== undefined && creditUsd !== null ? s.defaultUnits * creditUsd : null;
  const routeUsd = s?.route.usd ?? null;
  const defaultMargin = defaultPriceUsd !== null && routeUsd ? defaultPriceUsd / routeUsd - 1 : null;
  const quotes = s ? orderedQuotes(s) : [];

  return (
    <Dialog
      open
      onClose={onClose}
      surface="light"
      size="xl"
      title={m.name}
      description={
        <>
          {TYPE_LABEL[m.tool]}
          {m.family ? ` · ${m.family}` : ""}
          {m.variant ? ` ${m.variant}` : ""} — customers see this model once; Genlixs chooses the supplier for every request.
        </>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost-light" size="sm" icon={<Settings2 aria-hidden className="size-4" />} onClick={onTechnical}>
            Technical details and tests
          </Button>
          <div className="flex flex-wrap gap-2">
            {access.canReadProvider ? (
              <ButtonLink href={`/admin/providers?tab=models&model=${encodeURIComponent(m.id)}`} variant="secondary-light" size="sm">
                Compare other settings
              </ButtonLink>
            ) : null}
            {access.canSeeCosts ? (
              <ButtonLink href={`/admin/pricing?model=${encodeURIComponent(m.id)}`} variant="primary" size="sm" icon={<ArrowRight aria-hidden className="size-4" />}>
                {access.canPrice ? (priced ? "Edit price" : "Set price") : "View price"}
              </ButtonLink>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="For customers">
            <Badge surface="light" tone={state.tone}>
              {state.label}
            </Badge>
          </Fact>
          <Fact label="Served by">
            {s?.route.provider && s.route.providerName ? (
              <SupplierMark provider={s.route.provider} name={s.route.providerName} />
            ) : (
              <span className="text-sm font-semibold text-error-text">{s ? "No supplier can take the default request" : "—"}</span>
            )}
          </Fact>
          <Fact label="Customer price">
            {priced ? (
              <>
                <span className="font-semibold tabular">{range(p.minUnits, p.maxUnits, (n) => `${n}`)} credits</span>
                {creditUsd !== null ? (
                  <span className="block text-xs text-muted-dark tabular">{range(p.minUnits! * creditUsd, p.maxUnits! * creditUsd, (n) => money(n))}</span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-dark">Not priced</span>
            )}
          </Fact>
          {access.canSeeCosts ? (
            <Fact label="Margin over supplier cost">
              {priced && p.markupMin !== null && p.markupMin !== undefined ? (
                <>
                  <span className={cn("font-semibold tabular", p.belowCost ? "text-error-text" : "text-ink-dark")}>
                    {range(p.markupMin * 100, (p.markupMax ?? p.markupMin) * 100, fmtMarkup)}
                  </span>
                  <span className="block text-xs text-muted-dark">{p.belowCost ? `${p.belowCost} setting(s) below cost` : "every setting above cost"}</span>
                </>
              ) : (
                <span className="text-sm text-muted-dark">—</span>
              )}
            </Fact>
          ) : null}
        </dl>

        {s ? (
          <section aria-labelledby="sheet-suppliers" className="space-y-3">
            <div>
              <h3 id="sheet-suppliers" className="text-base font-semibold text-ink-dark">
                Suppliers for the default request
              </h3>
              <p className="text-sm text-muted-dark">
                {settings}
                {access.canSeeCosts && routeUsd !== null && defaultPriceUsd !== null ? (
                  <>
                    {" "}
                    · customer pays <span className="font-semibold text-ink-dark tabular">{money(defaultPriceUsd)}</span> ({s.defaultUnits} credits) · cost now{" "}
                    <span className="font-semibold text-ink-dark tabular">{money(routeUsd)}</span>
                    {defaultMargin !== null ? (
                      <>
                        {" "}
                        · margin <span className={cn("font-semibold tabular", defaultMargin < 0 ? "text-error-text" : "text-ink-dark")}>{fmtMarkup(defaultMargin * 100)}</span>
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>
            </div>
            {/* Focusable so keyboard users can scroll the quotes (and the sheet) on any screen size. */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="sheet-suppliers"
              className="relative overflow-x-auto rounded-xl border border-rule focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Supplier</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Cost</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Against now</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Price evidence</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Next step</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {quotes.map((q) => {
                    const delta = !q.current && q.usd !== null && routeUsd ? q.usd / routeUsd - 1 : null;
                    return (
                      <tr key={q.offerId} className={cn(q.current && "bg-info-tint/40")}>
                        <th scope="row" className="px-4 py-3 align-top font-normal">
                          <SupplierMark provider={q.provider} name={q.providerName} />
                          {q.legacy ? <span className="mt-1 block text-[11px] text-muted-dark">Original route</span> : null}
                        </th>
                        <td className="px-3 py-3 text-right align-top tabular">
                          {q.incompatible && !q.integrated ? (
                            <span className="text-xs text-muted-dark">Not compared</span>
                          ) : q.incompatible ? (
                            <span className="text-xs text-muted-dark" title={q.incompatible}>
                              Not offered with these settings
                            </span>
                          ) : q.usd === null ? (
                            <span className="text-xs text-muted-dark">No price</span>
                          ) : (
                            <span className="font-semibold text-ink-dark">{money(q.usd)}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          {q.current ? (
                            <span className="text-xs font-semibold text-success-text">Serving now</span>
                          ) : delta === null ? (
                            <span className="text-xs text-muted-dark">—</span>
                          ) : delta < 0 ? (
                            <SavingTag fraction={-delta} />
                          ) : (
                            <span className="text-xs text-muted-dark tabular">{delta === 0 ? "Same cost" : `+${Math.round(delta * 100)} % dearer`}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top text-xs text-muted-dark">
                          {q.confidence ? CONFIDENCE[q.confidence] ?? q.confidence : "No price"}
                          {q.unit ? <span className="block">{UNIT_LABEL[q.unit] ?? q.unit}</span> : null}
                          {q.unitBasis === "illustrative" ? (
                            <span className="mt-0.5 block font-semibold text-orange-text">Exchange rate is illustrative</span>
                          ) : null}
                          {!usablePrice(q.confidence) && q.confidence ? <span className="block">Never used to route</span> : null}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <StageBadge stage={q.stage} />
                          {!q.current && (q.blocker || q.incompatible) ? (
                            <p className="mt-1 max-w-[18rem] text-[11px] leading-snug text-muted-dark">{q.incompatible && !q.integrated
                                ? `${q.blocker ?? "No integration in this release"}; its supported settings are not recorded yet.`
                                : q.incompatible
                                  ? `Default settings: ${q.incompatible}.`
                                  : q.blocker}</p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-muted-dark">
              Costs are each supplier&apos;s published price for exactly this request, converted to US dollars with the supplier&apos;s funding terms. A
              supplier serves customers only after its API key is saved, one paid test of this model passes and routing is switched on; from then on every
              request goes to the cheapest one that supports its settings, with no change for customers.
            </p>
            <ul className="grid gap-1 text-[11px] text-muted-dark sm:grid-cols-2">
              {(["needs_key", "needs_test", "routing_off", "needs_integration"] as const).map((k) => (
                <li key={k}>
                  <span className="font-semibold text-ink-dark">{STAGE_INFO[k].label}:</span> {STAGE_INFO[k].hint}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-sm text-muted-dark">Supplier quotes are visible to staff who can read suppliers (owner, operations and finance).</p>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-rule bg-paper/60 px-3.5 py-3">
      <dt className="text-xs font-semibold text-muted-dark">{label}</dt>
      <dd className="mt-1 text-sm text-ink-dark">{children}</dd>
    </div>
  );
}
