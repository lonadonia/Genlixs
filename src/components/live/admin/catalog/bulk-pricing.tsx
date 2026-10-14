"use client";

import { useState } from "react";
import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { configLabel, ContributionCells, day, Empty, Field, fmtGx, fmtKie, fmtUsd4, inputCls, Notice, range, when } from "./shared";
import type { Batch, CatalogData, Preview, PriceTable } from "./types";

type Scope = "all" | "images" | "videos" | "selected";

const STATUS: Record<PriceTable["status"], { label: string; tone: "success" | "attention" | "error" | "neutral" }> = {
  ok: { label: "Ready", tone: "success" },
  manual_override: { label: "Manual price — kept", tone: "attention" },
  incomplete_cost: { label: "KIE cost incomplete", tone: "error" },
  missing_cost: { label: "No KIE cost", tone: "error" },
  no_revenue_basis: { label: "No package to value credits", tone: "error" },
};

/**
 * Bulk pricing from KIE supplier cost: target USD = cost × (1 + markup ÷ 100), charged in whole Genlixs credits at
 * the lowest package revenue per credit (rounded up). Every configuration is priced separately; nothing changes
 * until the owner saves drafts or publishes the selected rows, and a stale preview is refused by the server.
 */
export function BulkPricing({ data, selected, onApplied }: { data: CatalogData; selected: string[]; onApplied: () => void }) {
  const [scope, setScope] = useState<Scope>(selected.length ? "selected" : "all");
  const [markup, setMarkup] = useState("300");
  const [includeOverrides, setIncludeOverrides] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  // The exact request a preview was made from; applying re-sends it with the preview revision.
  const [previewRequest, setPreviewRequest] = useState<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<string[]>([]);
  const [busy, setBusy] = useState<"preview" | "draft" | "publish" | null>(null);
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);
  const [result, setResult] = useState<{ ref: string; action: string; items: { name: string; version: number }[] } | null>(null);
  const [confirm, setConfirm] = useState<"draft" | "publish" | null>(null);
  const batches = useApi<Batch[]>("/api/admin/catalog/batches?limit=20");
  const spec = (id: string) => data.models.find((m) => m.id === id)?.capability.spec;
  const request = { scope, modelIds: scope === "selected" ? selected : undefined, markupPercent: Number(markup), includeOverrides };

  const run = async () => {
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      const p = await api<Preview>("/api/admin/catalog/bulk-pricing/preview", { body: request });
      setPreview(p);
      setPreviewRequest(request);
      setRows(p.models.filter((m) => m.selectable).map((m) => m.modelId));
    } catch (e) {
      setPreview(null);
      setError({ text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const apply = async (action: "draft" | "publish") => {
    if (!preview || !previewRequest) return;
    setBusy(action);
    setError(null);
    try {
      const r = await api<{ ref: string; action: string; items: { name: string; version: number }[] }>("/api/admin/catalog/bulk-pricing/apply", {
        body: { ...previewRequest, previewRevision: preview.revision, action, selected: rows },
      });
      setResult(r);
      setPreview(null);
      setConfirm(null);
      batches.reload();
      onApplied();
    } catch (e) {
      setConfirm(null);
      setError({ text: errorMessage(e), stale: e instanceof ApiClientError && e.code === "PREVIEW_STALE" });
    } finally {
      setBusy(null);
    }
  };

  const markupNum = Number(markup);
  const markupValid = markup.trim() !== "" && Number.isFinite(markupNum) && markupNum >= 0 && markupNum <= 2000;
  const losses = preview ? preview.models.filter((m) => rows.includes(m.modelId) && m.summary.lossConfigsUplift > 0) : [];
  const unknownCosts = preview?.assumptions && (preview.assumptions.paymentFeeBps === null || preview.assumptions.paymentFixedFeeUsd === null || preview.assumptions.operatingCostUsdPerJob === null);

  return (
    <div className="space-y-5">
      <Panel title="Bulk pricing from KIE cost">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-semibold text-ink-dark">Which models</legend>
            {(
              [
                ["all", "All image and video models"],
                ["images", "Images and edits only"],
                ["videos", "Videos only"],
                ["selected", `Selected rows (${selected.length})`],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={cn("flex items-center gap-2", v === "selected" && !selected.length && "text-muted-dark")}>
                <input type="radio" name="scope" value={v} checked={scope === v} disabled={v === "selected" && !selected.length} onChange={() => setScope(v)} className="size-4 accent-brand-blue" />
                {label}
              </label>
            ))}
            {!selected.length ? <p className="text-xs text-muted-dark">To price specific models, select them in the Models tab and choose “Price selected”.</p> : null}
          </fieldset>
          <div className="space-y-3">
            <Field
              label="Markup above KIE cost (%)"
              hint={
                <>
                  Target selling price = KIE cost × (1 + markup ÷ 100). <strong>+100 % = 2× cost, +300 % = 4× cost.</strong> Markup is not net profit margin: partner
                  commission, payment fees and operating costs come out of it.
                </>
              }
            >
              <input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} aria-invalid={!markupValid} className={cn(inputCls, "w-40")} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={includeOverrides} onChange={(e) => setIncludeOverrides(e.target.checked)} className="mt-0.5 size-4 accent-brand-blue" />
              <span>
                Also replace manual prices <span className="block text-xs text-muted-dark">Off by default: models priced by hand keep their prices.</span>
              </span>
            </label>
            <Button busy={busy === "preview"} disabled={!markupValid} onClick={() => void run()}>
              Preview prices
            </Button>
          </div>
        </div>
      </Panel>

      {error ? (
        <Notice tone="error" title={error.stale ? "Something changed since this preview" : undefined} action={error.stale ? <Button size="sm" variant="secondary-light" onClick={() => void run()}>Refresh preview</Button> : undefined}>
          {error.text}
        </Notice>
      ) : null}
      {result ? (
        <Notice tone="success" title={`Batch ${result.ref}: ${result.action === "publish" ? "published" : "saved as drafts"}`}>
          {result.items.map((i) => `${i.name} v${i.version}`).join(", ")}. {result.action === "publish" ? "New quotes use these prices now; quotes already shown and running jobs keep theirs." : "Publish them from this tab or each model’s pricing."}
        </Notice>
      ) : null}

      {preview ? (
        <>
          <Panel title="Basis of this preview">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt className="text-xs font-semibold text-muted-dark">Credit value used</dt>
                <dd className="mt-0.5">
                  {preview.basis.minRevenuePerCredit !== null ? `${fmtUsd4(preview.basis.minRevenuePerCredit)} per credit` : "None"}
                  <span className="block text-xs text-muted-dark">
                    Lowest of: {preview.basis.products.map((p) => `${p.name} ${fmtUsd4(p.revenuePerCredit)}`).join(" · ") || "—"}
                    {preview.basis.source === "draft" ? " (draft packages)" : ""}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-dark">KIE credit</dt>
                <dd className="mt-0.5">
                  {fmtUsd4(preview.assumptions.usdPerKieCredit)} standard rate
                  <span className="block text-xs text-muted-dark">Top-up bonuses may lower your real cost.</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-dark">Partner scenarios</dt>
                <dd className="mt-0.5">
                  {preview.assumptions.affiliate.baseBps / 100} % commission, {preview.assumptions.affiliate.upliftBps / 100} % after {preview.assumptions.affiliate.threshold} distinct paying customers
                  <span className="block text-xs text-muted-dark">From partner terms v{preview.assumptions.affiliate.version ?? "—"} ({preview.assumptions.affiliate.source}).</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-muted-dark">Contribution</dt>
                <dd className="mt-0.5">
                  {unknownCosts ? "Before unknown payment fees and operating costs" : "After payment fee and operating cost assumptions"}
                  <span className="block text-xs text-muted-dark">Revenue = credits × credit value; not net profit.</span>
                </dd>
              </div>
            </dl>
          </Panel>
          {losses.length ? (
            <Notice tone="attention" title={`At +${preview.markupBps / 100} %, ${losses.length} selected model(s) lose money when a partner earns ${preview.assumptions.affiliate.upliftBps / 100} %`}>
              {losses.map((l) => `${l.name} (${l.summary.lossConfigsUplift} configuration${l.summary.lossConfigsUplift === 1 ? "" : "s"})`).join(", ")}. Consider a higher markup or a
              manual price for these.
            </Notice>
          ) : null}
          <div className="space-y-3">
            {preview.models.map((m) => (
              <ModelPreview key={m.modelId} m={m} spec={spec(m.modelId)} checked={rows.includes(m.modelId)} onToggle={() => setRows(rows.includes(m.modelId) ? rows.filter((x) => x !== m.modelId) : [...rows, m.modelId])} />
            ))}
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-sheet px-4 py-3 shadow-[var(--shadow-lift)]">
            <span className="text-sm font-semibold">{rows.length} model(s) selected</span>
            {data.access.canPrice ? (
              <Button variant="secondary-light" disabled={!rows.length} busy={busy === "draft"} onClick={() => setConfirm("draft")}>
                Save drafts
              </Button>
            ) : null}
            {data.access.canPublish ? (
              <Button disabled={!rows.length} busy={busy === "publish"} onClick={() => setConfirm("publish")}>
                Publish selected changes
              </Button>
            ) : (
              <span className="text-xs text-muted-dark">Publishing prices needs the owner.</span>
            )}
          </div>
        </>
      ) : null}

      <Panel title="Recent pricing batches" bodyClass="p-0">
        {batches.data && batches.data.length === 0 ? (
          <div className="p-5">
            <Empty>No pricing batches yet.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-rule text-sm">
            {(batches.data ?? []).map((b) => (
              <li key={b.id} className="px-5 py-3">
                <p className="font-semibold text-ink-dark">
                  {b.ref} · {b.kind === "restore" ? "Restore" : b.action === "publish" ? "Published" : "Drafts"}
                  {b.markupBps !== null ? ` · +${b.markupBps / 100} %` : ""}
                </p>
                <p className="text-xs text-muted-dark">
                  {when(b.createdAt)} · {b.actor ?? "staff"}
                  {b.minRevenuePerCredit !== null ? ` · credit value ${fmtUsd4(b.minRevenuePerCredit)}` : ""}
                </p>
                <p className="mt-1 text-xs">
                  {b.items.map((i) => `${i.name}: ${i.oldVersion ? `v${i.oldVersion} → ` : ""}v${i.newVersion} (${i.newState})`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {confirm && preview ? (
        <Dialog
          open
          surface="light"
          title={confirm === "publish" ? "Publish the selected prices?" : "Save the selected prices as drafts?"}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost-light" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button busy={busy === confirm} onClick={() => void apply(confirm)}>
                {confirm === "publish" ? `Publish ${rows.length} price(s)` : `Save ${rows.length} draft(s)`}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>
              {rows.length} model(s) at +{preview.markupBps / 100} % above KIE cost. Each gets a new immutable price version
              {confirm === "publish" ? " that replaces the current one for new quotes" : " in draft"}. All rows apply together or none do.
            </p>
            {confirm === "publish" ? <p>Customers who already have a quote on screen get a refreshed price; running jobs keep the price they were quoted.</p> : null}
            {losses.length ? <Notice tone="attention">{losses.length} selected model(s) lose money in the {preview.assumptions.affiliate.upliftBps / 100} % partner scenario.</Notice> : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function ModelPreview({ m, spec, checked, onToggle }: { m: PriceTable; spec: Parameters<typeof configLabel>[0]; checked: boolean; onToggle: () => void }) {
  const s = STATUS[m.status];
  return (
    <div className={cn("rounded-xl border bg-sheet", checked ? "border-brand-blue" : "border-rule")}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Include ${m.name}`}
          checked={checked}
          disabled={!m.selectable}
          onChange={onToggle}
          className="size-4 accent-brand-blue"
        />
        <span className="font-semibold text-ink-dark">{m.name}</span>
        <Badge surface="light" tone={s.tone}>
          {s.label}
        </Badge>
        {m.cost?.stale ? (
          <Badge surface="light" tone="attention">
            Cost checked {day(m.cost.checkedAt)} — stale
          </Badge>
        ) : null}
        <span className="text-sm text-muted-dark">
          {m.configCount} configuration{m.configCount === 1 ? "" : "s"} · proposed {range(m.summary.minUnits, m.summary.maxUnits, (n) => fmtGx(n))}
          {m.summary.lossConfigsUplift ? ` · ${m.summary.lossConfigsUplift} lose money at 50 %` : ""}
        </span>
      </div>
      <details open={m.configs.length <= 3} className="border-t border-rule">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-info-text">Configurations</summary>
        <div className="overflow-x-auto border-t border-rule">
          <table className="w-full min-w-[980px] text-left text-sm">
            <caption className="sr-only">{m.name}: proposed charge per configuration</caption>
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Configuration</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Current</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">KIE cost</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Target price</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Proposed</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Direct</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">30 % partner</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">50 % partner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {m.configs.map((c) => (
                <tr key={c.key}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink-dark">
                    {configLabel(spec, c.options)}
                  </th>
                  <td className="px-3 py-2 text-right tabular">{fmtGx(c.currentUnits)}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {c.supplierCredits === null ? <span className="font-semibold text-error-text">Unknown</span> : fmtUsd4(c.supplierUsd)}
                    <span className="block text-xs text-muted-dark">{fmtKie(c.supplierCredits)}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtUsd4(c.targetUsd)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular">{fmtGx(c.proposedUnits)}</td>
                  <ContributionCells c={c.contribution} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.cost ? (
          <p className="border-t border-rule px-4 py-2 text-xs text-muted-dark">
            KIE cost v{m.cost.version} · {m.cost.sourceKind} · checked {day(m.cost.checkedAt)}
            {m.status === "manual_override" ? " · This model has a manual price; it is kept unless “Also replace manual prices” is on." : ""}
          </p>
        ) : null}
      </details>
    </div>
  );
}
