"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Calculator, FlaskConical, RefreshCw, Search, Tags } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { useAvailability } from "./availability";
import { BulkPricing } from "./bulk-pricing";
import { ModelPanel, type PanelSection } from "./model-panel";
import { PackagesTab } from "./packages";
import { ProviderTab } from "./provider";
import { SettingsTab } from "./settings";
import { Empty, fmtGx, fmtKie, fmtUsd4, inputCls, ModelBadges, Notice, range, STATE_INFO, Switch, Tabs, VerificationBadge, day } from "./shared";
import type { AdminModel, AvailabilityState, CatalogData } from "./types";

type TabId = "models" | "bulk" | "packages" | "provider" | "settings";

/** Admin catalog workspace: models, bulk pricing, packages, provider balance & usage, terms & settings. */
export function CatalogWorkspace() {
  const c = useApi<CatalogData>("/api/admin/catalog");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (["models", "bulk", "packages", "provider", "settings"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "models") as TabId;
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState<{ id: string; section: PanelSection } | null>(null);
  const [bulkScopeSelected, setBulkScopeSelected] = useState(false);

  const setTab = useCallback(
    (t: TabId) => {
      const n = new URLSearchParams(sp.toString());
      if (t === "models") n.delete("tab");
      else n.set("tab", t);
      router.replace(`${pathname}${n.size ? `?${n}` : ""}`, { scroll: false });
    },
    [pathname, router, sp],
  );

  if (c.error) {
    return (
      <Wrap>
        <Notice tone="error" title="The catalog could not load" action={<Button size="sm" variant="secondary-light" onClick={c.reload}>Try again</Button>}>
          {c.error.message}
        </Notice>
      </Wrap>
    );
  }
  if (!c.data) {
    return (
      <Wrap>
        <div role="status" aria-busy="true" aria-label="Loading the catalog" className="h-64 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      </Wrap>
    );
  }
  const d = c.data;
  const basis = d.economics?.basis;

  return (
    <Wrap>
      <PageHead
        title="Models & pricing"
        sub="Image and video models, KIE supplier costs, credit prices and packages. Routine changes are recorded in the audit log automatically."
        actions={
          <>
            <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} onClick={c.reload} busy={c.loading}>
              Refresh
            </Button>
            {d.access.canPrice ? (
              <Button size="sm" icon={<Calculator aria-hidden className="size-4" />} onClick={() => setTab("bulk")}>
                Bulk pricing
              </Button>
            ) : null}
          </>
        }
      />
      {!d.runtime.submitsEnabled ? (
        <Notice tone="attention" title="This deployment cannot send work to KIE">
          The KIE key is not configured here{d.runtime.kieKeyPresent ? " (paid provider calls are disabled outside production)" : ""}. Tests and enabling models are
          blocked until it is; prices and costs can still be prepared.
        </Notice>
      ) : null}
      {basis && basis.source !== "published" ? (
        <Notice tone="attention" title={basis.source === "none" ? "No USD package to value credits" : "Credit value is based on draft packages"}>
          {basis.source === "none"
            ? "Prices in Genlixs credits need at least one USD credit package (draft or published)."
            : "No package is published yet, so price previews use the draft packages. Publish packages in the Packages tab when they are approved."}
        </Notice>
      ) : null}
      <Tabs<TabId>
        label="Catalog sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "models", label: "Models", count: d.models.length },
          ...(d.access.canPrice ? [{ id: "bulk" as const, label: "Bulk pricing" }] : []),
          { id: "packages", label: "Packages" },
          ...(d.access.canReadProvider ? [{ id: "provider" as const, label: "KIE balance & usage" }] : []),
          { id: "settings", label: "Terms & settings" },
        ]}
      />
      {tab === "models" ? (
        <ModelsTab
          data={d}
          reload={c.reload}
          selected={selected}
          setSelected={setSelected}
          open={(id, section) => setPanel({ id, section })}
          bulkPrice={() => {
            setBulkScopeSelected(true);
            setTab("bulk");
          }}
        />
      ) : null}
      {tab === "bulk" && d.access.canPrice ? (
        <BulkPricing data={d} selected={bulkScopeSelected ? selected : []} onApplied={c.reload} />
      ) : null}
      {tab === "packages" ? <PackagesTab data={d} reload={c.reload} /> : null}
      {tab === "provider" && d.access.canReadProvider ? <ProviderTab canOperate={d.access.canOperate} /> : null}
      {tab === "settings" ? <SettingsTab data={d} reload={c.reload} /> : null}
      {panel ? (
        <ModelPanel
          modelId={panel.id}
          economics={d.economics}
          section={panel.section}
          onSection={(s) => setPanel({ ...panel, section: s })}
          onClose={() => setPanel(null)}
          onChanged={c.reload}
        />
      ) : null}
    </Wrap>
  );
}

const Wrap = ({ children }: { children: React.ReactNode }) => <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6 lg:p-8">{children}</div>;

// ------------------------------------------------------------------------------------------------ models

type Filter = "all" | "image" | "video";

function ModelsTab({
  data,
  reload,
  selected,
  setSelected,
  open,
  bulkPrice,
}: {
  data: CatalogData;
  reload: () => void;
  selected: string[];
  setSelected: (v: string[]) => void;
  open: (id: string, section: PanelSection) => void;
  bulkPrice: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [state, setState] = useState<"" | AvailabilityState>("");
  const [q, setQ] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ tone: "error" | "success"; text: string; list?: string[] } | null>(null);
  const avail = useAvailability({ access: data.access, runtime: data.runtime, onChanged: reload, onFix: (id, s) => open(id, s) });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.models.filter(
      (m) =>
        (filter === "all" || m.category === filter) &&
        (!state || m.state === state) &&
        (!term || [m.name, m.family ?? "", m.variant ?? "", m.purpose, m.id].some((s) => s.toLowerCase().includes(term))),
    );
  }, [data.models, filter, state, q]);
  const allVisibleSelected = rows.length > 0 && rows.every((m) => selected.includes(m.id));
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const bulk = async (target: AvailabilityState) => {
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      await api("/api/admin/catalog/models/availability", { body: { modelIds: selected, state: target } });
      setBulkMsg({ tone: "success", text: `${selected.length} model(s) set to ${STATE_INFO[target].label.toLowerCase()}.` });
      setSelected([]);
      reload();
    } catch (e) {
      const list = (e as { details?: { blocked?: { message: string }[] } }).details?.blocked?.map((b) => b.message);
      setBulkMsg({ tone: "error", text: errorMessage(e), list });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Model type" className="inline-flex rounded-full border border-rule-strong bg-sheet p-1">
          {(["all", "image", "video"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold", filter === f ? "bg-ink-dark text-white" : "text-muted-dark hover:text-ink-dark")}
            >
              {f === "all" ? "All" : f === "image" ? "Images & edits" : "Videos"}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search models</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className={cn(inputCls, "w-64 max-w-full pl-9")} />
        </label>
        <label>
          <span className="sr-only">Availability</span>
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} className={inputCls}>
            <option value="">All availability states</option>
            {(Object.keys(STATE_INFO) as AvailabilityState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_INFO[s].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-paper px-4 py-2.5 text-sm" aria-live="polite">
          <span className="font-semibold">{selected.length} selected</span>
          {data.access.canOperate ? (
            <>
              <Button size="sm" variant="secondary-light" busy={bulkBusy} onClick={() => void bulk("enabled")}>
                Enable selected
              </Button>
              <Button size="sm" variant="secondary-light" busy={bulkBusy} onClick={() => void bulk("disabled")}>
                Disable selected
              </Button>
            </>
          ) : null}
          {data.access.canPrice ? (
            <Button size="sm" variant="secondary-light" onClick={bulkPrice}>
              Price selected
            </Button>
          ) : null}
          <Button size="sm" variant="ghost-light" onClick={() => setSelected([])}>
            Clear
          </Button>
          <span className="w-full text-xs text-muted-dark">Bulk enabling changes every selected model or none; untested models still need the owner’s per-model decision.</span>
        </div>
      ) : null}
      {bulkMsg ? (
        <Notice tone={bulkMsg.tone}>
          {bulkMsg.text}
          {bulkMsg.list?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {bulkMsg.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      <Panel bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <Empty>No model matches these filters.</Empty>
          </div>
        ) : (
          <>
            <div className="hidden xl:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Models with availability, customer price, KIE cost and verification</caption>
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all visible models"
                        checked={allVisibleSelected}
                        onChange={() => setSelected(allVisibleSelected ? selected.filter((id) => !rows.some((m) => m.id === id)) : [...new Set([...selected, ...rows.map((m) => m.id)])])}
                        className="size-4 accent-brand-blue"
                      />
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Model</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Availability</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Customer price</th>
                    {data.access.canSeeCosts ? <th scope="col" className="px-3 py-2.5 font-semibold">KIE cost</th> : null}
                    <th scope="col" className="px-3 py-2.5 font-semibold">Verification</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((m) => (
                    <tr key={m.id} className="align-top">
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Select ${m.name}`} checked={selected.includes(m.id)} onChange={() => toggle(m.id)} className="size-4 accent-brand-blue" />
                      </td>
                      <td className="max-w-sm px-3 py-3">
                        <ModelName m={m} />
                      </td>
                      <td className="px-3 py-3">
                        <AvailabilityCell m={m} canOperate={data.access.canOperate} onToggle={(on) => avail.request(m, on ? "enabled" : "disabled")} onOpen={() => open(m.id, "availability")} />
                      </td>
                      <td className="px-3 py-3">
                        <PriceCell m={m} />
                      </td>
                      {data.access.canSeeCosts ? (
                        <td className="px-3 py-3">
                          <CostCell m={m} />
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <VerificationBadge model={m} />
                        {m.lastTest ? <p className="mt-1 text-xs text-muted-dark">Last test {m.lastTest.ref}: {m.lastTest.status}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        <RowActions m={m} data={data} open={open} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-rule xl:hidden">
              {rows.map((m) => (
                <li key={m.id} className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" aria-label={`Select ${m.name}`} checked={selected.includes(m.id)} onChange={() => toggle(m.id)} className="mt-1 size-4 accent-brand-blue" />
                    <div className="min-w-0 flex-1">
                      <ModelName m={m} />
                    </div>
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold text-muted-dark">Availability</dt>
                      <dd className="mt-1">
                        <AvailabilityCell m={m} canOperate={data.access.canOperate} onToggle={(on) => avail.request(m, on ? "enabled" : "disabled")} onOpen={() => open(m.id, "availability")} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-muted-dark">Customer price</dt>
                      <dd className="mt-1">
                        <PriceCell m={m} />
                      </dd>
                    </div>
                    {data.access.canSeeCosts ? (
                      <div>
                        <dt className="text-xs font-semibold text-muted-dark">KIE cost</dt>
                        <dd className="mt-1">
                          <CostCell m={m} />
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-xs font-semibold text-muted-dark">Verification</dt>
                      <dd className="mt-1">
                        <VerificationBadge model={m} />
                      </dd>
                    </div>
                  </dl>
                  <RowActions m={m} data={data} open={open} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      {avail.dialog}
    </div>
  );
}

function ModelName({ m }: { m: AdminModel }) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-dark">
        {m.name}
        <span className="text-xs font-normal text-muted-dark">{m.tool === "edit" ? "Image edit" : m.tool === "image" ? "Image" : "Video"}</span>
      </p>
      <ModelBadges badges={m.badges} />
      <p className="text-xs text-muted-dark">{m.purpose}</p>
    </div>
  );
}

function AvailabilityCell({ m, canOperate, onToggle, onOpen }: { m: AdminModel; canOperate: boolean; onToggle: (on: boolean) => void; onOpen: () => void }) {
  const on = m.state === "enabled" || m.state === "experimental";
  const blocking = m.readiness.checks.filter((c) => !c.ok && !c.warning);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch checked={on} onChange={onToggle} disabled={!canOperate} label={`${m.name}: available to customers`} />
        <Badge surface="light" tone={STATE_INFO[m.state].tone}>
          {STATE_INFO[m.state].label}
        </Badge>
      </div>
      {!on && blocking.length ? (
        <p className="max-w-[16rem] text-xs text-muted-dark">
          Can’t enable yet: {blocking[0].detail}{" "}
          <button type="button" onClick={onOpen} className="font-semibold text-info-text underline">
            Resolve
          </button>
        </p>
      ) : null}
      {on && m.enableBasis === "documented_cost" ? <p className="text-xs text-orange-text">Enabled on documented cost (untested)</p> : null}
      {m.note ? <p className="max-w-[16rem] text-xs text-muted-dark">Customer note: {m.note}</p> : null}
    </div>
  );
}

function PriceCell({ m }: { m: AdminModel }) {
  const p = m.pricing;
  return (
    <div className="space-y-1">
      {p.published?.currentCapability ? (
        <p className="font-semibold tabular text-ink-dark">{range(p.minUnits, p.maxUnits, (n) => fmtGx(n))}</p>
      ) : (
        <p className="text-muted-dark">No published price</p>
      )}
      <p className="text-xs text-muted-dark">
        {p.published ? `v${p.published.version} · ${p.published.source}` : ""}
        {p.draft ? `${p.published ? " · " : ""}draft v${p.draft.version} ready` : ""}
      </p>
    </div>
  );
}

function CostCell({ m }: { m: AdminModel }) {
  const c = m.cost;
  if (!c) return <p className="text-sm text-error-text">No cost recorded</p>;
  const usd = (n: number) => fmtUsd4(n * c.usdPerCredit);
  return (
    <div className="space-y-1">
      <p className="tabular text-ink-dark">
        {range(c.minCredits, c.maxCredits, fmtKie)} <span className="text-xs text-muted-dark">{c.unit === "second" ? "(whole clip)" : ""}</span>
      </p>
      <p className="text-xs text-muted-dark tabular">{range(c.minCredits, c.maxCredits, usd)}</p>
      <p className="text-xs text-muted-dark">
        {c.sourceKind} · checked {day(c.checkedAt)} {c.stale ? <Badge surface="light" tone="attention">Stale</Badge> : null}
      </p>
      {!c.complete ? <p className="text-xs font-semibold text-error-text">Some configurations have no cost</p> : null}
    </div>
  );
}

function RowActions({ m, data, open }: { m: AdminModel; data: CatalogData; open: (id: string, s: PanelSection) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="secondary-light" icon={<Tags aria-hidden className="size-4" />} onClick={() => open(m.id, "pricing")}>
        {data.access.canPrice ? "Edit pricing" : "Pricing"}
      </Button>
      {data.access.canTest ? (
        <Button size="sm" variant="secondary-light" icon={<FlaskConical aria-hidden className="size-4" />} onClick={() => open(m.id, "test")}>
          Test model
        </Button>
      ) : null}
      {data.access.canSeeCosts ? (
        <Button size="sm" variant="ghost-light" onClick={() => open(m.id, "cost")}>
          Refresh supplier cost
        </Button>
      ) : null}
      <Button size="sm" variant="ghost-light" icon={<Activity aria-hidden className="size-4" />} onClick={() => open(m.id, "activity")}>
        Activity
      </Button>
    </div>
  );
}
