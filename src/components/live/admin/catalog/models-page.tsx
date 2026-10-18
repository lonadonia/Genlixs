"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, PackagePlus, RefreshCw } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { dec } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { money } from "../providers/parts";
import { AvailableProducts } from "./available-products";
import { Diagnostics, type DiagnosticsSection } from "./diagnostics";
import { ModelDrawer } from "./model-drawer";
import { PackagesEditor, packageGroups } from "./packages-editor";
import { KIND_LABEL, KIND_ORDER, modelKind, type ModelKind, type PolicyApplyResult, type PolicyRead } from "./policy";
import { PricingPolicyPanel } from "./pricing-policy-panel";
import { configLabel, Empty, fmtMarkup, Notice, range, Switch, Wrap } from "./shared";
import type { Supply, SupplyModel } from "./supply";
import { SearchBox, Segmented, SupplierMark } from "./supply-parts";
import type { AdminModel, AvailabilityState, CatalogData, Check } from "./types";

type Filter = "all" | ModelKind;
type RowMessage = { tone: "error" | "attention"; text: string; fix?: { label: string; section?: DiagnosticsSection } };

const isOn = (s: AvailabilityState) => s === "enabled" || s === "experimental";

/** What stops a model from being switched on, in one short sentence with one fix. */
function blockerMessage(c: Check): RowMessage {
  switch (c.key) {
    case "price":
      return c.fix === "apply_policy"
        ? { tone: "attention", text: "No price yet: Save & apply the pricing above." }
        : { tone: "attention", text: "KIE reference needed, so it has no price.", fix: { label: "Open KIE price list", section: "cost" } };
    case "supplier_cost":
      return { tone: "attention", text: "KIE reference needed.", fix: { label: "Open KIE price list", section: "cost" } };
    case "adapter":
      return { tone: "attention", text: "This release cannot send work to this model yet." };
    case "provider_account":
      return { tone: "attention", text: "The supplier account is paused in Genlixs." };
    default:
      return { tone: "attention", text: c.detail };
  }
}

/**
 * Models & pricing: every customer model once, with its automatic price, the supplier serving it and the effective
 * markup on that supplier's cost. Prices follow one global policy (markup on the KIE reference, USD per Genlixs credit);
 * nothing is priced per model. Packages and the supplier inventory stay one click away. The On/Off switch calls the real
 * availability endpoint (pending state, kept on success, restored on failure). `?model=<id>` opens a model.
 */
export function ModelsPage() {
  const caps = useAccount().me?.capabilities ?? [];
  const canReadProvider = caps.includes("provider.read");
  const canReadPolicy = canReadProvider || caps.includes("pricing.review") || caps.includes("catalog.publish");
  const c = useApi<CatalogData>("/api/admin/catalog");
  // Started from the signed-in staff capabilities so the reads load in parallel.
  const supply = useApi<Supply>(canReadProvider ? "/api/admin/catalog/supply" : null, [canReadProvider]);
  const policy = useApi<PolicyRead>(canReadPolicy ? "/api/admin/catalog/policy" : null, [canReadPolicy]);
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const opened = sp.get("model");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Record<string, AvailabilityState>>({});
  const [messages, setMessages] = useState<Record<string, RowMessage | undefined>>({});
  const [announce, setAnnounce] = useState("");
  const [details, setDetails] = useState<{ id: string; section: DiagnosticsSection } | null>(null);
  const [adding, setAdding] = useState(false);
  const [applied, setApplied] = useState<PolicyApplyResult | null>(null);
  const [packagesOpen, setPackagesOpen] = useState(sp.get("tab") === "packages");
  const packagesRef = useRef<HTMLElement>(null);

  // Links to the former Pricing & packages page land on the packages section.
  const loaded = Boolean(c.data);
  useEffect(() => {
    if (loaded && sp.get("tab") === "packages") packagesRef.current?.scrollIntoView({ block: "start" });
  }, [loaded, sp]);

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
      (m) => (filter === "all" || modelKind(m) === filter) && (!term || [m.name, m.family ?? "", m.variant ?? ""].some((s) => s.toLowerCase().includes(term))),
    );
  }, [c.data, filter, q]);

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
  const usdPerCredit = policy.data?.policy?.usdPerCredit ?? d.references?.credit?.usdPerCredit ?? null;
  const showCosts = d.access.canSeeCosts && Boolean(s);
  const counts = Object.fromEntries(KIND_ORDER.map((k) => [k, d.models.filter((m) => modelKind(m) === k).length])) as Record<ModelKind, number>;
  const needsReference = (s?.models ?? []).filter((x) => x.pricing.status === "kie_reference_needed");
  const offered = packageGroups(d.products).filter((g) => g.offered).length;

  const reloadAll = () => {
    c.reload();
    if (canReadProvider) supply.reload();
    if (canReadPolicy) policy.reload();
  };
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
        setMessage(m.id, blockerMessage(block));
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
        code === "MODEL_NOT_PRICED" || code === "COST_UNKNOWN"
          ? { tone: "attention", text: "KIE reference needed, so it has no price.", fix: { label: "Open KIE price list", section: "cost" } }
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

  const drawerModel = opened ? d.models.find((m) => m.id === opened) ?? null : null;
  const rowProps = (m: AdminModel): RowProps => ({
    m,
    sup: supplyById.get(m.id) ?? null,
    showCosts,
    withSupply: Boolean(s),
    usdPerCredit,
    state: pending[m.id] ?? m.state,
    busy: m.id in pending,
    canOperate: d.access.canOperate,
    msg: messages[m.id],
    onToggle: (on) => void toggle(m, on),
    onOpen: () => setParam("model", m.id),
    onFix: (section) => setDetails({ id: m.id, section }),
  });

  return (
    <Wrap>
      <PageHead
        title="Models & pricing"
        sub={
          <span className="block max-w-3xl">
            Every model appears once to customers, priced automatically from its KIE reference. Each request goes to the cheapest verified supplier for its
            exact settings.
          </span>
        }
        actions={
          <>
            {s ? (
              <Button size="sm" variant="secondary-light" icon={<PackagePlus aria-hidden className="size-4" />} onClick={() => setAdding(true)}>
                Add models
              </Button>
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

      {policy.data ? (
        <PricingPolicyPanel
          key={policy.data.policy?.policyId ?? "none"}
          read={policy.data}
          models={d.models}
          applied={applied}
          onApplied={(r) => {
            setApplied(r);
            reloadAll();
          }}
        />
      ) : canReadPolicy && policy.error ? (
        <Notice tone="error" title="Pricing could not load" action={<Button size="sm" variant="secondary-light" onClick={policy.reload}>Try again</Button>}>
          {policy.error.message}
        </Notice>
      ) : canReadPolicy ? (
        <div role="status" aria-busy="true" aria-label="Loading pricing" className="h-28 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : null}

      {needsReference.length ? (
        <Notice tone="attention" title={`KIE reference needed for ${needsReference.length} model${needsReference.length === 1 ? "" : "s"}`}>
          {needsReference.map((x) => d.models.find((m) => m.id === x.id)?.name ?? x.id).join(", ")} cannot be priced or switched on until the KIE price list
          covers their settings.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          label="Model type"
          value={filter}
          onChange={setFilter}
          options={[{ id: "all", label: "All", count: d.models.length }, ...KIND_ORDER.filter((k) => counts[k]).map((k) => ({ id: k, label: KIND_LABEL[k], count: counts[k] }))]}
        />
        <SearchBox value={q} onChange={setQ} label="Search models" />
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
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">Models with the customer price of an example request, the supplier serving it and the effective markup</caption>
                <thead className="border-b border-rule text-xs whitespace-nowrap text-muted-dark">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Model · example settings</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Customer price</th>
                    {s ? <th scope="col" className="px-3 py-3 font-semibold">Served by · cost</th> : null}
                    {showCosts ? <th scope="col" className="px-3 py-3 text-right font-semibold">Effective markup</th> : null}
                    <th scope="col" className="px-4 py-3 text-right font-semibold sm:px-5">For customers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((m) => (
                    <ModelRow key={m.id} {...rowProps(m)} />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-rule xl:hidden">
              {rows.map((m) => (
                <ModelCard key={m.id} {...rowProps(m)} />
              ))}
            </ul>
          </>
        )}
      </Panel>
      {!d.access.canOperate ? <p className="text-sm text-muted-dark">Your role can see models but not switch them on or off.</p> : null}
      <p className="text-xs leading-relaxed text-muted-dark">
        Prices are for each model&apos;s example request (shown under its name); open a model for its KIE reference, the full price range and every
        supplier. Effective markup = (customer price − serving cost) ÷ serving cost, before payment fees and partner commission. Off: hidden from customers
        and new requests are refused; jobs already running finish normally.
      </p>

      <section ref={packagesRef} aria-labelledby="packages-h" className="scroll-mt-4 rounded-[var(--radius-media)] border border-rule bg-sheet shadow-[var(--shadow-lift)]">
        <h2 id="packages-h">
          <button
            type="button"
            aria-expanded={packagesOpen}
            aria-controls="packages-body"
            onClick={() => setPackagesOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
          >
            <span className="text-base font-semibold text-ink-dark">Packages</span>
            <span className="flex items-center gap-2 text-sm text-muted-dark">
              {offered} offered to customers
              <ChevronDown aria-hidden className={cn("size-4 transition-transform", packagesOpen && "rotate-180")} />
            </span>
          </button>
        </h2>
        {packagesOpen ? (
          <div id="packages-body" className="border-t border-rule p-5">
            <PackagesEditor
              products={d.products}
              reference={usdPerCredit !== null ? dec(usdPerCredit) : null}
              canEdit={d.access.canPrice}
              canPublish={d.access.canPublish}
              promotions={d.promotions}
              onSaved={c.reload}
            />
          </div>
        ) : null}
      </section>

      {drawerModel ? (
        <ModelDrawer
          model={drawerModel}
          supply={supplyById.get(drawerModel.id) ?? null}
          policy={policy.data?.policy ?? null}
          access={d.access}
          onClose={() => setParam("model", null)}
          onTechnical={(section) => {
            setParam("model", null);
            setDetails({ id: drawerModel.id, section });
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
      {adding && s ? (
        <Dialog
          open
          surface="light"
          size="xl"
          onClose={() => setAdding(false)}
          title="Add models"
          description="Products the suppliers sell that are not Genlixs models yet. Nothing here is published: a product becomes a model only with a release that integrates it."
        >
          <AvailableProducts supply={s} />
        </Dialog>
      ) : null}
    </Wrap>
  );
}

type RowProps = {
  m: AdminModel;
  sup: SupplyModel | null;
  showCosts: boolean;
  withSupply: boolean;
  usdPerCredit: number | null;
  state: AvailabilityState;
  busy: boolean;
  canOperate: boolean;
  msg: RowMessage | undefined;
  onToggle: (on: boolean) => void;
  onOpen: () => void;
  onFix: (s: DiagnosticsSection) => void;
};

/** Example-request figures of one model, all from the database: credits, their value, serving cost, effective markup. */
function figures(m: AdminModel, sup: SupplyModel | null, usdPerCredit: number | null) {
  const p = m.pricing;
  const priced = Boolean(p.published?.currentCapability) && p.minUnits !== null;
  const units = sup?.defaultUnits ?? null;
  return {
    units,
    usd: sup?.pricing.chargedUsd ?? (units !== null && usdPerCredit !== null ? units * usdPerCredit : null),
    // Without the supplier view (roles that cannot read suppliers), the range across all settings.
    range: !sup && priced ? `${range(p.minUnits, p.maxUnits, (n) => `${n}`)} cr` : null,
    needsReference: sup?.pricing.status === "kie_reference_needed" || m.readiness.checks.some((c) => c.key === "supplier_cost" && !c.ok),
    settings: sup ? configLabel(m.capability.spec, sup.example.options) : null,
    cost: sup?.route.usd ?? null,
    markup: sup?.route.effectiveMarkupPct ?? null,
  };
}

function PriceCell({ f }: { f: ReturnType<typeof figures> }) {
  if (f.units !== null) {
    return (
      <>
        <span className="font-semibold text-ink-dark">{f.units} cr</span>
        {f.usd !== null ? <span className="block text-xs text-muted-dark">{money(f.usd)}</span> : null}
      </>
    );
  }
  if (f.range) return <span className="font-semibold text-ink-dark">{f.range}</span>;
  return <span className="text-xs font-semibold text-orange-text">{f.needsReference ? "KIE reference needed" : "Not priced"}</span>;
}

function ModelRow(p: RowProps) {
  const { m, sup, showCosts, withSupply, usdPerCredit, state, busy, canOperate, msg, onToggle, onOpen, onFix } = p;
  const f = figures(m, sup, usdPerCredit);
  return (
    <tr className="transition-colors hover:bg-paper/60">
      <td className="px-4 py-3.5 align-top sm:px-5">
        <button type="button" onClick={onOpen} className="text-left font-semibold text-ink-dark hover:text-brand-blue hover:underline">
          {m.name}
        </button>
        <p className="mt-0.5 text-xs text-muted-dark">
          {f.settings ?? m.purpose}
          {state === "experimental" ? " · shown as experimental" : ""}
        </p>
        {state === "maintenance" ? <p className="mt-0.5 text-xs text-orange-text">Paused for maintenance{m.note ? `: “${m.note}”` : ""}</p> : null}
        {msg ? <RowNotice msg={msg} onFix={onFix} /> : null}
      </td>
      <td className="px-3 py-3.5 text-right align-top tabular">
        <PriceCell f={f} />
      </td>
      {withSupply ? (
        <td className="px-3 py-3.5 align-top">
          {sup?.route.provider && sup.route.providerName ? (
            <>
              <SupplierMark provider={sup.route.provider} name={sup.route.providerName} />
              {showCosts ? <span className="mt-1 block text-xs text-muted-dark tabular">{money(f.cost, "cost unknown")}</span> : null}
            </>
          ) : (
            <span className="text-xs font-semibold text-error-text">{sup ? "No supplier" : "—"}</span>
          )}
        </td>
      ) : null}
      {showCosts ? (
        <td className={cn("px-3 py-3.5 text-right align-top font-semibold tabular", f.markup !== null && f.markup < 0 ? "text-error-text" : "text-ink-dark")}>
          {fmtMarkup(f.markup)}
        </td>
      ) : null}
      <td className="px-4 py-3.5 align-top sm:px-5">
        <div className="flex items-center justify-end gap-2.5">
          <span className={cn("w-14 text-right text-sm font-semibold", isOn(state) ? "text-ink-dark" : "text-muted-dark")} aria-hidden>
            {busy ? "Saving…" : isOn(state) ? "On" : "Off"}
          </span>
          <Switch checked={isOn(state)} busy={busy} disabled={!canOperate} onChange={onToggle} label={`${m.name}: available to customers`} />
          <button type="button" onClick={onOpen} aria-label={`Details of ${m.name}`} className="grid size-8 place-items-center rounded-lg text-muted-dark hover:bg-neutral-tint hover:text-ink-dark">
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ModelCard(p: RowProps) {
  const { m, sup, showCosts, usdPerCredit, state, busy, canOperate, msg, onToggle, onOpen, onFix } = p;
  const f = figures(m, sup, usdPerCredit);
  return (
    <li className="space-y-2.5 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onOpen} className="text-left font-semibold text-ink-dark hover:text-brand-blue hover:underline">
            {m.name}
          </button>
          <p className="text-xs text-muted-dark">{f.settings ?? m.purpose}</p>
        </div>
        <Switch checked={isOn(state)} busy={busy} disabled={!canOperate} onChange={onToggle} label={`${m.name}: available to customers`} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="text-muted-dark">
          Price{" "}
          {f.units !== null || f.range ? (
            <span className="font-semibold text-ink-dark tabular">
              {f.units !== null ? `${f.units} cr${f.usd !== null ? ` · ${money(f.usd)}` : ""}` : f.range}
            </span>
          ) : (
            <span className="font-semibold text-orange-text">{f.needsReference ? "KIE reference needed" : "Not priced"}</span>
          )}
        </span>
        {sup?.route.provider && sup.route.providerName ? <SupplierMark provider={sup.route.provider} name={sup.route.providerName} /> : null}
        {showCosts ? (
          <span className="text-muted-dark">
            Cost <span className="font-semibold text-ink-dark tabular">{money(f.cost, "—")}</span> · markup{" "}
            <span className={cn("font-semibold tabular", f.markup !== null && f.markup < 0 ? "text-error-text" : "text-ink-dark")}>{fmtMarkup(f.markup)}</span>
          </span>
        ) : null}
        <button type="button" onClick={onOpen} className="font-semibold text-info-text underline">
          Details
        </button>
      </div>
      {busy ? <p className="text-xs text-muted-dark">Saving…</p> : null}
      {msg ? <RowNotice msg={msg} onFix={onFix} /> : null}
    </li>
  );
}

function RowNotice({ msg, onFix }: { msg: RowMessage; onFix: (s: DiagnosticsSection) => void }) {
  return (
    <p role={msg.tone === "error" ? "alert" : undefined} className={cn("mt-1 text-sm", msg.tone === "error" ? "text-error-text" : "text-orange-text")}>
      {msg.text}{" "}
      {msg.fix?.section ? (
        <button type="button" onClick={() => onFix(msg.fix!.section!)} className="font-semibold text-info-text underline">
          {msg.fix.label}
        </button>
      ) : null}
    </p>
  );
}
