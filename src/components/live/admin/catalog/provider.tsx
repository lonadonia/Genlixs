"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { cn, fmtNum } from "@/lib/format";
import { Empty, Field, fmtKie, fmtPct, fmtRate, fmtUsd2, inputCls, Notice, when, Wrap } from "./shared";
import { useAdminMe } from "../live-admin";
import type { ProviderSummary } from "./types";

const AUTO_MS = 60_000;
const STALE_MS = 15 * 60_000;

/** KIE balance page (provider.read): remaining credits and consumption first, operational detail folded away. */
export function KieBalancePage() {
  const me = useAdminMe();
  const caps = me.data?.capabilities ?? [];
  return (
    <Wrap>
      <PageHead title="KIE balance" sub="Credits left on the Genlixs KIE account and how fast they are used. Read on the server; the KIE key never reaches the browser." />
      {!me.data ? (
        <div role="status" aria-busy="true" aria-label="Loading KIE balance" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : caps.includes("provider.read") ? (
        <ProviderTab canOperate={caps.includes("catalog.operate")} />
      ) : (
        <Notice>Your role cannot see the KIE balance.</Notice>
      )}
    </Wrap>
  );
}

/**
 * KIE balance, spend and operations. The balance is read on the server with the KIE key (never sent to the browser),
 * at most once per interval across all staff; a failed read shows the error and the last real value with its time.
 * Spend comes from KIE's per-task creditsConsumed; the committed figure is a labelled estimate kept separate.
 */
export function ProviderTab({ canOperate }: { canOperate: boolean }) {
  const [s, setS] = useState<ProviderSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const refresh = useCallback(async (source: "admin" | "auto") => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(source === "admin");
    try {
      setS(await api<ProviderSummary>("/api/admin/provider/balance/refresh", { body: { source } }));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
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
  }, [refresh]);

  if (!s) {
    return loadError ? (
      <Notice tone="error" title="KIE usage could not load" action={<Button size="sm" variant="secondary-light" onClick={() => void refresh("admin")}>Try again</Button>}>
        {loadError}
      </Notice>
    ) : (
      <div role="status" aria-busy="true" aria-label="Loading KIE balance" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
    );
  }

  const b = s.balance;
  const failing = b.lastErrorAt && (!b.observedAt || Date.parse(b.lastErrorAt) > Date.parse(b.observedAt));
  const stale = b.observedAt ? Date.parse(s.generatedAt) - Date.parse(b.observedAt) > STALE_MS : true;
  const status = !s.configured ? "Not configured" : failing ? "Refresh failed" : b.credits === null ? "No reading yet" : stale ? "Stale" : "Live";

  return (
    <div className="space-y-5">
      {!s.configured ? <Notice tone="attention">KIE_API_KEY is not set on this deployment, so the balance cannot be read here.</Notice> : null}
      {b.credits !== null && b.credits < 0 ? (
        <Notice tone="error" title="KIE reports a negative balance" action={<a href={s.billingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Top up on KIE</a>}>
          The KIE account is {fmtKie(Math.abs(b.credits))} below zero. New generations will fail until it is topped up; keep models off until then.
        </Notice>
      ) : b.low ? (
        <Notice tone="error" title="KIE balance is below your warning level" action={<a href={s.billingUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Top up on KIE</a>}>
          {fmtKie(b.credits)} left; warning at {fmtKie(b.threshold)}. New generations fail when KIE runs out of credits.
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-muted-dark">KIE balance</p>
            <Badge surface="light" tone={status === "Live" ? "success" : status === "Stale" ? "attention" : status === "Refresh failed" ? "error" : "neutral"}>
              {status}
            </Badge>
          </div>
          <p className="mt-2 text-[1.875rem] leading-none font-semibold tracking-tight text-ink-dark tabular">{b.credits === null ? "Unknown" : fmtKie(b.credits)}</p>
          <p className="mt-2 text-xs text-muted-dark">
            {b.approxUsd !== null
              ? `≈ ${fmtUsd2(b.approxUsd)} at your KIE credit cost (${fmtRate(b.usdPerCredit)} per KIE credit, set in Pricing & packages)`
              : "No USD estimate without a reading"}
          </p>
          <p className="mt-2 text-xs text-muted-dark">Read {when(b.observedAt)}</p>
          {failing ? (
            <p className="mt-1 text-xs font-semibold text-error-text">
              Last refresh failed ({b.lastError}) {when(b.lastErrorAt)}.{" "}
              {b.credits === null ? "No successful reading yet, so nothing is shown instead of a guess." : "The value above is the last real reading."}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} busy={busy} onClick={() => void refresh("admin")}>
              Refresh now
            </Button>
            <a href={s.billingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-info-text underline">
              KIE billing <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </div>
          <p className="mt-2 text-[11px] text-muted-dark">Refreshes every minute while this page is open; repeated clicks share one KIE request.</p>
        </div>
        <div className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
          <p className="text-sm font-semibold text-muted-dark">KIE credits used</p>
          <dl className="mt-3 grid grid-cols-3 gap-3">
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
        </div>
      </div>
      <details className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5">
        <summary className="cursor-pointer text-sm font-semibold text-ink-dark">More details: jobs, spend by model, reliability, readings and warning level</summary>
        <div className="mt-4 space-y-5">
      <p className="text-xs text-muted-dark">
        Balance changes on a shared account are not used to measure single tasks.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
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
        </Panel>
        <Panel title="Committed to in-flight work (estimate)">
          <p className="text-[1.5rem] font-semibold tabular text-ink-dark">{fmtKie(s.committed.estimatedCredits)}</p>
          <p className="mt-1 text-sm text-muted-dark">
            {s.committed.jobs} job(s) queued or running{s.committed.unknownCostJobs ? `, ${s.committed.unknownCostJobs} without a known cost` : ""}.
          </p>
          <p className="mt-2 text-xs text-muted-dark">{s.committed.note}</p>
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
                  <th scope="col" className="px-4 py-2.5 font-semibold">Model</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Customer jobs</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Private tests</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Tasks</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Without KIE report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {s.spend.byModel30d.map((r) => (
                  <tr key={r.modelId}>
                    <th scope="row" className="px-4 py-2.5 font-medium">{r.name ?? r.modelId}</th>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKie(r.customerCredits)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKie(r.testCredits)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtNum(r.jobs)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtNum(r.unmeasuredJobs)}</td>
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
                  <th scope="col" className="px-4 py-2.5 font-semibold">Model</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Succeeded / failed</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Success rate</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Median time</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">95th percentile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {s.processing7d.map((r) => (
                  <tr key={r.modelId}>
                    <th scope="row" className="px-4 py-2.5 font-medium">{r.name ?? r.modelId}</th>
                    <td className="px-3 py-2.5 text-right tabular">
                      {r.succeeded} / {r.failed}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtPct(r.successRate)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{secs(r.p50Seconds)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{secs(r.p95Seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {canOperate ? <ThresholdForm current={b.threshold} onSaved={() => void refresh("auto")} /> : null}
        <Panel title="Recent balance readings">
          {s.history.length === 0 ? (
            <Empty>No readings yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.history.slice(0, 10).map((h, i) => (
                <li key={i} className={cn(!h.ok && "text-error-text")}>
                  {when(h.at)} · {h.ok ? fmtKie(h.credits) : `failed (${h.error})`} · {h.source}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
        </div>
      </details>
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
    <Panel title="Low-balance warning">
      <Field label="Warn below (KIE credits)" hint="Leave empty to turn the warning off.">
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
