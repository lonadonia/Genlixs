"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { actualMarkupPct, markupBps, valueUsd } from "@/lib/pricing/credit-math";
import { cmp, dec, toNumber } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { configLabel, fmtKie, fmtMarkup, fmtRate, fmtUsd4, inputCls, Notice } from "./shared";
import type { CatalogData, Preview, PriceTable } from "./types";

type Scope = "all" | "images" | "videos" | "selected";

const STATUS: Record<PriceTable["status"], string> = {
  ok: "",
  missing_cost: "KIE cost unknown",
  incomplete_cost: "KIE cost missing for some settings",
  no_revenue_basis: "Set the Genlixs credit value first",
  manual_override: "Price set by hand. Tick “Include prices set by hand” to change it.",
};

/**
 * Optional bulk tool: one markup above the KIE cost for all models, images, videos or chosen models, valued at the
 * Genlixs credit value shown. Preview first; settings can be kept at their current charge; "Save changes" applies
 * every chosen model in one step (or nothing), refused if anything changed since the preview.
 */
export function BulkMarkup({ data, onClose, onSaved }: { data: CatalogData; onClose: () => void; onSaved: () => void }) {
  const [scope, setScope] = useState<Scope>("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [markup, setMarkup] = useState("100");
  const [includeManual, setIncludeManual] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [kept, setKept] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "attention"; text: string } | null>(null);

  const credit = data.references?.credit ?? null;
  const rpc = credit ? dec(credit.usdPerCredit) : null;
  const bpsOk = markupBps(markup) !== null;

  const runPreview = async (note?: string) => {
    setBusy("preview");
    setMsg(note ? { tone: "attention", text: note } : null);
    try {
      const p = await api<Preview>("/api/admin/catalog/bulk-pricing/preview", {
        body: { scope, modelIds: scope === "selected" ? chosen : undefined, markupPercent: markup.trim(), includeOverrides: includeManual },
      });
      setPreview(p);
      setSelected(p.models.filter((m) => m.selectable).map((m) => m.modelId));
      setKept({});
      setAcceptLoss(false);
    } catch (e) {
      setPreview(null);
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const unitsFor = (m: PriceTable, key: string, proposed: number | null, current: number | null) => ((kept[m.modelId] ?? []).includes(key) ? current : proposed);
  const losses =
    preview && rpc
      ? preview.models
          .filter((m) => selected.includes(m.modelId))
          .flatMap((m) =>
            m.configs.filter((c) => {
              const u = unitsFor(m, c.key, c.proposedUnits, c.currentUnits);
              const cost = c.supplierUsd === null ? null : dec(c.supplierUsd);
              return u !== null && cost && cmp(valueUsd(u, rpc), cost) < 0;
            }),
          )
      : [];

  const save = async (publish: boolean) => {
    if (!preview) return;
    setBusy("save");
    setMsg(null);
    try {
      const r = await api<{ ref: string; items: unknown[] }>("/api/admin/catalog/bulk-pricing/save", {
        body: {
          scope,
          modelIds: scope === "selected" ? chosen : undefined,
          markupPercent: markup.trim(),
          includeOverrides: includeManual,
          previewRevision: preview.revision,
          selected,
          kept: Object.fromEntries(Object.entries(kept).filter(([id, list]) => selected.includes(id) && list.length)),
          publish,
          acceptLoss: losses.length > 0 && acceptLoss,
        },
      });
      setMsg({
        tone: "success",
        text: `${publish ? "Saved" : "Saved as drafts:"} ${r.items.length} model price(s) (${r.ref}). New price checks use them${publish ? " now" : " once the owner saves them"}; running jobs keep their price.`,
      });
      setPreview(null);
      onSaved();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "PREVIEW_STALE") {
        await runPreview("Prices, KIE costs or reference values changed since the preview. Here is the refreshed preview; review it and save again.");
      } else {
        setMsg({ tone: e instanceof ApiClientError && e.code === "LOSS_CONFIRMATION_REQUIRED" ? "attention" : "error", text: errorMessage(e) });
      }
    } finally {
      setBusy(null);
    }
  };

  const toggleKept = (modelId: string, key: string) =>
    setKept((all) => {
      const list = all[modelId] ?? [];
      return { ...all, [modelId]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] };
    });

  return (
    <Dialog open surface="light" size="xl" onClose={onClose} title="Apply a markup to several models">
      <div className="space-y-5">
        <p className="text-sm text-muted-dark">
          Charge = KIE cost × (1 + markup), rounded up to whole Genlixs credits at{" "}
          <strong className="text-ink-dark">{credit ? `${fmtRate(credit.usdPerCredit)} per Genlixs credit` : "no credit value"}</strong>
          {credit?.isExample ? " (example value, not confirmed)" : ""} and {fmtRate(data.references?.kie?.usdPerCredit)} per KIE credit. Package prices are compared, not used.
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink-dark">Models</legend>
            <div className="flex flex-wrap gap-2">
              {(["all", "images", "videos", "selected"] as const).map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm", scope === s ? "border-brand-blue bg-info-tint" : "border-rule")}>
                  <input type="radio" name="bulk-scope" checked={scope === s} onChange={() => setScope(s)} className="size-4 accent-brand-blue" />
                  {s === "all" ? "All" : s === "images" ? "Images" : s === "videos" ? "Videos" : "Chosen models"}
                </label>
              ))}
            </div>
            {scope === "selected" ? (
              <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-rule p-3 text-sm sm:grid-cols-2">
                {data.models.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.includes(m.id)}
                      onChange={() => setChosen(chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : [...chosen, m.id])}
                      className="size-4 accent-brand-blue"
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeManual} onChange={(e) => setIncludeManual(e.target.checked)} className="size-4 accent-brand-blue" />
              Include prices set by hand (they are kept unless you tick this)
            </label>
          </fieldset>
          <div className="flex items-end gap-2">
            <label className="grid gap-1 text-sm">
              <span className="font-semibold text-ink-dark">Markup above KIE cost (%)</span>
              <input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={!bpsOk} className={cn(inputCls, "w-32 tabular", !bpsOk && "border-error-text")} />
            </label>
            <Button variant="secondary-light" busy={busy === "preview"} disabled={!bpsOk || !rpc || (scope === "selected" && chosen.length === 0)} onClick={() => void runPreview()}>
              Preview
            </Button>
          </div>
        </div>

        {preview ? (
          <section aria-labelledby="bulk-prev-h" className="space-y-2">
            <h3 id="bulk-prev-h" className="text-sm font-semibold text-ink-dark">
              Preview: +{preview.markupBps / 100} % · {selected.length} of {preview.models.length} models chosen
            </h3>
            <ul className="divide-y divide-rule rounded-xl border border-rule">
              {preview.models.map((m) => {
                const on = selected.includes(m.modelId);
                const spec = data.models.find((x) => x.id === m.modelId)?.capability.spec;
                const units = m.configs.map((c) => unitsFor(m, c.key, c.proposedUnits, c.currentUnits)).filter((u): u is number => u !== null);
                return (
                  <li key={m.modelId} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-ink-dark">
                        <input
                          type="checkbox"
                          disabled={!m.selectable}
                          checked={on}
                          onChange={() => setSelected(on ? selected.filter((x) => x !== m.modelId) : [...selected, m.modelId])}
                          className="size-4 accent-brand-blue"
                        />
                        {m.name}
                      </label>
                      {m.selectable ? (
                        <span className="tabular text-muted-dark">
                          {units.length ? `${Math.min(...units)}–${Math.max(...units)} credits` : "—"}
                          {m.summary.minUnits !== null && m.published ? ` (now ${m.summary.minUnits}–${m.summary.maxUnits})` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-orange-text">{STATUS[m.status]}</span>
                      )}
                      {m.selectable ? (
                        <button
                          type="button"
                          aria-expanded={open === m.modelId}
                          onClick={() => setOpen(open === m.modelId ? null : m.modelId)}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-info-text"
                        >
                          Settings <ChevronDown aria-hidden className={cn("size-4 transition-transform", open === m.modelId && "rotate-180")} />
                        </button>
                      ) : null}
                    </div>
                    {open === m.modelId && rpc ? (
                      <div className="scroll-thin mt-3 overflow-x-auto" role="region" aria-label={`${m.name} settings`} tabIndex={0}>
                        <table className="w-full min-w-[720px] text-left text-sm">
                          <thead className="text-xs text-muted-dark">
                            <tr>
                              <th scope="col" className="py-1.5 pr-3 font-semibold">Change</th>
                              <th scope="col" className="py-1.5 pr-3 font-semibold">Setting</th>
                              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">KIE cost</th>
                              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Now</th>
                              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">New</th>
                              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Value</th>
                              <th scope="col" className="py-1.5 text-right font-semibold">Actual markup</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rule">
                            {m.configs.map((c) => {
                              const keep = (kept[m.modelId] ?? []).includes(c.key);
                              const u = keep ? c.currentUnits : c.proposedUnits;
                              const cost = c.supplierUsd === null ? null : dec(c.supplierUsd);
                              const v = u === null ? null : valueUsd(u, rpc);
                              const label = configLabel(spec, c.options);
                              return (
                                <tr key={c.key}>
                                  <td className="py-1.5 pr-3">
                                    <input
                                      type="checkbox"
                                      aria-label={`Change ${label}`}
                                      checked={!keep}
                                      disabled={c.currentUnits === null}
                                      onChange={() => toggleKept(m.modelId, c.key)}
                                      className="size-4 accent-brand-blue"
                                    />
                                  </td>
                                  <th scope="row" className="py-1.5 pr-3 font-medium">{label}</th>
                                  <td className="py-1.5 pr-3 text-right tabular">
                                    {fmtKie(c.supplierCredits)} <span className="text-xs text-muted-dark">{fmtUsd4(c.supplierUsd)}</span>
                                  </td>
                                  <td className="py-1.5 pr-3 text-right tabular">{c.currentUnits ?? "—"}</td>
                                  <td className={cn("py-1.5 pr-3 text-right font-semibold tabular", keep && "text-muted-dark")}>{u ?? "—"}</td>
                                  <td className="py-1.5 pr-3 text-right tabular">{v ? fmtUsd4(toNumber(v)) : "—"}</td>
                                  <td className="py-1.5 text-right tabular">{v ? fmtMarkup(actualMarkupPct(v, cost)) : "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <p className="mt-1 text-xs text-muted-dark">Untick a setting to keep its current charge.</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {losses.length ? (
              <div className="rounded-xl border border-[#f6c4c4] bg-error-tint p-4 text-sm text-error-text">
                <p className="font-semibold">{losses.length} setting(s) would be charged less than the KIE cost.</p>
                <label className="mt-2 flex items-start gap-2 font-semibold">
                  <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} className="mt-0.5 size-4 accent-brand-blue" />
                  Save anyway (recorded in the audit log).
                </label>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {data.access.canPublish ? (
                <Button busy={busy === "save"} disabled={selected.length === 0 || (losses.length > 0 && !acceptLoss)} onClick={() => void save(true)}>
                  Save changes
                </Button>
              ) : null}
              {data.access.canPrice ? (
                <Button variant={data.access.canPublish ? "ghost-light" : "primary"} busy={busy === "save"} disabled={selected.length === 0} onClick={() => void save(false)}>
                  Save as drafts
                </Button>
              ) : null}
              <span className="text-xs text-muted-dark">All chosen models change together, or none do.</span>
            </div>
          </section>
        ) : null}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </div>
    </Dialog>
  );
}
