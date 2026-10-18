"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { cn, fmtNum } from "@/lib/format";
import { Empty, Field, fmtKie, fmtPct, inputCls, Notice, when } from "./shared";
import type { ProviderSummary } from "./types";

const AUTO_MS = 60_000;

/**
 * KIE summary (provider.read): balance, spend and job counts. The balance is read on the server with the KIE key (never
 * sent to the browser), at most once per interval across all staff; a failed read keeps the last real value. While the
 * page is visible it refreshes every minute; repeated requests share one KIE read.
 */
export function useKieSummary(enabled: boolean) {
  const [s, setS] = useState<ProviderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const refresh = useCallback(async (source: "admin" | "auto") => {
    if (inflight.current) return null;
    inflight.current = true;
    setBusy(source === "admin");
    try {
      const r = await api<ProviderSummary>("/api/admin/provider/balance/refresh", { body: { source } });
      setS(r);
      setError(null);
      return r;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") timer = window.setInterval(() => void refresh("auto"), AUTO_MS);
    };
    const onVis = () => {
      schedule();
      if (document.visibilityState === "visible") void refresh("auto");
    };
    const first = window.setTimeout(() => void refresh("auto"), 0);
    schedule();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, refresh]);

  return { s, error, busy, refresh };
}

/**
 * KIE activity: credits used, jobs now, work committed, spend by model, reliability, readings and the low-balance
 * warning. Spend comes from KIE's per-task report; tasks without a report are counted, never guessed.
 */
export function KieActivity({ s, canOperate, onSaved }: { s: ProviderSummary; canOperate: boolean; onSaved: () => void }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="KIE credits used">
          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ["Today (UTC)", s.spend.today],
                ["7 days", s.spend.days7],
                ["30 days", s.spend.days30],
              ] as const
            ).map(([label, bucket]) => (
              <div key={label}>
                <dt className="text-xs text-muted-dark">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular text-ink-dark">{fmtKie(bucket.customerCredits + bucket.testCredits)}</dd>
                <dd className="text-[11px] text-muted-dark">{spendSub(bucket)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-dark">As reported by KIE for each finished task. Tasks without a report are counted, never guessed.</p>
        </Panel>
        <Panel title="Jobs now">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Waiting" value={s.jobs.queued} />
            <Stat label="Sending / confirming" value={s.jobs.submitting} />
            <Stat label="Generating / saving" value={s.jobs.running} />
            <Stat label="Delayed" value={s.jobs.delayed} />
            <Stat label="Needs review" value={s.jobs.review} warn={s.jobs.review > 0} />
            <Stat label="Failed (24 h)" value={s.jobs.failed24h} warn={s.jobs.failed24h > 0} />
            <Stat label="Succeeded (24 h)" value={s.jobs.succeeded24h} />
            <Stat label="Success rate (7 d)" value={s.jobs.succeeded7d + s.jobs.failed7d ? fmtPct(s.jobs.succeeded7d / (s.jobs.succeeded7d + s.jobs.failed7d)) : "—"} />
            <Stat label="Private tests (7 d)" value={s.jobs.tests7d} />
          </dl>
          <p className="mt-3 border-t border-rule pt-3 text-xs text-muted-dark">
            Committed to work in flight: <span className="font-semibold text-ink-dark tabular">{fmtKie(s.committed.estimatedCredits)}</span> for{" "}
            {s.committed.jobs} job(s){s.committed.unknownCostJobs ? `, ${s.committed.unknownCostJobs} without a known cost` : ""}.
          </p>
        </Panel>
      </div>

      <Panel title="KIE spend by model (30 days)" bodyClass="p-0">
        {s.spend.byModel30d.length === 0 ? (
          <div className="p-5">
            <Empty>No finished KIE tasks in the last 30 days.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper text-xs text-muted-dark">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Model</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Customer jobs</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Private tests</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Tasks</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Without KIE report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {s.spend.byModel30d.map((r) => (
                  <tr key={r.modelId}>
                    <th scope="row" className="px-5 py-2.5 font-medium">{r.name ?? r.modelId}</th>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKie(r.customerCredits)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKie(r.testCredits)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtNum(r.jobs)}</td>
                    <td className="px-5 py-2.5 text-right tabular">{fmtNum(r.unmeasuredJobs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Reliability and processing time (7 days)" bodyClass="p-0">
        {s.processing7d.length === 0 ? (
          <div className="p-5">
            <Empty>No finished jobs in the last 7 days.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-paper text-xs text-muted-dark">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Model</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Succeeded / failed</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Success rate</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Median time</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">95th percentile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {s.processing7d.map((r) => (
                  <tr key={r.modelId}>
                    <th scope="row" className="px-5 py-2.5 font-medium">{r.name ?? r.modelId}</th>
                    <td className="px-3 py-2.5 text-right tabular">
                      {r.succeeded} / {r.failed}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtPct(r.successRate)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{secs(r.p50Seconds)}</td>
                    <td className="px-5 py-2.5 text-right tabular">{secs(r.p95Seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {canOperate ? <ThresholdForm current={s.balance.threshold} onSaved={onSaved} /> : null}
        <Panel title="Recent KIE balance readings">
          {s.history.length === 0 ? (
            <Empty>No readings yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.history.slice(0, 10).map((h, i) => (
                <li key={i} className={cn("tabular", !h.ok && "text-error-text")}>
                  {when(h.at)} · {h.ok ? fmtKie(h.credits) : `failed (${h.error})`} · {h.source}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-dark">Balance changes on a shared account are not used to measure single tasks.</p>
        </Panel>
      </div>
    </div>
  );
}

const spendSub = (b: ProviderSummary["spend"]["today"]) =>
  `${fmtKie(b.customerCredits)} customers · ${fmtKie(b.testCredits)} tests${b.unmeasuredJobs ? ` · ${b.unmeasuredJobs} without report` : ""}`;
const secs = (n: number | null) => (n === null ? "—" : n < 90 ? `${Math.round(n)} s` : `${(n / 60).toFixed(1)} min`);

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-muted-dark">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular", warn ? "text-orange-text" : "text-ink-dark")}>{typeof value === "number" ? fmtNum(value) : value}</dd>
    </div>
  );
}

function ThresholdForm({ current, onSaved }: { current: number | null; onSaved: () => void }) {
  const [v, setV] = useState(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  return (
    <Panel title="Low-balance warning (KIE)">
      <Field label="Warn below (KIE credits)" hint="Leave empty to turn the warning off. The warning shows on this page and in the pipeline checks.">
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className={cn(inputCls, "w-48")} />
      </Field>
      <Button
        size="sm"
        className="mt-3"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/admin/provider/low-balance", { body: { credits: v.trim() === "" ? null : Number(v) } });
            setMsg({ tone: "success", text: "Saved." });
            onSaved();
          } catch (e) {
            setMsg({ tone: "error", text: errorMessage(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save warning level
      </Button>
      {msg ? <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
    </Panel>
  );
}
