"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import {
  actualMarkupPct,
  chargeForTarget,
  contributionUsd,
  kieCostUsd,
  creditCountDifferencePct,
  markupBps,
  packageRate,
  targetFromMarkup,
  valueUsd,
} from "@/lib/pricing/credit-math";
import { cmp, dec, round, toNumber, toString, type Dec } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { packageGroups } from "./packages-editor";
import { configLabel, day, Empty, fmtKie, fmtMarkup, fmtRate, fmtUsd4, inputCls, Notice, when } from "./shared";
import type { ModelDetail, ProductRow } from "./types";

type Mode = "units" | "usd" | "markup";
type Input = { mode: Mode; text: string };
type Row = { key: string; label: string; kieCredits: number | null; cost: Dec | null; current: number | null };
type Resolved = { units: number | null; value: Dec | null; target: Dec | null; markup: number | null; rounded: boolean };

const FIELDS = ["units", "usd", "markup"] as const;
const WIDE = "(min-width: 768px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** Table on wide screens, one card per setting on phones (no sideways scrolling to reach the inputs). */
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

const EXTRA = "__extra";
const decOf = (n: number | null | undefined) => (n === null || n === undefined ? null : dec(n));
const usdText = (d: Dec | null) => (d ? toString(round(d, 6)) : "");

/** Charge, value and actual markup from whichever of the three fields was edited (the others follow, never the reverse). */
function resolve(row: Row, input: Input | undefined, rpc: Dec | null): Resolved {
  const empty: Resolved = { units: null, value: null, target: null, markup: null, rounded: false };
  const text = input?.text.trim() ?? "";
  if (!input || text === "" || !rpc) return empty;
  let units: number | null = null;
  let target: Dec | null = null;
  if (input.mode === "units") {
    units = /^\d{1,7}$/.test(text) && Number(text) >= 1 && Number(text) <= 1_000_000 ? Number(text) : null;
  } else if (input.mode === "usd") {
    const t = /^\d{1,7}(\.\d{1,8})?$/.test(text) ? dec(text) : null;
    if (t && t.m > BigInt(0)) {
      target = t;
      units = chargeForTarget(t, rpc);
    }
  } else {
    const bps = markupBps(text);
    if (bps !== null && row.cost) {
      target = targetFromMarkup(row.cost, bps);
      units = chargeForTarget(target, rpc);
    }
  }
  if (units === null) return empty;
  const value = valueUsd(units, rpc);
  return { units, value, target, markup: actualMarkupPct(value, row.cost), rounded: Boolean(target && cmp(value, target) !== 0) };
}

/**
 * Credit charge for one model, per configuration. Three linked fields set it: Genlixs credits, a USD value, or a
 * markup above the KIE cost; the field you type in drives the other two. Charges round up to whole credits. Saving
 * creates a new immutable price version; quotes and debits only ever use the saved server price.
 */
export function PriceEditor({ modelId, products, onClose, onSaved }: { modelId: string; products: ProductRow[]; onClose: () => void; onSaved: () => void }) {
  const d = useApi<ModelDetail>(`/api/admin/catalog/models/${modelId}`);
  // Kept here because the editor below restarts from the new saved version after a save.
  const [flash, setFlash] = useState<string | null>(null);
  const title = d.data ? `Price: ${d.data.model.name}` : "Loading price…";
  return (
    <Dialog open surface="light" size="xl" onClose={onClose} title={title} description={d.data ? <Header d={d.data} /> : undefined}>
      {d.error ? <Notice tone="error">{d.error.message}</Notice> : null}
      {flash ? (
        <div className="mb-4">
          <Notice tone="success">{flash}</Notice>
        </div>
      ) : null}
      {!d.data ? (
        <div role="status" aria-busy="true" aria-label="Loading price" className="h-48 animate-pulse-soft rounded-xl bg-paper" />
      ) : (
        <Editor
          key={`${d.data.table?.published?.id ?? ""}:${d.data.table?.draft?.id ?? ""}`}
          d={d.data}
          products={products}
          reload={d.reload}
          onSaved={(text) => {
            setFlash(text);
            d.reload();
            onSaved();
          }}
        />
      )}
    </Dialog>
  );
}

function Header({ d }: { d: ModelDetail }) {
  const t = d.table;
  const basis = d.economics?.basis;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        {d.model.tool === "video" ? "Video" : d.model.tool === "edit" ? "Image edit" : "Image"}
        {d.model.variant ? ` · ${d.model.variant}` : ""}
      </span>
      {t?.cost ? (
        <span>
          KIE cost v{t.cost.version} ({t.cost.sourceKind === "documented" ? "KIE pricing page" : t.cost.sourceKind}, checked {day(t.cost.checkedAt)})
        </span>
      ) : null}
      {basis?.usdPerCredit ? (
        <span>
          {fmtRate(basis.usdPerCredit)} per Genlixs credit · {fmtRate(d.economics?.assumptions.usdPerKieCredit)} per KIE credit
        </span>
      ) : null}
    </span>
  );
}

function Editor({ d, products, reload, onSaved }: { d: ModelDetail; products: ProductRow[]; reload: () => void; onSaved: (message: string) => void }) {
  const t = d.table;
  const spec = d.model.capability.spec;
  const rpc = decOf(d.economics?.basis.usdPerCredit ?? null);
  const a = d.economics?.assumptions;
  const rows: Row[] = useMemo(() => {
    if (!t) return [];
    const list: Row[] = t.configs.map((c) => ({
      key: c.key,
      label: configLabel(spec, c.options),
      kieCredits: c.supplierCredits,
      cost: decOf(c.supplierUsd),
      current: c.currentUnits,
    }));
    const extra = t.cost?.extraReference;
    if (extra && t.cost) {
      const kieUsd = decOf(t.cost.usdPerCredit);
      list.push({
        key: EXTRA,
        label: `Each extra reference image (after ${extra.free} free)`,
        kieCredits: extra.credits,
        cost: kieCostUsd(extra.credits, kieUsd),
        current: t.published?.perExtraReference?.units ?? null,
      });
    }
    return list;
  }, [t, spec]);

  const draftUsable = t?.draft?.currentCapability ? t.draft : null;
  const [inputs, setInputs] = useState<Record<string, Input>>(() => {
    const init: Record<string, Input> = {};
    for (const c of t?.configs ?? []) {
      const n = draftUsable ? c.draftUnits : c.currentUnits;
      if (n !== null && n !== undefined) init[c.key] = { mode: "units", text: String(n) };
    }
    const extraUnits = (draftUsable ?? t?.published)?.perExtraReference?.units;
    if (extraUnits) init[EXTRA] = { mode: "units", text: String(extraUnits) };
    return init;
  });
  const [allMarkup, setAllMarkup] = useState("");
  const [compareKey, setCompareKey] = useState<string>(rows[0]?.key ?? "");
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [busy, setBusy] = useState<"publish" | "draft" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "attention"; text: string; reload?: boolean } | null>(null);
  const wide = useWide();

  if (!t) return <Notice>Your role cannot see KIE costs, so it cannot edit prices.</Notice>;
  if (t.status === "missing_cost" || t.status === "incomplete_cost") {
    return <Notice tone="error" title="The KIE cost is unknown">Prices need a KIE cost for every setting. Record it under Models → Details → KIE cost.</Notice>;
  }
  if (!rpc) return <Notice tone="attention" title="Set the Genlixs credit value first">Charges are calculated from the Genlixs credit value on the Pricing page.</Notice>;

  const resolved = Object.fromEntries(rows.map((r) => [r.key, resolve(r, inputs[r.key], rpc)])) as Record<string, Resolved>;
  const complete = rows.every((r) => resolved[r.key].units !== null);
  const losses = rows.filter((r) => {
    const v = resolved[r.key].value;
    return v && r.cost && cmp(v, r.cost) < 0;
  });
  const unchanged = rows.every((r) => resolved[r.key].units === r.current);
  const canSave = d.access.canPrice || d.access.canPublish;

  const setField = (key: string, mode: Mode, text: string) => {
    setInputs((all) => ({ ...all, [key]: { mode, text } }));
    setMsg(null);
  };
  const applyAll = () => {
    if (markupBps(allMarkup) === null) return;
    setInputs(Object.fromEntries(rows.map((r) => [r.key, { mode: "markup" as const, text: allMarkup.trim() }])));
    setMsg(null);
  };

  const save = async (publish: boolean) => {
    setBusy(publish ? "publish" : "draft");
    setMsg(null);
    try {
      const units = Object.fromEntries(rows.filter((r) => r.key !== EXTRA).map((r) => [r.key, resolved[r.key].units]));
      const r = await api<{ unchanged: boolean; version: number; state: string }>(`/api/admin/catalog/models/${d.model.id}/price`, {
        body: {
          units,
          extraReferenceUnits: resolved[EXTRA]?.units ?? undefined,
          publish,
          acceptLoss: losses.length > 0 && acceptLoss,
          expectedPriceVersionId: t.published?.id ?? t.draft?.id ?? null,
        },
      });
      if (r.unchanged) setMsg({ tone: "success", text: "No changes to save." });
      else
        onSaved(
          publish
            ? `Saved as price v${r.version}. New price checks use it now; jobs already running keep the price they were quoted.`
            : `Saved as draft v${r.version}. Customers still see the current price until the owner saves it.`,
        );
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "";
      setMsg({ tone: code === "PRICE_CHANGED" || code === "LOSS_CONFIRMATION_REQUIRED" ? "attention" : "error", text: errorMessage(e), reload: code === "PRICE_CHANGED" });
    } finally {
      setBusy(null);
    }
  };

  const fieldValue = (r: Row, field: Mode) => {
    const inp = inputs[r.key];
    if (inp?.mode === field) return inp.text;
    const x = resolved[r.key];
    if (x.units === null) return "";
    if (field === "units") return String(x.units);
    if (field === "usd") return usdText(x.value);
    return x.markup === null ? "" : String(Math.round(x.markup * 100) / 100);
  };

  const fieldInput = (r: Row, field: Mode, size: string) => (
    <input
      aria-label={`${field === "units" ? "Genlixs credits" : field === "usd" ? "Value in USD" : "Markup percent"} for ${r.label}`}
      inputMode={field === "units" ? "numeric" : "decimal"}
      value={fieldValue(r, field)}
      disabled={!canSave}
      onFocus={() => setCompareKey(r.key)}
      onChange={(e) => setField(r.key, field, e.target.value.replace(field === "units" ? /[^0-9]/g : /[^0-9.]/g, ""))}
      className={cn(inputCls, size, "text-right tabular", inputs[r.key]?.mode === field && "border-brand-blue")}
    />
  );
  const resultText = (r: Row) => {
    const x = resolved[r.key];
    if (x.units === null) return <span className="text-error-text">Enter a charge</span>;
    const loss = x.value && r.cost && cmp(x.value, r.cost) < 0;
    return (
      <span className={cn(loss ? "font-semibold text-error-text" : "text-ink-dark")}>
        {x.units} cr = {fmtUsd4(toNumber(x.value!))} · {fmtMarkup(x.markup)}
        {loss ? " · below KIE cost" : ""}
        {x.rounded && x.target ? <span className="block font-normal text-muted-dark">rounded up from {fmtUsd4(toNumber(x.target))}</span> : null}
      </span>
    );
  };

  const compare = rows.find((r) => r.key === compareKey) ?? rows[0];
  return (
    <div className="space-y-5">
      {draftUsable ? <Notice>Draft v{draftUsable.version} is loaded. Saving replaces the current price with these values.</Notice> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink-dark">Markup for every setting (%)</span>
          <input inputMode="decimal" value={allMarkup} placeholder="100" onChange={(e) => setAllMarkup(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(inputCls, "w-32 tabular")} />
        </label>
        <Button variant="secondary-light" disabled={markupBps(allMarkup) === null} onClick={applyAll}>
          Apply to all settings
        </Button>
        <p className="basis-full text-xs text-muted-dark">+100 % means twice the KIE cost. Charges round up to whole Genlixs credits.</p>
      </div>

      {wide ? (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-rule" role="region" aria-label="Charge per setting" tabIndex={0}>
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Genlixs credit charge per setting, with KIE cost, value and markup</caption>
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Setting</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">KIE cost</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Genlixs credits</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Value (USD)</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Markup (%)</th>
                <th scope="col" className="px-3 py-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((r) => (
                <tr key={r.key} className={cn(compare?.key === r.key && "bg-paper/60")}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink-dark">
                    {r.label}
                    {r.current !== null ? <span className="block text-xs font-normal text-muted-dark">Now: {r.current} credits</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular">
                    {fmtKie(r.kieCredits)}
                    <span className="block text-xs text-muted-dark">{r.cost ? fmtUsd4(toNumber(r.cost)) : "Unknown"}</span>
                  </td>
                  {FIELDS.map((field) => (
                    <td key={field} className="px-2 py-2 text-right">
                      {fieldInput(r, field, "h-9 w-24")}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">{resultText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="Charge per setting" className="divide-y divide-rule rounded-xl border border-rule">
          {rows.map((r) => (
            <li key={r.key} className={cn("space-y-2 p-3", compare?.key === r.key && "bg-paper/60")}>
              <div className="flex items-start justify-between gap-3 text-sm">
                <p className="font-medium text-ink-dark">
                  {r.label}
                  {r.current !== null ? <span className="block text-xs font-normal text-muted-dark">Now: {r.current} credits</span> : null}
                </p>
                <p className="text-right tabular">
                  {fmtKie(r.kieCredits)}
                  <span className="block text-xs text-muted-dark">{r.cost ? fmtUsd4(toNumber(r.cost)) : "Unknown"}</span>
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FIELDS.map((field) => (
                  <div key={field} className="grid min-w-0 gap-1 text-xs">
                    <span aria-hidden className="font-semibold text-muted-dark">
                      {field === "units" ? "Credits" : field === "usd" ? "Value $" : "Markup %"}
                    </span>
                    {fieldInput(r, field, "h-10 w-full min-w-0")}
                  </div>
                ))}
              </div>
              <p className="text-xs">{resultText(r)}</p>
            </li>
          ))}
        </ul>
      )}

      {compare && resolved[compare.key]?.units !== null ? (
        <Comparison row={compare} res={resolved[compare.key]} rpc={rpc} products={products} rows={rows} setKey={setCompareKey} commission={a?.affiliate} />
      ) : null}

      {losses.length ? (
        <div className="rounded-xl border border-[#f6c4c4] bg-error-tint p-4 text-sm text-error-text">
          <p className="font-semibold">
            {losses.length} setting{losses.length === 1 ? "" : "s"} would be charged less than the KIE cost.
          </p>
          <label className="mt-2 flex items-start gap-2 font-semibold">
            <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} className="mt-0.5 size-4 accent-brand-blue" />
            Save anyway (recorded in the audit log).
          </label>
        </div>
      ) : null}

      {canSave ? (
        <div className="flex flex-wrap items-center gap-2">
          {d.access.canPublish ? (
            <Button busy={busy === "publish"} disabled={!complete || unchanged || (losses.length > 0 && !acceptLoss)} onClick={() => void save(true)}>
              Save price
            </Button>
          ) : null}
          <Button
            variant={d.access.canPublish ? "ghost-light" : "primary"}
            busy={busy === "draft"}
            disabled={!complete || unchanged}
            onClick={() => void save(false)}
          >
            Save as draft
          </Button>
          {!complete ? <span className="text-xs text-muted-dark">Every setting needs a charge of at least 1 credit.</span> : null}
          {!d.access.canPublish ? <span className="text-xs text-muted-dark">The owner applies drafts.</span> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-dark">Your role can view prices but not change them.</p>
      )}
      {msg ? (
        <Notice
          tone={msg.tone}
          action={
            msg.reload ? (
              <Button size="sm" variant="secondary-light" onClick={reload}>
                Reload
              </Button>
            ) : undefined
          }
        >
          {msg.text}
        </Notice>
      ) : null}
      <History d={d} onChanged={onSaved} />
    </div>
  );
}

/** One setting's charge against the credit value and every package (estimates before payment fees and running costs). */
function Comparison({
  row,
  res,
  rpc,
  products,
  rows,
  setKey,
  commission,
}: {
  row: Row;
  res: Resolved;
  rpc: Dec;
  products: ProductRow[];
  rows: Row[];
  setKey: (k: string) => void;
  commission?: { baseBps: number; upliftBps: number };
}) {
  const n = res.units!;
  const base = commission?.baseBps ?? 3000;
  const up = commission?.upliftBps ?? 5000;
  const lines = [
    { label: "At the credit value", note: "", rate: rpc },
    ...packageGroups(products).flatMap((g) => {
      const pr = packageRate(g.current.amountMinor, g.current.includedCredits ?? g.current.credits, g.current.bonusCredits ?? 0);
      return pr ? [{ label: g.current.name, note: g.offered ? "" : "not offered", rate: pr.usdPerCredit }] : [];
    }),
  ];
  const diff = creditCountDifferencePct(n, row.kieCredits);
  return (
    <section aria-labelledby="cmp-h" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cmp-h" className="text-sm font-semibold text-ink-dark">
          Package comparison
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-dark">Setting</span>
          <select value={row.key} onChange={(e) => setKey(e.target.value)} className={cn(inputCls, "h-9")}>
            {rows.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {row.kieCredits !== null && diff !== null ? (
        <p className="text-xs text-muted-dark">
          {n} Genlixs credits for {fmtKie(row.kieCredits)}: {Math.abs(diff).toLocaleString("en-US", { maximumFractionDigits: 1 })} % {diff < 0 ? "fewer" : "more"} credits in
          number, worth {fmtMarkup(res.markup)} in value.
        </p>
      ) : null}
      <div className="scroll-thin overflow-x-auto rounded-xl border border-rule" role="region" aria-label="Package comparison table" tabIndex={0}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Value and contribution of this charge at the credit value and at each package rate</caption>
          <thead className="bg-paper text-xs text-muted-dark">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Bought with</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Per credit</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Value of {n} cr</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Contribution</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">With {base / 100} % partner</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">With {up / 100} % partner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {lines.map((l) => {
              const v = valueUsd(n, l.rate);
              return (
                <tr key={l.label}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink-dark">
                    {l.label} {l.note ? <span className="text-xs font-normal text-muted-dark">({l.note})</span> : null}
                  </th>
                  <td className="px-3 py-2 text-right tabular">{fmtRate(toNumber(l.rate))}</td>
                  <td className="px-3 py-2 text-right tabular">{fmtUsd4(toNumber(v))}</td>
                  {[0, base, up].map((bps) => (
                    <td key={bps} className="px-3 py-2 text-right">
                      <MoneyCell value={contributionUsd(v, row.cost, bps)} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-dark">Contribution = value, less partner commission, less the KIE cost. Estimates before payment fees and running costs.</p>
    </section>
  );
}

function MoneyCell({ value }: { value: Dec | null }) {
  if (!value) return <span className="text-muted-dark">—</span>;
  const n = toNumber(value);
  return <span className={cn("tabular", n < 0 && "font-semibold text-error-text")}>{fmtUsd4(n)}{n < 0 ? " loss" : ""}</span>;
}

function History({ d, onChanged }: { d: ModelDetail; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <details className="rounded-xl border border-rule p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-ink-dark">Price history ({d.prices.length})</summary>
      <p className="mt-2 text-xs text-muted-dark">Saved prices never change. Restoring an earlier one saves it again as a new version.</p>
      {d.prices.length === 0 ? (
        <div className="mt-2">
          <Empty>No price saved yet.</Empty>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {d.prices.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-semibold">v{p.version}</span>
              <Badge surface="light" tone={p.state === "published" ? "success" : p.state === "draft" ? "info" : "neutral"} icon="none">
                {p.state === "published" ? "In use" : p.state === "draft" ? "Draft" : "Earlier"}
              </Badge>
              <span className="text-muted-dark">
                {p.source === "bulk" && p.markupBps !== null ? `markup +${p.markupBps / 100} %` : p.source === "restore" ? `copy of v${p.restoredFromVersion}` : "set by hand"}
                {p.effectiveAt ? ` · from ${when(p.effectiveAt)}` : ` · ${when(p.createdAt)}`}
                {p.publishedBy ?? p.createdBy ? ` · ${p.publishedBy ?? p.createdBy}` : ""}
                {!p.currentCapability ? " · older options" : ""}
              </span>
              {d.access.canPublish && p.state === "retired" && p.currentCapability && p.source !== "seed" ? (
                <Button
                  size="sm"
                  variant="ghost-light"
                  className="ml-auto"
                  busy={busy === p.id}
                  onClick={async () => {
                    setBusy(p.id);
                    setErr(null);
                    try {
                      await api(`/api/admin/catalog/prices/${p.id}/restore`, { body: {} });
                      onChanged(`Restored v${p.version} as a new version. New price checks use it now.`);
                    } catch (e) {
                      setErr(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Restore
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {err ? <Notice tone="error">{err}</Notice> : null}
    </details>
  );
}
