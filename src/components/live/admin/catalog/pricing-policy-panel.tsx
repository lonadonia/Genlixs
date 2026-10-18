"use client";

import { useEffect, useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { cn } from "@/lib/format";
import { money } from "../providers/parts";
import { configLabel, day, fmtRate, inputCls, Notice } from "./shared";
import { parseCreditValue, parseMarkup, type PolicyApplyResult, type PolicyPreview, type PolicyRead } from "./policy";
import type { AdminModel } from "./types";

type Msg = { tone: "error" | "success" | "attention"; text: string } | null;

const trimNum = (n: number) => String(Number(n.toFixed(6)));

/**
 * The one place prices are set: a markup on the KIE reference cost and the USD value of one Genlixs credit. Changing
 * either shows a small preview from the server (affected models and a few example requests); Save & apply versions the
 * policy and re-prices every model in one transaction. Only the owner can apply; finance can preview.
 */
export function PricingPolicyPanel({
  read,
  models,
  applied,
  onApplied,
}: {
  read: PolicyRead;
  models: AdminModel[];
  /** The last Save & apply of this page; kept by the page because the panel restarts on a new policy version. */
  applied: PolicyApplyResult | null;
  onApplied: (r: PolicyApplyResult) => void;
}) {
  const p = read.policy;
  const id = useId();
  const [markup, setMarkup] = useState(p ? trimNum(p.markupPercent) : "100");
  const [credit, setCredit] = useState(p ? trimNum(p.usdPerCredit) : "");
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const m = parseMarkup(markup);
  const v = parseCreditValue(credit);
  const changed = Boolean(p) && m !== null && v !== null && (m !== p!.markupPercent || v !== p!.usdPerCredit);
  const editable = read.canPreview || read.canApply;

  // A preview for the values being typed (debounced; the server computes it, nothing is saved).
  useEffect(() => {
    if (!changed || !read.canPreview || m === null || v === null) return;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setPreviewError(null);
      api<PolicyPreview>("/api/admin/catalog/policy/preview", { body: { markupPercent: String(m), usdPerCredit: String(v) }, signal: ac.signal })
        .then(setPreview)
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setPreviewError(errorMessage(e));
        });
    }, 400);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [changed, m, v, read.canPreview]);
  const shown = changed && preview && preview.proposed.markupPercent === m && preview.proposed.usdPerCredit === v ? preview : null;

  const apply = async () => {
    if (!p || m === null || v === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<PolicyApplyResult>("/api/admin/catalog/policy/apply", {
        body: { markupPercent: String(m), usdPerCredit: String(v), expectedPolicyId: p.policyId },
      });
      setPreview(null);
      onApplied(r);
    } catch (e) {
      setMsg({ tone: e instanceof ApiClientError && e.code === "POLICY_CHANGED" ? "attention" : "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (!p) return;
    setMarkup(trimNum(p.markupPercent));
    setCredit(trimNum(p.usdPerCredit));
    setPreview(null);
    setMsg(null);
  };

  const spec = (modelId: string) => models.find((x) => x.id === modelId)?.capability.spec;

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="rounded-[var(--radius-media)] border border-[#c7cefd] bg-sheet p-4 shadow-[var(--shadow-lift)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <h2 id={`${id}-h`} className="text-base font-semibold text-ink-dark">
          Pricing
        </h2>
        {p ? (
          <p className="text-xs text-muted-dark">
            Policy v{p.version} · saved {day(p.createdAt)}
            {p.createdBy ? ` by ${p.createdBy}` : ""} · KIE credit {fmtRate(p.kieUsdPerCredit)}
          </p>
        ) : null}
      </div>
      <p className="mt-0.5 text-sm text-muted-dark">Selling prices follow KIE × your markup. Cheaper suppliers increase your profit.</p>

      {!p ? (
        <div className="mt-3">
          <Notice tone="error">The pricing policy is missing, so no model can be priced. Apply the automatic pricing migration.</Notice>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (read.canApply && changed && !busy) void apply();
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-ink-dark">Markup on KIE cost (%)</span>
            <span className="relative inline-block w-36">
              <input
                inputMode="decimal"
                value={markup}
                disabled={!editable || busy}
                aria-invalid={m === null}
                aria-describedby={`${id}-m`}
                onChange={(e) => setMarkup(e.target.value.replace(/[^0-9.]/g, ""))}
                className={cn(inputCls, "w-full pr-8 tabular", m === null && "border-error-text")}
              />
              <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-dark">
                %
              </span>
            </span>
            <span id={`${id}-m`} className="text-xs text-muted-dark">
              {m === null ? "0 to 2000, at most 2 decimals" : `Sells for ${trimNum(1 + m / 100)} × the KIE cost`}
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-ink-dark">USD value of one Genlixs credit</span>
            <span className="relative inline-block w-36">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-dark">
                $
              </span>
              <input
                inputMode="decimal"
                value={credit}
                disabled={!editable || busy}
                aria-invalid={v === null}
                aria-describedby={`${id}-v`}
                onChange={(e) => setCredit(e.target.value.replace(/[^0-9.]/g, ""))}
                className={cn(inputCls, "w-full pl-7 tabular", v === null && "border-error-text")}
              />
            </span>
            <span id={`${id}-v`} className="text-xs text-muted-dark">
              {v === null ? "More than $0, at most 6 decimals" : `${Math.round(1 / v).toLocaleString("en-US")} credits ≈ $1`}
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pb-5">
            {read.canApply ? (
              <Button type="submit" busy={busy} disabled={!changed}>
                Save &amp; apply
              </Button>
            ) : null}
            {changed ? (
              <Button type="button" variant="ghost-light" onClick={reset} disabled={busy}>
                Reset
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {p && !read.canApply ? (
        <p className="text-xs text-muted-dark">{read.canPreview ? "You can preview a change; only the owner can apply it." : "Only the owner can change pricing."}</p>
      ) : null}

      {changed && read.canPreview ? (
        <div aria-live="polite" className="mt-3 rounded-xl border border-rule bg-paper/70 px-4 py-3">
          {previewError ? (
            <p className="text-sm text-error-text">{previewError}</p>
          ) : !shown ? (
            <p className="text-sm text-muted-dark">Calculating the new prices…</p>
          ) : (
            <>
              <p className="text-sm text-ink-dark">
                <span className="font-semibold tabular">{shown.affectedModels}</span> model{shown.affectedModels === 1 ? "" : "s"} change price
                {shown.unchangedModels ? <span className="text-muted-dark"> · {shown.unchangedModels} unchanged</span> : null}
                {shown.needsKieReference.length ? <span className="text-orange-text"> · {shown.needsKieReference.length} need a KIE reference</span> : null}
              </p>
              {shown.examples.length ? (
                <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
                  {shown.examples.map((x) => (
                    <li key={x.modelId} className="min-w-0">
                      <span className="font-semibold text-ink-dark">{x.name}</span>
                      <span className="text-muted-dark"> · {configLabel(spec(x.modelId), x.options)}</span>
                      <span className="block tabular text-ink-dark">
                        {x.before ?? "—"} cr <ArrowRight aria-label="becomes" className="inline size-3.5 align-[-2px] text-muted-dark" />{" "}
                        <span className="font-semibold">{x.after ?? "—"} cr</span>
                        <span className="text-muted-dark">
                          {" "}
                          ({money(x.beforeUsd, "—")} → {money(x.afterUsd, "—")} · KIE {money(x.kieUsd, "—")})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-xs text-muted-dark">Quotes already taken are re-checked before a job starts; accepted jobs, wallets and packages keep their terms.</p>
            </>
          )}
        </div>
      ) : null}
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : applied && !changed ? (
        <div className="mt-3">
          <Notice tone="success">
            {applied.unchanged
              ? "Nothing changed: every price already follows these settings."
              : `Saved as pricing policy v${applied.policy.version}. ${applied.result.repriced.length} model${applied.result.repriced.length === 1 ? "" : "s"} re-priced; new quotes use the new prices. Jobs already accepted keep the price they were quoted.`}
          </Notice>
        </div>
      ) : null}
    </section>
  );
}
