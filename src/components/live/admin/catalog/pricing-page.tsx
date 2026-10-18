"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, CircleDollarSign, Percent, RefreshCw, TriangleAlert } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/live/account";
import { dec, toNumber } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { money, UNIT_LABEL } from "../providers/parts";
import type { ProvidersOverview } from "../providers/types";
import { BulkMarkup } from "./bulk-markup";
import { PackagesEditor } from "./packages-editor";
import { PriceEditor } from "./price-editor";
import { ReferenceCards } from "./references";
import { day, Empty, fmtMarkup, fmtRate, Notice, range, Tabs, Wrap } from "./shared";
import type { Supply, SupplyModel } from "./supply";
import { GroupRow, Kpi, SearchBox, Segmented, SupplierMark, TYPE_GROUP, TYPE_ORDER } from "./supply-parts";
import type { AdminModel, CatalogData } from "./types";

type Filter = "all" | "image" | "edit" | "video";
type Section = "prices" | "packages" | "references";
const SECTIONS: Section[] = ["prices", "packages", "references"];

/**
 * Pricing & packages: what customers pay for each model in Genlixs credits, what the same work costs Genlixs at the
 * supplier serving it, the packages customers buy, and the reference values behind both. Genlixs credits and supplier
 * units are separate throughout; prices change only when staff save them.
 */
export function PricingPage() {
  const c = useApi<CatalogData>("/api/admin/catalog");
  const canReadProvider = Boolean(c.data?.access.canReadProvider);
  const supply = useApi<Supply>(canReadProvider ? "/api/admin/catalog/supply" : null, [canReadProvider]);
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const editing = sp.get("model");
  const linked = sp.get("tab") as Section | null;
  const section: Section = linked && SECTIONS.includes(linked) ? linked : "prices";
  const overview = useApi<ProvidersOverview>(canReadProvider && section === "references" ? "/api/admin/providers/overview" : null, [canReadProvider, section]);
  const [bulk, setBulk] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const setParam = (key: string, value: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (value) n.set(key, value);
    else n.delete(key);
    router.replace(`${pathname}${n.size ? `?${n}` : ""}`, { scroll: false });
  };

  const supplyById = useMemo(() => new Map((supply.data?.models ?? []).map((s) => [s.id, s])), [supply.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (c.data?.models ?? []).filter(
      (m) => (filter === "all" || m.tool === filter) && (!term || [m.name, m.family ?? "", m.variant ?? ""].some((s) => s.toLowerCase().includes(term))),
    );
  }, [c.data, filter, q]);

  if (c.error && !c.data) {
    return (
      <Wrap>
        <Notice tone="error" title="Pricing could not load" action={<Button size="sm" variant="secondary-light" onClick={c.reload}>Try again</Button>}>
          {c.error.message}
        </Notice>
      </Wrap>
    );
  }
  if (!c.data) {
    return (
      <Wrap>
        <div role="status" aria-busy="true" aria-label="Loading pricing" className="h-64 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      </Wrap>
    );
  }
  const d = c.data;
  if (!d.access.canSeeCosts || !d.references) {
    return (
      <Wrap>
        <PageHead title="Pricing & packages" />
        <Notice>Your role cannot see costs and prices. Finance staff and the owner manage them.</Notice>
      </Wrap>
    );
  }
  const credit = d.references.credit;
  const creditRate = credit ? dec(credit.usdPerCredit) : null;
  const rate = creditRate ? toNumber(creditRate) : null;
  const pricedModels = d.models.filter((m) => m.pricing.published?.currentCapability && m.pricing.minUnits !== null);
  const drafts = d.models.filter((m) => m.pricing.draft?.currentCapability).length;
  const markups = pricedModels.flatMap((m) => [m.pricing.markupMin, m.pricing.markupMax]).filter((x): x is number => x !== null && x !== undefined);
  const belowCost = pricedModels.reduce((n, m) => n + (m.pricing.belowCost ?? 0), 0);
  const offered = d.products.filter((p) => p.state === "published").length;
  const byType = TYPE_ORDER.map((t) => d.models.filter((m) => m.tool === t).length);

  return (
    <Wrap>
      <PageHead
        title="Pricing & packages"
        sub={
          <span className="block max-w-3xl">
            What customers pay in Genlixs credits, what the same work costs Genlixs at the supplier serving it, and the packages customers buy. Every change is
            recorded in the audit log.
          </span>
        }
        actions={
          <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => { c.reload(); if (canReadProvider) supply.reload(); }} busy={c.loading}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={CircleDollarSign}
          label="Genlixs credit value"
          value={credit ? fmtRate(credit.usdPerCredit) : "—"}
          suffix="per credit"
          sub={credit ? `${money(credit.amountUsd)} for ${credit.credits.toLocaleString("en-US")} credits · set ${day(credit.createdAt)}` : "Not set yet"}
        />
        <Kpi
          icon={BadgeCheck}
          label="Models with a price"
          value={pricedModels.length}
          suffix={`of ${d.models.length}`}
          sub={drafts ? `${drafts} draft price(s) waiting to be published` : "No draft waiting"}
          tone={pricedModels.length === d.models.length ? "good" : "warn"}
        />
        <Kpi
          icon={Percent}
          label="Margin over supplier cost"
          value={markups.length ? fmtMarkup(Math.min(...markups) * 100) : "—"}
          suffix={markups.length && Math.max(...markups) > Math.min(...markups) ? `to ${fmtMarkup(Math.round(Math.max(...markups) * 100))}` : undefined}
          sub="Lowest and highest across every priced setting"
        />
        <Kpi
          icon={TriangleAlert}
          label="Settings below cost"
          value={belowCost}
          suffix={belowCost === 1 ? "setting" : "settings"}
          sub={belowCost ? "Customers pay less than the supplier charges for these" : "Every priced setting is above its supplier cost"}
          tone={belowCost ? "bad" : "good"}
        />
      </div>

      <Tabs<Section>
        label="Pricing sections"
        value={section}
        onChange={(s) => setParam("tab", s === "prices" ? null : s)}
        tabs={[
          { id: "prices", label: "Model prices", count: d.models.length },
          { id: "packages", label: "Packages", count: offered },
          { id: "references", label: "Reference values" },
        ]}
      />

      {section === "prices" ? (
        <section aria-label="Model prices" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Segmented<Filter>
                label="Model type"
                value={filter}
                onChange={setFilter}
                options={[
                  { id: "all", label: "All", count: d.models.length },
                  { id: "image", label: "Images", count: byType[0] },
                  { id: "edit", label: "Image edit", count: byType[1] },
                  { id: "video", label: "Videos", count: byType[2] },
                ]}
              />
              <SearchBox value={q} onChange={setQ} label="Search models" />
            </div>
            {d.access.canPrice ? (
              <Button size="sm" variant="secondary-light" onClick={() => setBulk(true)}>
                Apply a markup to several models
              </Button>
            ) : null}
          </div>
          <Panel bodyClass="p-0">
            {rows.length === 0 ? (
              <div className="p-5">
                <Empty>No model matches this search.</Empty>
              </div>
            ) : (
              <>
              <div className="relative hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <caption className="sr-only">Customer price, supplier cost and margin of each model across its settings</caption>
                  <thead className="border-b border-rule text-xs whitespace-nowrap text-muted-dark">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Model</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Customer price</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Customer pays</th>
                      <th scope="col" className="px-3 py-3 font-semibold">Supplier cost</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">Margin</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold sm:px-5">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  {TYPE_ORDER.map((t) => {
                    const group = rows.filter((m) => m.tool === t);
                    if (!group.length) return null;
                    return (
                      <tbody key={t} className="divide-y divide-rule">
                        <GroupRow label={TYPE_GROUP[t]} count={group.length} colSpan={6} />
                        {group.map((m) => (
                          <PriceRow key={m.id} m={m} sup={supplyById.get(m.id) ?? null} rate={rate} canPrice={d.access.canPrice} onEdit={() => setParam("model", m.id)} />
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
              <ul className="divide-y divide-rule xl:hidden">
                {rows.map((m) => (
                  <PriceCard key={m.id} m={m} sup={supplyById.get(m.id) ?? null} rate={rate} canPrice={d.access.canPrice} onEdit={() => setParam("model", m.id)} />
                ))}
              </ul>
              </>
            )}
          </Panel>
          <p className="text-xs leading-relaxed text-muted-dark">
            Ranges run from the cheapest to the most expensive setting of each model. Customer pays = credits × the credit value. Supplier cost is the cost at
            the supplier that serves the model now; when a cheaper supplier starts serving a model, its margin rises — customer prices never change by
            themselves.
          </p>
        </section>
      ) : section === "packages" ? (
        <section aria-label="Packages" className="space-y-3">
          <p className="max-w-3xl text-sm text-muted-dark">
            The credit packs customers can buy. Each one is compared with the Genlixs credit value, so a discount is visible before it is offered.
          </p>
          <PackagesEditor
            products={d.products}
            reference={creditRate}
            canEdit={d.access.canPrice}
            canPublish={d.access.canPublish}
            promotions={d.promotions}
            onSaved={c.reload}
          />
        </section>
      ) : (
        <section aria-label="Reference values" className="space-y-4">
          <ReferenceCards
            kie={d.references.kie}
            credit={credit}
            canEdit={d.access.canPrice}
            pricedModels={pricedModels.length}
            onSaved={c.reload}
            onRecalculate={() => {
              setParam("tab", null);
              setBulk(true);
            }}
          />
          {canReadProvider ? <SupplierUnits o={overview.data} loading={overview.loading} /> : null}
        </section>
      )}

      {editing ? <PriceEditor modelId={editing} products={d.products} onClose={() => setParam("model", null)} onSaved={c.reload} /> : null}
      {bulk ? <BulkMarkup data={d} onClose={() => setBulk(false)} onSaved={c.reload} /> : null}
    </Wrap>
  );
}

type PriceProps = { m: AdminModel; sup: SupplyModel | null; rate: number | null; onEdit: () => void; canPrice: boolean };

/** One model's price facts across its settings, shared by the table row and the narrow-screen card. */
function priceFacts(m: AdminModel, sup: SupplyModel | null, rate: number | null) {
  const p = m.pricing;
  const priced = Boolean(p.published?.currentCapability) && p.minUnits !== null;
  const cost = m.cost;
  const costKnown = cost?.complete ?? false;
  const costMin = cost?.minCredits !== null && cost?.minCredits !== undefined ? cost.minCredits * cost.usdPerCredit : null;
  const costMax = cost?.maxCredits !== null && cost?.maxCredits !== undefined ? cost.maxCredits * cost.usdPerCredit : null;
  const route = sup?.route ?? null;
  return {
    p,
    priced,
    costKnown,
    stale: Boolean(cost?.stale),
    price: priced ? `${range(p.minUnits, p.maxUnits, (n) => `${n}`)} cr` : null,
    pays: priced && rate !== null ? range(p.minUnits! * rate, p.maxUnits! * rate, (n) => money(n)) : null,
    cost: costKnown || costMin !== null ? range(costMin, costMax, (n) => money(n)) : null,
    margin: priced && p.markupMin !== null && p.markupMin !== undefined ? range(p.markupMin * 100, (p.markupMax ?? p.markupMin) * 100, fmtMarkup) : null,
    route,
    // The cost ranges come from the model's original (KIE) cost table; say so when another supplier serves it now.
    elsewhere: route?.provider && route.provider !== "kie" && route.providerName ? `Range from the KIE cost table; ${route.providerName} serves the default request at ${money(route.usd)}.` : null,
  };
}

function PriceTags({ p }: { p: AdminModel["pricing"] }) {
  return (
    <>
      <span>
        {p.configCount} setting{p.configCount === 1 ? "" : "s"}
        {p.published ? ` · price v${p.published.version}` : ""}
      </span>
      {p.draft?.currentCapability ? (
        <Badge surface="light" tone="info" className="h-5 px-2 text-[11px]">
          Draft waiting
        </Badge>
      ) : null}
      {p.override ? (
        <Badge surface="light" tone="neutral" className="h-5 px-2 text-[11px]">
          Manual price
        </Badge>
      ) : null}
    </>
  );
}

function EditButton({ f, canPrice, onEdit }: { f: ReturnType<typeof priceFacts>; canPrice: boolean; onEdit: () => void }) {
  return (
    <Button size="sm" variant={f.priced || !canPrice ? "secondary-light" : "primary"} disabled={!f.costKnown && !f.priced} onClick={onEdit}>
      {canPrice ? (f.priced ? "Edit price" : "Set price") : "View price"}
    </Button>
  );
}

function PriceRow({ m, sup, rate, onEdit, canPrice }: PriceProps) {
  const f = priceFacts(m, sup, rate);
  return (
    <tr className="align-top transition-colors hover:bg-paper/60">
      <td className="px-4 py-3.5 sm:px-5">
        <button type="button" onClick={onEdit} className="text-left font-semibold text-ink-dark hover:text-brand-blue hover:underline">
          {m.name}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-dark">
          <PriceTags p={f.p} />
        </div>
      </td>
      <td className="px-3 py-3.5 text-right tabular">
        {f.price ? <span className="font-semibold text-ink-dark">{f.price}</span> : <span className="text-xs font-semibold text-orange-text">Not priced</span>}
      </td>
      <td className="px-3 py-3.5 text-right text-ink-dark tabular">{f.pays ?? "—"}</td>
      <td className="px-3 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-dark tabular">{f.cost ?? "Unknown"}</span>
          {f.route?.provider && f.route.providerName ? <SupplierMark provider={f.route.provider} name={f.route.providerName} quiet /> : null}
        </div>
        {f.elsewhere ? <p className="mt-1 text-[11px] text-muted-dark">{f.elsewhere}</p> : null}
        {f.stale ? <p className="mt-1 text-[11px] font-semibold text-orange-text">Cost evidence is old — check it</p> : null}
      </td>
      <td className="px-3 py-3.5 text-right tabular">
        {f.margin ? (
          <>
            <span className={cn("font-semibold", f.p.belowCost ? "text-error-text" : "text-ink-dark")}>{f.margin}</span>
            {f.p.belowCost ? <span className="block text-[11px] font-semibold text-error-text">{f.p.belowCost} below cost</span> : null}
          </>
        ) : (
          <span className="text-muted-dark">—</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-right sm:px-5">
        <EditButton f={f} canPrice={canPrice} onEdit={onEdit} />
      </td>
    </tr>
  );
}

function PriceCard({ m, sup, rate, onEdit, canPrice }: PriceProps) {
  const f = priceFacts(m, sup, rate);
  const cell = "min-w-0";
  return (
    <li className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink-dark">{m.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-dark">
            <PriceTags p={f.p} />
          </div>
        </div>
        <EditButton f={f} canPrice={canPrice} onEdit={onEdit} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div className={cell}>
          <dt className="text-muted-dark">Customer price</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{f.price ?? "Not priced"}</dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-dark">Customer pays</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{f.pays ?? "—"}</dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-dark">Supplier cost{f.route?.providerName ? ` · ${f.route.providerName}` : ""}</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{f.cost ?? "Unknown"}</dd>
        </div>
        <div className={cell}>
          <dt className="text-muted-dark">Margin</dt>
          <dd className={cn("mt-0.5 font-semibold tabular", f.p.belowCost ? "text-error-text" : "text-ink-dark")}>
            {f.margin ?? "—"}
            {f.p.belowCost ? ` · ${f.p.belowCost} below cost` : ""}
          </dd>
        </div>
      </dl>
      {f.elsewhere ? <p className="text-[11px] text-muted-dark">{f.elsewhere}</p> : null}
      {f.stale ? <p className="text-[11px] font-semibold text-orange-text">Cost evidence is old — check it</p> : null}
    </li>
  );
}

/** How each supplier's own unit converts to US dollars (used by the router to compare suppliers). */
function SupplierUnits({ o, loading }: { o: ProvidersOverview | null; loading: boolean }) {
  return (
    <Panel title="Supplier currencies" bodyClass="p-0" action={<Link href="/admin/providers?tab=providers" className="text-sm font-semibold text-info-text hover:underline">Edit in Providers &amp; routing</Link>}>
      {!o ? (
        <div className="p-5">
          {loading ? <div role="status" aria-busy="true" aria-label="Loading currencies" className="h-24 animate-pulse-soft rounded-xl bg-paper" /> : <Empty>Not available.</Empty>}
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-semibold">Unit</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Per US dollar</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">One unit</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {o.units
                .filter((u) => u.unit !== "usd")
                .map((u) => (
                  <tr key={u.unit}>
                    <th scope="row" className="px-5 py-2.5 font-medium text-ink-dark">{UNIT_LABEL[u.unit] ?? u.label}</th>
                    <td className="px-3 py-2.5 text-right tabular">{u.unitsPerUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtRate(1 / u.unitsPerUsd)}</td>
                    <td className="px-5 py-2.5">
                      {u.basis === "illustrative" ? (
                        <Badge surface="light" tone="attention">
                          Illustrative — enter the rate you pay
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-dark">
                          {u.basis === "documented" ? "Published by the supplier" : u.basis === "manual" ? "Entered by staff" : u.basis}
                          {u.checkedAt ? ` · ${day(u.checkedAt)}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-rule px-5 py-3 text-xs text-muted-dark">
        The router converts every supplier price to US dollars with these rates before it picks the cheapest supplier. Genlixs credits are separate and
        never equal a supplier unit.
      </p>
    </Panel>
  );
}
