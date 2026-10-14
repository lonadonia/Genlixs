"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/live/account";
import { dec, toNumber } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { BulkMarkup } from "./bulk-markup";
import { PackagesEditor } from "./packages-editor";
import { PriceEditor } from "./price-editor";
import { ReferenceCards } from "./references";
import { Empty, fmtMarkup, fmtUsd4, inputCls, Notice, Wrap } from "./shared";
import type { AdminModel, CatalogData } from "./types";

type Filter = "all" | "image" | "video";

/**
 * Pricing & packages: the two reference values (KIE credit cost, Genlixs credit value), the packages customers buy,
 * and the Genlixs credit charge of each model. KIE credits and Genlixs credits are separate units throughout.
 */
export function PricingPage() {
  const c = useApi<CatalogData>("/api/admin/catalog");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const editing = sp.get("model");
  const [bulk, setBulk] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const setEditing = (id: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (id) n.set("model", id);
    else n.delete("model");
    router.replace(`${pathname}${n.size ? `?${n}` : ""}`, { scroll: false });
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (c.data?.models ?? []).filter(
      (m) => (filter === "all" || m.category === filter) && (!term || [m.name, m.family ?? "", m.variant ?? ""].some((s) => s.toLowerCase().includes(term))),
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
  const priced = d.models.filter((m) => m.pricing.published?.currentCapability).length;

  return (
    <Wrap>
      <PageHead
        title="Pricing & packages"
        sub="Reference values, the packages customers buy, and what each model costs in Genlixs credits. Every change is recorded in the audit log."
        actions={
          <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} onClick={c.reload} busy={c.loading}>
            Refresh
          </Button>
        }
      />
      <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href="#references-h" className="font-semibold text-info-text hover:underline">Reference values</a>
        <a href="#packages-h" className="font-semibold text-info-text hover:underline">Packages</a>
        <a href="#prices-h" className="font-semibold text-info-text hover:underline">Model prices</a>
      </nav>

      <section aria-labelledby="references-h" className="space-y-3">
        <h2 id="references-h" className="text-lg font-semibold text-ink-dark">Reference values</h2>
        <ReferenceCards
          kie={d.references.kie}
          credit={credit}
          canEdit={d.access.canPrice}
          pricedModels={priced}
          onSaved={c.reload}
          onRecalculate={() => setBulk(true)}
        />
      </section>

      <section aria-labelledby="packages-h" className="space-y-3">
        <h2 id="packages-h" className="text-lg font-semibold text-ink-dark">Packages</h2>
        <PackagesEditor
          products={d.products}
          reference={creditRate}
          canEdit={d.access.canPrice}
          canPublish={d.access.canPublish}
          promotions={d.promotions}
          onSaved={c.reload}
        />
      </section>

      <section aria-labelledby="prices-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="prices-h" className="text-lg font-semibold text-ink-dark">Model prices</h2>
          {d.access.canPrice ? (
            <Button size="sm" variant="secondary-light" onClick={() => setBulk(true)}>
              Apply a markup to several models
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Model type" className="inline-flex rounded-full border border-rule-strong bg-sheet p-1">
            {(["all", "image", "video"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold", filter === f ? "bg-ink-dark text-white" : "text-muted-dark hover:text-ink-dark")}
              >
                {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
              </button>
            ))}
          </div>
          <label className="relative">
            <span className="sr-only">Search models</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className={cn(inputCls, "w-64 max-w-full pl-9")} />
          </label>
        </div>
        <Panel bodyClass="p-0">
          {rows.length === 0 ? (
            <div className="p-5">
              <Empty>No model matches this search.</Empty>
            </div>
          ) : (
            <ul className="divide-y divide-rule">
              {rows.map((m) => (
                <PriceRow key={m.id} m={m} rate={creditRate ? toNumber(creditRate) : null} onEdit={() => setEditing(m.id)} canPrice={d.access.canPrice} />
              ))}
            </ul>
          )}
        </Panel>
        <p className="text-xs text-muted-dark">
          Value = Genlixs credits × the credit value. Markup is the value above the KIE cost. Customers are charged the saved price; editing a reference value
          does not change it.
        </p>
      </section>

      {editing ? <PriceEditor modelId={editing} products={d.products} onClose={() => setEditing(null)} onSaved={c.reload} /> : null}
      {bulk ? <BulkMarkup data={d} onClose={() => setBulk(false)} onSaved={c.reload} /> : null}
    </Wrap>
  );
}

function PriceRow({ m, rate, onEdit, canPrice }: { m: AdminModel; rate: number | null; onEdit: () => void; canPrice: boolean }) {
  const p = m.pricing;
  const priced = Boolean(p.published?.currentCapability) && p.minUnits !== null;
  const costKnown = m.cost?.complete ?? false;
  const range = (a: number, b: number, f: (n: number) => string) => (a === b ? f(a) : `${f(a)} – ${f(b)}`);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1 basis-48">
        <p className="font-semibold text-ink-dark">{m.name}</p>
        <p className="text-xs text-muted-dark">
          {m.tool === "video" ? "Video" : m.tool === "edit" ? "Image edit" : "Image"}
          {m.variant ? ` · ${m.variant}` : ""}
          {p.draft?.currentCapability ? " · draft waiting" : ""}
        </p>
      </div>
      <div className="min-w-[9rem] text-sm">
        {priced ? (
          <>
            <p className="font-semibold tabular text-ink-dark">{range(p.minUnits!, p.maxUnits!, (n) => `${n}`)} credits</p>
            <p className="text-xs text-muted-dark tabular">{rate !== null ? range(p.minUnits! * rate, p.maxUnits! * rate, fmtUsd4) : ""}</p>
          </>
        ) : (
          <p className="text-muted-dark">{costKnown ? "Not priced" : "KIE cost unknown"}</p>
        )}
      </div>
      <div className="min-w-[9rem] text-sm">
        {priced && p.markupMin !== null && p.markupMin !== undefined ? (
          <>
            <p className="tabular text-ink-dark">{range(p.markupMin * 100, (p.markupMax ?? p.markupMin) * 100, fmtMarkup)}</p>
            {p.belowCost ? <p className="text-xs font-semibold text-error-text">{p.belowCost} setting(s) below KIE cost</p> : <p className="text-xs text-muted-dark">above KIE cost</p>}
          </>
        ) : null}
      </div>
      <Button size="sm" variant={priced ? "secondary-light" : "primary"} disabled={!costKnown && !priced} onClick={onEdit}>
        {canPrice ? (priced ? "Edit price" : "Set price") : "View price"}
      </Button>
    </li>
  );
}
