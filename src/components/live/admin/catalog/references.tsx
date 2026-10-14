"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { cmp, dec, div, toNumber } from "@/lib/pricing/decimal";
import { perCredit } from "@/lib/pricing/credit-math";
import { cn } from "@/lib/format";
import { day, Field, fmtMarkup, fmtRate, inputCls, Notice } from "./shared";
import type { Reference } from "./types";

type Kind = Reference["kind"];
type Impact = {
  usdPerCredit: number;
  models: { modelId: string; name: string; before: Mark; after: Mark }[];
  note: string;
};
type Mark = { markupMin: number | null; markupMax: number | null; belowCost: number | null };

const COPY: Record<Kind, { title: string; sub: string; amount: string; credits: string; unit: string; placeholder: [string, string] }> = {
  kie_purchase: {
    title: "KIE credit cost",
    sub: "What one KIE credit costs Genlixs, from a KIE top-up: the amount paid and the KIE credits received.",
    amount: "Amount paid (USD)",
    credits: "KIE credits received",
    unit: "per KIE credit",
    placeholder: ["5.00", "1000"],
  },
  credit_value: {
    title: "Genlixs credit value",
    sub: "The USD reference value of one Genlixs credit. Model charges are calculated from it; packages are compared with it.",
    amount: "Amount (USD)",
    credits: "Genlixs credits",
    unit: "per Genlixs credit",
    placeholder: ["5.00", "250"],
  },
};

const same = (a: string, b: number | null | undefined) => {
  const x = dec(a);
  const y = b === null || b === undefined ? null : dec(b);
  return x && y ? cmp(x, y) === 0 : !x && !y;
};

/** The two reference values. Saving one adds a version; it never changes balances, purchases or current prices. */
export function ReferenceCards({
  kie,
  credit,
  canEdit,
  pricedModels,
  onSaved,
  onRecalculate,
}: {
  kie: Reference | null;
  credit: Reference | null;
  canEdit: boolean;
  pricedModels: number;
  onSaved: () => void;
  onRecalculate: () => void;
}) {
  const kieRate = kie ? dec(kie.usdPerCredit) : null;
  const creditRate = credit ? dec(credit.usdPerCredit) : null;
  const ratio = kieRate && creditRate && kieRate.m > BigInt(0) ? toNumber(div(creditRate, kieRate, 4)) : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReferenceCard kind="kie_purchase" current={kie} canEdit={canEdit} pricedModels={pricedModels} onSaved={onSaved} onRecalculate={onRecalculate} />
        <ReferenceCard kind="credit_value" current={credit} canEdit={canEdit} pricedModels={pricedModels} onSaved={onSaved} onRecalculate={onRecalculate} />
      </div>
      {ratio !== null ? (
        <p className="text-sm text-muted-dark">
          One Genlixs credit is worth {ratio.toLocaleString("en-US", { maximumFractionDigits: 2 })} KIE credits ({fmtMarkup((ratio - 1) * 100)} in value). Customer
          and KIE balances are separate: a Genlixs credit is never the same thing as a KIE credit.
        </p>
      ) : null}
    </div>
  );
}

function ReferenceCard({
  kind,
  current,
  canEdit,
  pricedModels,
  onSaved,
  onRecalculate,
}: {
  kind: Kind;
  current: Reference | null;
  canEdit: boolean;
  pricedModels: number;
  onSaved: () => void;
  onRecalculate: () => void;
}) {
  const copy = COPY[kind];
  const [amount, setAmount] = useState(current ? String(current.amountUsd) : "");
  const [credits, setCredits] = useState(current ? String(current.credits) : "");
  const [bonus, setBonus] = useState(current && current.bonusCredits ? String(current.bonusCredits) : "");
  const [source, setSource] = useState(current?.sourceUrl ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [impact, setImpact] = useState<{ key: string; data: Impact } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "attention"; text: string; recalc?: boolean } | null>(null);

  const rate = perCredit(amount, credits);
  const amountOk = /^\d{1,9}(\.\d{1,2})?$/.test(amount.trim()) && rate !== null;
  const creditsOk = kind === "credit_value" ? /^\d{1,9}$/.test(credits.trim()) : /^\d{1,9}(\.\d{1,2})?$/.test(credits.trim());
  const bonusOk = kind === "credit_value" || bonus.trim() === "" || (/^\d{1,9}(\.\d{1,2})?$/.test(bonus.trim()) && Number(bonus) < Number(credits));
  const valid = amountOk && creditsOk && bonusOk;
  const numbersChanged = !current || !same(amount, current.amountUsd) || !same(credits, current.credits);
  const changed =
    numbersChanged ||
    (kind === "kie_purchase" && !same(bonus || "0", current?.bonusCredits ?? 0)) ||
    (source.trim() || null) !== (current?.sourceUrl ?? null) ||
    (note.trim() || null) !== (current?.note ?? null) ||
    Boolean(current?.isExample);

  // What the new value would mean for current prices (nothing is saved while typing).
  const impactKey = valid && numbersChanged && pricedModels > 0 ? `${amount.trim()}|${credits.trim()}` : null;
  useEffect(() => {
    if (!impactKey) return;
    const [a, c] = impactKey.split("|");
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api<Impact>("/api/admin/pricing/references/impact", { body: { kind, amountUsd: a, credits: c }, signal: ac.signal })
        .then((data) => setImpact({ key: impactKey, data }))
        .catch(() => undefined);
    }, 500);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [kind, impactKey]);
  const shownImpact = impact && impact.key === impactKey ? impact.data : null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ unchanged: boolean; reference: Reference }>("/api/admin/pricing/references", {
        body: {
          kind,
          amountUsd: amount.trim(),
          credits: credits.trim(),
          bonusCredits: kind === "kie_purchase" ? bonus.trim() || "0" : undefined,
          sourceUrl: source.trim() || null,
          note: note.trim() || null,
          expectedVersionId: current?.id ?? null,
        },
      });
      setMsg(
        r.unchanged
          ? { tone: "success", text: "Nothing changed." }
          : {
              tone: "success",
              text: `Saved as version ${r.reference.version}. Wallet balances, purchases, quotes, running jobs and current prices did not change.`,
              recalc: pricedModels > 0,
            },
      );
      setImpact(null);
      onSaved();
    } catch (e) {
      setMsg({ tone: e instanceof ApiClientError && e.code === "REFERENCE_CHANGED" ? "attention" : "error", text: errorMessage(e) });
      if (e instanceof ApiClientError && e.code === "REFERENCE_CHANGED") onSaved();
    } finally {
      setBusy(false);
    }
  };

  const id = `ref-${kind}`;
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-h`} className="text-base font-semibold text-ink-dark">
          {copy.title}
        </h3>
        {current?.isExample ? (
          <Badge surface="light" tone="attention">
            Example value, not confirmed
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-dark">{copy.sub}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={copy.amount}>
          <input
            inputMode="decimal"
            value={amount}
            placeholder={copy.placeholder[0]}
            disabled={!canEdit}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-invalid={amount !== "" && !amountOk}
            className={cn(inputCls, "w-full min-w-0 tabular", amount !== "" && !amountOk && "border-error-text")}
          />
        </Field>
        <Field label={copy.credits}>
          <input
            inputMode={kind === "credit_value" ? "numeric" : "decimal"}
            value={credits}
            placeholder={copy.placeholder[1]}
            disabled={!canEdit}
            onChange={(e) => setCredits(e.target.value.replace(kind === "credit_value" ? /[^0-9]/g : /[^0-9.]/g, ""))}
            aria-invalid={credits !== "" && !creditsOk}
            className={cn(inputCls, "w-full min-w-0 tabular", credits !== "" && !creditsOk && "border-error-text")}
          />
        </Field>
      </div>
      <p className="mt-3 text-[1.5rem] leading-tight font-semibold tabular text-ink-dark" aria-live="polite">
        {rate ? fmtRate(toNumber(rate)) : "—"} <span className="text-sm font-normal text-muted-dark">{copy.unit}</span>
      </p>
      {kind === "kie_purchase" && Number(bonus) > 0 ? (
        <p className="text-xs text-muted-dark">Assumes the {bonus} bonus credits included in this top-up; without them the rate would be higher.</p>
      ) : null}
      {current?.isExample ? <p className="mt-1 text-xs text-orange-text">{current.note}</p> : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink-dark">{kind === "kie_purchase" ? "Bonus credits and source" : "Note"}</summary>
        <div className="mt-2 grid gap-3">
          {kind === "kie_purchase" ? (
            <>
              <Field label="Of which bonus credits (optional)" hint="Top-up bonus included in the credits received.">
                <input inputMode="decimal" value={bonus} placeholder="0" disabled={!canEdit} onChange={(e) => setBonus(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(inputCls, "w-full min-w-0 tabular")} />
              </Field>
              <Field label="Source link (optional)" hint="For example your KIE billing page or the pricing page.">
                <input value={source} maxLength={300} placeholder="https://kie.ai/pricing" disabled={!canEdit} onChange={(e) => setSource(e.target.value)} className={cn(inputCls, "w-full min-w-0")} />
              </Field>
            </>
          ) : null}
          <Field label="Note (optional)">
            <input value={note} maxLength={500} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "w-full min-w-0")} />
          </Field>
        </div>
      </details>

      {shownImpact ? <ImpactLine impact={shownImpact} /> : null}
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" busy={busy} disabled={!valid || !changed} onClick={() => void save()}>
            {current?.isExample && !numbersChanged ? "Confirm this value" : "Save"}
          </Button>
          {!changed && current ? <span className="text-xs text-muted-dark">Saved {day(current.createdAt)} · version {current.version}</span> : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-dark">Only finance staff and the owner can change reference values.</p>
      )}
      {msg ? (
        <div className="mt-3">
          <Notice
            tone={msg.tone}
            action={
              msg.recalc ? (
                <Button size="sm" variant="secondary-light" onClick={onRecalculate}>
                  Recalculate prices
                </Button>
              ) : undefined
            }
          >
            {msg.text}
          </Notice>
        </div>
      ) : null}
      {current?.sourceUrl && !current.isExample ? (
        <p className="mt-3 text-xs text-muted-dark">
          Source:{" "}
          <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
            {current.sourceUrl.replace(/^https:\/\//, "")}
          </a>
        </p>
      ) : null}
    </section>
  );
}

function ImpactLine({ impact }: { impact: Impact }) {
  const min = Math.min(...impact.models.map((m) => m.after.markupMin ?? Infinity));
  const max = Math.max(...impact.models.map((m) => m.after.markupMax ?? -Infinity));
  const below = impact.models.filter((m) => (m.after.belowCost ?? 0) > 0);
  return (
    <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm text-ink-dark" aria-live="polite">
      Current prices stay as they are. At this value, the {impact.models.length} priced model{impact.models.length === 1 ? "" : "s"} would have a markup of{" "}
      {Number.isFinite(min) ? `${fmtMarkup(min * 100)} to ${fmtMarkup(max * 100)}` : "—"}
      {below.length ? `; ${below.length} would charge less than the KIE cost for some settings` : ""}. You can recalculate prices after saving.
    </p>
  );
}
