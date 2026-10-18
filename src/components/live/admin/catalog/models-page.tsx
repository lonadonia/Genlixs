"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Boxes, ChevronRight, Network, PackageSearch, RefreshCw, TrendingDown } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { money } from "../providers/parts";
import { AvailableProducts } from "./available-products";
import { Diagnostics, type DiagnosticsSection } from "./diagnostics";
import { ModelSheet } from "./model-sheet";
import { configLabel, Empty, fmtMarkup, Notice, Switch, Tabs, Wrap } from "./shared";
import { cheaperOption, STAGE_INFO, type Supply, type SupplyModel } from "./supply";
import { GroupRow, Kpi, SavingTag, SearchBox, Segmented, SupplierMark, TYPE_GROUP, TYPE_LABEL, TYPE_ORDER } from "./supply-parts";
import type { AdminModel, AvailabilityState, CatalogData, Check } from "./types";

type Filter = "all" | "image" | "edit" | "video";
type View = "catalog" | "available";
type RowMessage = { tone: "error" | "attention"; text: string; fix?: { label: string; href?: string; section?: DiagnosticsSection } };

const isOn = (s: AvailabilityState) => s === "enabled" || s === "experimental";

/** What stops a model from being switched on, in one short sentence with one fix. */
function blockerMessage(m: AdminModel, c: Check): RowMessage {
  switch (c.key) {
    case "price":
      return { tone: "attention", text: "Set a price first.", fix: { label: "Set price", href: `/admin/pricing?model=${m.id}` } };
    case "supplier_cost":
      return { tone: "attention", text: "The supplier cost is unknown.", fix: { label: "Open cost", section: "cost" } };
    case "adapter":
      return { tone: "attention", text: "This release cannot send work to this model yet." };
    case "provider_account":
      return { tone: "attention", text: "The supplier account is paused in Genlixs." };
    default:
      return { tone: "attention", text: c.detail };
  }
}

/**
 * Models: every model appears once, as customers see it. Each row shows the supplier serving its default request now,
 * the cost, price and margin of that request, and the cheapest other supplier with the step still missing to use it.
 * "Available at suppliers" lists the products the suppliers sell that are not in the catalog, each product once.
 * The On/Off switch calls the real availability endpoint (pending state, kept on success, restored on failure).
 */
export function ModelsPage() {
  const c = useApi<CatalogData>("/api/admin/catalog");
  // Started from the signed-in staff capabilities so both reads load in parallel.
  const canReadProvider = Boolean(useAccount().me?.capabilities.includes("provider.read"));
  const supply = useApi<Supply>(canReadProvider ? "/api/admin/catalog/supply" : null, [canReadProvider]);
  const [view, setView] = useState<View>("catalog");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [onlyCheaper, setOnlyCheaper] = useState(false);
  const [pending, setPending] = useState<Record<string, AvailabilityState>>({});
  const [messages, setMessages] = useState<Record<string, RowMessage | undefined>>({});
  const [announce, setAnnounce] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const [details, setDetails] = useState<{ id: string; section: DiagnosticsSection } | null>(null);

  const supplyById = useMemo(() => new Map((supply.data?.models ?? []).map((s) => [s.id, s])), [supply.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (c.data?.models ?? []).filter(
      (m) =>
        (filter === "all" || m.tool === filter) &&
        (!term || [m.name, m.family ?? "", m.variant ?? ""].some((s) => s.toLowerCase().includes(term))) &&
        (!onlyCheaper || Boolean(supplyById.get(m.id) && cheaperOption(supplyById.get(m.id)!))),
    );
  }, [c.data, filter, q, onlyCheaper, supplyById]);

  if (c.error && !c.data) {
    return (
      <Wrap>
        <Notice tone="error" title="Models could not load" action={<Button size="sm" variant="secondary-light" onClick={c.reload}>Try again</Button>}>
          {c.error.message}
        </Notice>
      </Wrap>
    );
  }
  if (!c.data) {
    return (
      <Wrap>
        <div role="status" aria-busy="true" aria-label="Loading models" className="h-64 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      </Wrap>
    );
  }
  const d = c.data;
  const s = supply.data;
  const creditUsd = d.references?.credit?.usdPerCredit ?? null;
  const showCosts = d.access.canSeeCosts;
  const onCount = d.models.filter((m) => isOn(m.state)).length;
  const byType = TYPE_ORDER.map((t) => d.models.filter((m) => m.tool === t).length);

  // Suppliers serving at least one model now, and the models a cheaper supplier could take.
  const serving = new Map<string, { name: string; n: number }>();
  for (const m of s?.models ?? []) {
    if (!m.route.provider) continue;
    const e = serving.get(m.route.provider) ?? { name: m.route.providerName ?? m.route.provider, n: 0 };
    serving.set(m.route.provider, { ...e, n: e.n + 1 });
  }
  const cheaper = (s?.models ?? []).map((m) => cheaperOption(m)).filter((x): x is NonNullable<typeof x> => x !== null);
  const bestSaving = cheaper.reduce((a, x) => Math.max(a, x.saving), 0);
  const waitingForKey = (s?.suppliers ?? []).filter((x) => !x.hasKey).length;

  const setMessage = (id: string, msg: RowMessage | undefined) => setMessages((all) => ({ ...all, [id]: msg }));
  const toggle = async (m: AdminModel, on: boolean) => {
    setMessage(m.id, undefined);
    if (on) {
      if (!d.runtime.submitsEnabled) {
        setMessage(m.id, { tone: "attention", text: "This site cannot send work to suppliers yet (the server key is missing)." });
        return;
      }
      const block = m.readiness.checks.find((x) => !x.ok && !x.warning);
      if (block) {
        setMessage(m.id, blockerMessage(m, block));
        return;
      }
    }
    const target: AvailabilityState = on ? "enabled" : "disabled";
    setPending((p) => ({ ...p, [m.id]: target }));
    try {
      await api(`/api/admin/catalog/models/${m.id}/availability`, { body: { state: target } });
      c.setData((prev) => (prev ? { ...prev, models: prev.models.map((x) => (x.id === m.id ? { ...x, state: target, note: null } : x)) } : prev));
      setAnnounce(`${m.name} is ${on ? "on. Customers can use it now" : "off. New requests are refused; running jobs finish"}.`);
      c.reload();
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "";
      setMessage(
        m.id,
        code === "MODEL_NOT_PRICED"
          ? { tone: "attention", text: "Set a price first.", fix: { label: "Set price", href: `/admin/pricing?model=${m.id}` } }
          : { tone: "error", text: `Not changed: ${errorMessage(e)}` },
      );
      setAnnounce(`${m.name} was not changed.`);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
    }
  };

  const sheetModel = sheet ? d.models.find((m) => m.id === sheet) ?? null : null;
  const reloadAll = () => {
    c.reload();
    if (canReadProvider) supply.reload();
  };

  return (
    <Wrap>
      <PageHead
        title="Models"
        sub={
          <span className="block max-w-3xl">
            Every model appears once to customers. Each request goes to the cheapest verified supplier that supports its exact settings.
          </span>
        }
        actions={
          <>
            {canReadProvider ? (
              <Link href="/admin/providers" className="inline-flex h-8 items-center gap-1 px-2 text-[13px] font-semibold text-info-text hover:underline">
                Providers &amp; routing <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : null}
            <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} onClick={reloadAll} busy={c.loading || supply.loading}>
              Refresh
            </Button>
          </>
        }
      />
      {!d.runtime.submitsEnabled ? (
        <Notice tone="attention" title="Models cannot be switched on here">
          This deployment has no supplier key, so customers could not generate. Add KIE_API_KEY in Vercel.
        </Notice>
      ) : null}

      <div className={cn("grid gap-3 sm:grid-cols-2", s ? "xl:grid-cols-4" : "xl:grid-cols-2")}>
        <Kpi
          icon={Boxes}
          label="Live for customers"
          value={onCount}
          suffix={`of ${d.models.length}`}
          sub={`${byType[0]} image · ${byType[1]} image edit · ${byType[2]} video`}
          tone={onCount === d.models.length ? "good" : "neutral"}
        />
        {s ? (
          <>
            <Kpi
              icon={Network}
              label="Suppliers serving"
              value={serving.size}
              suffix={`of ${s.suppliers.length}`}
              sub={
                serving.size === 1
                  ? `${[...serving.values()][0].name} serves every model${waitingForKey ? ` · ${waitingForKey} supplier(s) need an API key` : ""}`
                  : [...serving.values()].map((x) => `${x.name} ${x.n}`).join(" · ")
              }
            />
            <Kpi
              icon={TrendingDown}
              label="Cheaper supplier found"
              value={cheaper.length}
              suffix={cheaper.length === 1 ? "model" : "models"}
              sub={cheaper.length ? `Up to ${Math.round(bestSaving * 100)} % less for the default request · not serving yet` : "Every model is served at the lowest known cost"}
              tone={cheaper.length ? "good" : "neutral"}
            />
            <Kpi
              icon={PackageSearch}
              label="Available at suppliers"
              value={s.products.length}
              suffix="products"
              sub="Not in the catalog yet · each listed once with its cheapest supplier"
            />
          </>
        ) : (
          <Kpi icon={Network} label="Suppliers" value="—" sub={supply.loading ? "Loading suppliers…" : "Your role cannot see suppliers."} />
        )}
      </div>

      {s ? (
        <Tabs<View>
          label="Models view"
          value={view}
          onChange={setView}
          tabs={[
            { id: "catalog", label: "In the catalog", count: d.models.length },
            { id: "available", label: "Available at suppliers", count: s.products.length },
          ]}
        />
      ) : null}

      {view === "available" && s ? (
        <AvailableProducts supply={s} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
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
            {s && cheaper.length ? (
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-dark">
                <input type="checkbox" checked={onlyCheaper} onChange={(e) => setOnlyCheaper(e.target.checked)} className="size-4 accent-[var(--color-brand-blue)]" />
                Only models with a cheaper supplier
              </label>
            ) : null}
          </div>

          <p aria-live="polite" className="sr-only">
            {announce}
          </p>

          {supply.error && !s ? (
            <Notice tone="attention" title="Supplier details could not load" action={<Button size="sm" variant="secondary-light" onClick={supply.reload}>Try again</Button>}>
              {supply.error.message} The switches below still work.
            </Notice>
          ) : null}

          <Panel bodyClass="p-0">
            {rows.length === 0 ? (
              <div className="p-5">
                <Empty>No model matches this search.</Empty>
              </div>
            ) : (
              <>
                <div className="relative hidden overflow-x-auto xl:block">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <caption className="sr-only">Models with their current supplier, cost, price and margin for the default request</caption>
                    <thead className="border-b border-rule text-xs whitespace-nowrap text-muted-dark">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Model · default request</th>
                        {s ? <th scope="col" className="px-3 py-3 font-semibold">Served by</th> : null}
                        {s && showCosts ? <th scope="col" className="px-3 py-3 text-right font-semibold">Cost</th> : null}
                        {s ? <th scope="col" className="px-3 py-3 text-right font-semibold">Price</th> : null}
                        {s && showCosts ? <th scope="col" className="px-3 py-3 text-right font-semibold">Margin</th> : null}
                        {s ? <th scope="col" className="px-3 py-3 font-semibold">Cheaper supplier</th> : null}
                        <th scope="col" className="px-4 py-3 text-right font-semibold sm:px-5">For customers</th>
                      </tr>
                    </thead>
                    {TYPE_ORDER.map((t) => {
                      const group = rows.filter((m) => m.tool === t);
                      if (!group.length) return null;
                      const cols = 2 + (s ? 3 : 0) + (s && showCosts ? 2 : 0);
                      return (
                        <tbody key={t} className="divide-y divide-rule">
                          <GroupRow label={TYPE_GROUP[t]} count={group.length} colSpan={cols} />
                          {group.map((m) => (
                            <ModelRow
                              key={m.id}
                              m={m}
                              sup={supplyById.get(m.id) ?? null}
                              withSupply={Boolean(s)}
                              showCosts={showCosts}
                              creditUsd={creditUsd}
                              state={pending[m.id] ?? m.state}
                              busy={m.id in pending}
                              canOperate={d.access.canOperate}
                              msg={messages[m.id]}
                              onToggle={(on) => void toggle(m, on)}
                              onOpen={() => setSheet(m.id)}
                              onFix={(section) => setDetails({ id: m.id, section })}
                            />
                          ))}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
                <ul className="divide-y divide-rule xl:hidden">
                  {rows.map((m) => (
                    <ModelCard
                      key={m.id}
                      m={m}
                      sup={supplyById.get(m.id) ?? null}
                      showCosts={showCosts}
                      creditUsd={creditUsd}
                      state={pending[m.id] ?? m.state}
                      busy={m.id in pending}
                      canOperate={d.access.canOperate}
                      msg={messages[m.id]}
                      onToggle={(on) => void toggle(m, on)}
                      onOpen={() => setSheet(m.id)}
                    />
                  ))}
                </ul>
              </>
            )}
          </Panel>
          {!d.access.canOperate ? <p className="text-sm text-muted-dark">Your role can see models but not switch them on or off.</p> : null}
          <p className="text-xs leading-relaxed text-muted-dark">
            Cost, price and margin are for each model&apos;s default request (shown under its name); open a model for every supplier&apos;s quote and its
            price range. Off: hidden from customers and new requests are refused; jobs already running finish normally. Customers see a change within a few
            seconds.
          </p>
        </>
      )}

      {sheetModel ? (
        <ModelSheet
          model={sheetModel}
          supply={supplyById.get(sheetModel.id) ?? null}
          access={d.access}
          creditUsd={creditUsd}
          onClose={() => setSheet(null)}
          onTechnical={() => {
            setSheet(null);
            setDetails({ id: sheetModel.id, section: "status" });
          }}
        />
      ) : null}
      {details ? (
        <Diagnostics
          modelId={details.id}
          section={details.section}
          onSection={(sec) => setDetails({ ...details, section: sec })}
          onClose={() => setDetails(null)}
          onChanged={reloadAll}
        />
      ) : null}
    </Wrap>
  );
}

type RowProps = {
  m: AdminModel;
  sup: SupplyModel | null;
  showCosts: boolean;
  creditUsd: number | null;
  state: AvailabilityState;
  busy: boolean;
  canOperate: boolean;
  msg: RowMessage | undefined;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
};

/** Default-request numbers of one model: cost now, price, margin and the cheaper option. */
function figures(m: AdminModel, sup: SupplyModel | null, creditUsd: number | null) {
  const cost = sup?.route.usd ?? null;
  const units = sup?.defaultUnits ?? null;
  const price = units !== null && creditUsd !== null ? units * creditUsd : null;
  const margin = price !== null && cost ? price / cost - 1 : null;
  const alt = sup ? cheaperOption(sup) : null;
  const settings = sup ? configLabel(m.capability.spec, sup.example.options) : null;
  return { cost, units, price, margin, alt, settings };
}

function ModelRow({ withSupply, onFix, ...p }: RowProps & { withSupply: boolean; onFix: (s: DiagnosticsSection) => void }) {
  const { m, sup, showCosts, creditUsd, state, busy, canOperate, msg, onToggle, onOpen } = p;
  const f = figures(m, sup, creditUsd);
  return (
    <tr className="transition-colors hover:bg-paper/60">
      <td className="px-4 py-3.5 align-top sm:px-5">
        <button type="button" onClick={onOpen} className="text-left font-semibold text-ink-dark hover:text-brand-blue hover:underline">
          {m.name}
        </button>
        <p className="mt-0.5 text-xs text-muted-dark">
          {f.settings ?? TYPE_LABEL[m.tool]}
          {state === "experimental" ? " · shown as experimental" : ""}
        </p>
        {state === "maintenance" ? <p className="mt-0.5 text-xs text-orange-text">Paused for maintenance{m.note ? `: “${m.note}”` : ""}</p> : null}
        {msg ? <RowNotice msg={msg} onFix={onFix} /> : null}
      </td>
      {withSupply ? (
        <td className="px-3 py-3.5 align-top">
          {sup?.route.provider && sup.route.providerName ? (
            <SupplierMark provider={sup.route.provider} name={sup.route.providerName} />
          ) : (
            <span className="text-xs font-semibold text-error-text">{sup ? "No supplier" : "—"}</span>
          )}
        </td>
      ) : null}
      {withSupply && showCosts ? <td className="px-3 py-3.5 text-right align-top font-semibold text-ink-dark tabular">{money(f.cost, "—")}</td> : null}
      {withSupply ? (
        <td className="px-3 py-3.5 text-right align-top tabular">
          {f.units !== null ? (
            <>
              <span className="font-semibold text-ink-dark">{f.units} cr</span>
              {f.price !== null ? <span className="block text-xs text-muted-dark">{money(f.price)}</span> : null}
            </>
          ) : (
            <span className="text-xs text-muted-dark">Not priced</span>
          )}
        </td>
      ) : null}
      {withSupply && showCosts ? (
        <td className={cn("px-3 py-3.5 text-right align-top font-semibold tabular", f.margin !== null && f.margin < 0 ? "text-error-text" : "text-ink-dark")}>
          {f.margin === null ? "—" : fmtMarkup(f.margin * 100)}
        </td>
      ) : null}
      {withSupply ? (
        <td className="px-3 py-3.5 align-top">
          {f.alt ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <SupplierMark provider={f.alt.quote.provider} name={f.alt.quote.providerName} />
              {showCosts ? <span className="text-xs font-semibold text-ink-dark tabular">{money(f.alt.quote.usd)}</span> : null}
              <SavingTag fraction={f.alt.saving} />
              <span className="basis-full text-[11px] text-muted-dark">{STAGE_INFO[f.alt.quote.stage].label}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-dark">{sup && sup.quotes.length > 1 ? "Lowest known cost" : "Only supplier"}</span>
          )}
        </td>
      ) : null}
      <td className="px-4 py-3.5 align-top sm:px-5">
        <div className="flex items-center justify-end gap-2.5">
          <span className={cn("w-14 text-right text-sm font-semibold", isOn(state) ? "text-ink-dark" : "text-muted-dark")} aria-hidden>
            {busy ? "Saving…" : isOn(state) ? "On" : "Off"}
          </span>
          <Switch checked={isOn(state)} busy={busy} disabled={!canOperate} onChange={onToggle} label={`${m.name}: available to customers`} />
          <button type="button" onClick={onOpen} aria-label={`Open ${m.name}`} className="grid size-8 place-items-center rounded-lg text-muted-dark hover:bg-neutral-tint hover:text-ink-dark">
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ModelCard(p: RowProps) {
  const { m, sup, showCosts, creditUsd, state, busy, canOperate, msg, onToggle, onOpen } = p;
  const f = figures(m, sup, creditUsd);
  return (
    <li className="space-y-2.5 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="text-left font-semibold text-ink-dark hover:text-brand-blue hover:underline">
            {m.name}
          </button>
          <p className="text-xs text-muted-dark">
            {TYPE_LABEL[m.tool]}
            {f.settings ? ` · ${f.settings}` : ""}
          </p>
        </div>
        <Switch checked={isOn(state)} busy={busy} disabled={!canOperate} onChange={onToggle} label={`${m.name}: available to customers`} />
      </div>
      {sup ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          {sup.route.provider && sup.route.providerName ? <SupplierMark provider={sup.route.provider} name={sup.route.providerName} /> : null}
          {showCosts ? <span className="text-muted-dark">Cost <span className="font-semibold text-ink-dark tabular">{money(f.cost, "—")}</span></span> : null}
          {f.units !== null ? (
            <span className="text-muted-dark">
              Price <span className="font-semibold text-ink-dark tabular">{f.units} cr</span>
            </span>
          ) : null}
          {showCosts && f.margin !== null ? <span className="font-semibold text-ink-dark tabular">{fmtMarkup(f.margin * 100)}</span> : null}
        </div>
      ) : null}
      {f.alt ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-dark">
          Cheaper: <SupplierMark provider={f.alt.quote.provider} name={f.alt.quote.providerName} /> <SavingTag fraction={f.alt.saving} /> {STAGE_INFO[f.alt.quote.stage].label}
        </div>
      ) : null}
      {busy ? <p className="text-xs text-muted-dark">Saving…</p> : null}
      {msg ? <RowNotice msg={msg} /> : null}
    </li>
  );
}

function RowNotice({ msg, onFix }: { msg: RowMessage; onFix?: (s: DiagnosticsSection) => void }) {
  return (
    <p role={msg.tone === "error" ? "alert" : undefined} className={cn("mt-1 text-sm", msg.tone === "error" ? "text-error-text" : "text-orange-text")}>
      {msg.text}{" "}
      {msg.fix?.href ? (
        <Link href={msg.fix.href} className="font-semibold text-info-text underline">
          {msg.fix.label}
        </Link>
      ) : msg.fix?.section && onFix ? (
        <button type="button" onClick={() => onFix(msg.fix!.section!)} className="font-semibold text-info-text underline">
          {msg.fix.label}
        </button>
      ) : null}
    </p>
  );
}
