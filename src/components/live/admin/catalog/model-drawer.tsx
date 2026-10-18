"use client";

import type { ReactNode } from "react";
import { ChevronDown, ExternalLink, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/format";
import { money, UNIT_LABEL } from "../providers/parts";
import type { DiagnosticsSection } from "./diagnostics";
import { KIND_SINGLE, modelKind, type Policy } from "./policy";
import { configLabel, day, fmtMarkup, fmtRate, Notice, range, STATE_INFO } from "./shared";
import { orderedQuotes, STAGE_INFO, usablePrice, type SupplyModel, type SupplyQuote } from "./supply";
import { SavingTag, StageBadge, SupplierMark } from "./supply-parts";
import type { Access, AdminModel } from "./types";

/**
 * One model: how its price is set (KIE reference → markup → whole Genlixs credits), who serves it now and at what cost,
 * cheaper offers that are not serving yet (kept apart from the serving one), and what blocks it. Every number comes
 * from the database; nothing here changes a price.
 */
export function ModelDrawer({
  model: m,
  supply: s,
  policy,
  access,
  onClose,
  onTechnical,
}: {
  model: AdminModel;
  supply: SupplyModel | null;
  policy: Policy | null;
  access: Access;
  onClose: () => void;
  onTechnical: (section: DiagnosticsSection) => void;
}) {
  const state = STATE_INFO[m.state];
  const p = m.pricing;
  const priced = Boolean(p.published?.currentCapability) && p.minUnits !== null;
  const v = policy?.usdPerCredit ?? null;
  const pr = s?.pricing ?? null;
  const settings = s ? configLabel(m.capability.spec, s.example.options) : null;
  const blockers = m.readiness.checks.filter((c) => !c.ok && !c.warning);
  const quotes = s ? orderedQuotes(s) : [];
  const serving = quotes.find((q) => q.current) ?? null;
  const routeUsd = s?.route.usd ?? null;
  const cheaper = quotes.filter((q) => !q.current && q.usd !== null && !q.incompatible && usablePrice(q.confidence) && routeUsd !== null && q.usd < routeUsd);
  const others = quotes.filter((q) => !q.current && !cheaper.includes(q));
  const kieUsd = pr?.kieUsd ?? null;
  const saving = kieUsd !== null && routeUsd !== null && routeUsd < kieUsd ? kieUsd - routeUsd : null;
  const rounded = pr?.chargedUsd !== null && pr?.chargedUsd !== undefined && pr.targetUsd !== null && pr.chargedUsd > pr.targetUsd;

  return (
    <Dialog
      open
      onClose={onClose}
      surface="light"
      size="xl"
      title={m.name}
      description={
        <>
          {KIND_SINGLE[modelKind(m)]}
          {m.family && m.family !== m.name ? ` · ${m.family}${m.variant ? ` ${m.variant}` : ""}` : ""} — customers see this model once; Genlixs picks the
          supplier for every request.
        </>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost-light" size="sm" icon={<Settings2 aria-hidden className="size-4" />} onClick={() => onTechnical("status")}>
            Technical details and tests
          </Button>
          {access.canReadProvider ? (
            <ButtonLink href={`/admin/providers?routing=${encodeURIComponent(m.id)}`} variant="secondary-light" size="sm">
              Routing details
            </ButtonLink>
          ) : null}
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
          <Fact label={s ? "Customer price · example" : "Customer price"}>
            {s?.defaultUnits !== null && s?.defaultUnits !== undefined ? (
              <>
                <span className="font-semibold tabular">{s.defaultUnits} credits</span>
                {pr?.chargedUsd !== null && pr?.chargedUsd !== undefined ? <span className="block text-xs text-muted-dark tabular">{money(pr.chargedUsd)}</span> : null}
              </>
            ) : priced ? (
              <span className="font-semibold tabular">{range(p.minUnits, p.maxUnits, (n) => `${n}`)} credits</span>
            ) : (
              <span className="text-sm font-semibold text-orange-text">Not priced</span>
            )}
          </Fact>
          <Fact label="Serving now">
            {s?.route.provider && s.route.providerName ? (
              <>
                <SupplierMark provider={s.route.provider} name={s.route.providerName} />
                {access.canSeeCosts ? <span className="mt-1 block text-xs text-muted-dark tabular">costs {money(routeUsd, "unknown")}</span> : null}
              </>
            ) : (
              <span className="text-sm font-semibold text-error-text">{s ? "No supplier can take this request" : "—"}</span>
            )}
          </Fact>
          {access.canSeeCosts ? (
            <Fact label="Effective markup">
              <span className={cn("font-semibold tabular", (s?.route.effectiveMarkupPct ?? 0) < 0 ? "text-error-text" : "text-ink-dark")}>
                {fmtMarkup(s?.route.effectiveMarkupPct)}
              </span>
              <span className="block text-xs text-muted-dark">on the serving supplier&apos;s cost</span>
            </Fact>
          ) : null}
        </dl>

        {pr?.status === "kie_reference_needed" ? (
          <Notice
            tone="attention"
            title="KIE reference needed"
            action={
              access.canSeeCosts ? (
                <Button size="sm" variant="secondary-light" onClick={() => onTechnical("cost")}>
                  Open KIE price list
                </Button>
              ) : undefined
            }
          >
            This model has no KIE price for its settings, so it is not priced and cannot be switched on. Another supplier&apos;s price is never used instead.
          </Notice>
        ) : pr?.status === "partial" ? (
          <Notice tone="attention" title="Some settings have no KIE reference">
            {pr.reason}. Customers cannot buy those settings until the KIE price list covers them.
          </Notice>
        ) : null}

        {s && access.canSeeCosts && pr && pr.status !== "kie_reference_needed" ? (
          <section aria-labelledby="drawer-price" className="space-y-2">
            <h3 id="drawer-price" className="text-base font-semibold text-ink-dark">
              How the price is set
            </h3>
            <p className="text-sm text-muted-dark">Example request: {settings}</p>
            <ol className="divide-y divide-rule rounded-xl border border-rule text-sm">
              <Step label="KIE reference (B)" value={money(kieUsd, "unknown")}>
                {pr.cost ? (
                  <>
                    KIE price list v{pr.cost.version} · {pr.cost.sourceKind} · checked {day(pr.cost.checkedAt)}
                    {pr.cost.sourceUrl ? (
                      <>
                        {" · "}
                        <a href={pr.cost.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-info-text underline">
                          source <ExternalLink aria-hidden className="size-3" />
                        </a>
                      </>
                    ) : null}
                  </>
                ) : null}
              </Step>
              <Step label={`Target at ${fmtMarkup(policy?.markupPercent)}`} value={money(pr.targetUsd, "unknown")}>
                B × {policy ? Number((1 + policy.markupPercent / 100).toFixed(4)) : "—"}
              </Step>
              <Step
                label="Customer pays"
                value={s.defaultUnits !== null ? `${s.defaultUnits} cr · ${money(pr.chargedUsd, "—")}` : "—"}
                strong
              >
                {v !== null ? `at ${fmtRate(v)} per Genlixs credit` : ""}
                {rounded ? " · rounded up to whole credits for the request" : ""}
              </Step>
              <Step label={`Serving cost (C)${s.route.providerName ? ` · ${s.route.providerName}` : ""}`} value={money(routeUsd, "unknown")}>
                {s.route.native !== null && s.route.unit && s.route.unit !== "usd"
                  ? `${s.route.native.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${UNIT_LABEL[s.route.unit] ?? s.route.unit}, funding terms applied`
                  : "funding terms applied"}
              </Step>
              <Step label="Effective markup" value={fmtMarkup(s.route.effectiveMarkupPct)}>
                (charged − C) ÷ C, before payment fees and partner commission
                {saving !== null ? ` · ${money(saving)} below the KIE reference, kept by Genlixs` : ""}
              </Step>
            </ol>
            <p className="text-xs text-muted-dark">
              {priced ? `${p.configCount} setting${p.configCount === 1 ? "" : "s"}, ${range(p.minUnits, p.maxUnits, (n) => `${n}`)} credits` : "Not priced"}
              {pr.priceVersion ? ` · price v${pr.priceVersion}` : ""}
              {pr.policyVersion ? ` (pricing policy v${pr.policyVersion})` : ""}
              {pr.followsPolicy ? " · follows the current policy" : pr.priceVersion ? " · waiting for Save & apply" : ""}
            </p>
          </section>
        ) : null}

        {s ? (
          <section aria-labelledby="drawer-suppliers" className="space-y-3">
            <h3 id="drawer-suppliers" className="text-base font-semibold text-ink-dark">
              Suppliers for this request
            </h3>
            {serving ? (
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-dark uppercase">Serving customers now</p>
                <ul className="mt-1.5 rounded-xl border border-[#c7cefd] bg-info-tint/30">
                  <QuoteRow q={serving} showCosts={access.canSeeCosts} />
                </ul>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-dark uppercase">Cheaper offers, not serving yet</p>
              {cheaper.length ? (
                <ul className="mt-1.5 divide-y divide-rule rounded-xl border border-rule">
                  {cheaper.map((q) => (
                    <QuoteRow key={q.offerId} q={q} showCosts={access.canSeeCosts} base={routeUsd} />
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-dark">None: the serving supplier has the lowest known cost for this request.</p>
              )}
            </div>
            {others.length ? (
              <details className="group rounded-xl border border-rule">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-semibold text-ink-dark [&::-webkit-details-marker]:hidden">
                  Other offers ({others.length})
                  <ChevronDown aria-hidden className="size-4 text-muted-dark transition-transform group-open:rotate-180" />
                </summary>
                <ul className="divide-y divide-rule border-t border-rule">
                  {others.map((q) => (
                    <QuoteRow key={q.offerId} q={q} showCosts={access.canSeeCosts} base={routeUsd} />
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-dark">
              A cheaper offer starts serving only after its API key is saved, one paid test passes and routing is switched on. The customer price stays the
              same; the saving raises the effective markup.
            </p>
          </section>
        ) : (
          <p className="text-sm text-muted-dark">Suppliers are visible to staff who can read them (owner, operations and finance).</p>
        )}

        {blockers.length ? (
          <section aria-labelledby="drawer-blockers" className="space-y-2">
            <h3 id="drawer-blockers" className="text-base font-semibold text-ink-dark">
              What blocks this model
            </h3>
            <ul className="divide-y divide-rule rounded-xl border border-[#f3d9a8] bg-orange-tint/40 text-sm">
              {blockers.map((c) => (
                <li key={c.key} className="px-4 py-2.5">
                  <span className="font-semibold text-ink-dark">{c.label}:</span> <span className="text-muted-dark">{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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

function Step({ label, value, strong, children }: { label: string; value: string; strong?: boolean; children?: ReactNode }) {
  return (
    <li className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-baseline">
      <span className="font-semibold text-ink-dark">{label}</span>
      <span className="min-w-0 text-xs text-muted-dark sm:order-none">{children}</span>
      <span className={cn("tabular sm:text-right", strong ? "font-bold text-ink-dark" : "font-semibold text-ink-dark")}>{value}</span>
    </li>
  );
}

function QuoteRow({ q, showCosts, base }: { q: SupplyQuote; showCosts: boolean; base?: number | null }) {
  const delta = !q.current && q.usd !== null && base ? q.usd / base - 1 : null;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-3">
      <div className="min-w-0">
        <SupplierMark provider={q.provider} name={q.providerName} />
        {!q.current ? (
          <p className="mt-1 max-w-md text-xs text-muted-dark">
            {q.incompatible && !q.integrated
              ? `${(q.blocker ?? "No integration in this release").replace(/\.\s*$/, "")}; its supported settings are not recorded yet.`
              : q.incompatible
                ? `Not offered with these settings (${q.incompatible}).`
                : STAGE_INFO[q.stage].hint}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
        {showCosts ? (
          <span className="font-semibold text-ink-dark tabular">{q.incompatible ? "—" : q.usd === null ? "No price" : money(q.usd)}</span>
        ) : null}
        {delta !== null && delta < 0 ? <SavingTag fraction={-delta} /> : null}
        {showCosts && !q.current && q.markupIfServedPct !== null && !q.incompatible ? (
          <span className="text-xs text-muted-dark tabular">{fmtMarkup(q.markupIfServedPct)} if it served</span>
        ) : null}
        {q.current ? (
          <Badge surface="light" tone="success">
            Serving
          </Badge>
        ) : (
          <StageBadge stage={q.stage} />
        )}
      </div>
    </li>
  );
}
