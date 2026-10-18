"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Panel } from "@/components/console/parts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { fmtNum } from "@/lib/format";
import { Empty, Field, inputCls, Notice, when } from "../catalog/shared";
import { KV, native, settingsText, usd, money } from "./parts";
import type { JobRoute, ProviderAccount, Usage, UsageRow } from "./types";

const STATE: Record<string, { label: string; tone: Tone }> = {
  reserved: { label: "Sending", tone: "info" },
  submission_unknown: { label: "Submission being verified", tone: "attention" },
  not_charged: { label: "Not charged (refused)", tone: "neutral" },
  pending_confirmation: { label: "Estimated, awaiting confirmation", tone: "info" },
  confirmed: { label: "Confirmed", tone: "success" },
  failed: { label: "Failed (no charge reported)", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
  unknown_historical: { label: "Historical, cost unknown", tone: "neutral" },
};

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

/** Usage: Genlixs supplier spending by job and attempt. Confirmed, estimated, pending and unknown amounts stay apart. */
export function UsageTab({ accounts }: { accounts: ProviderAccount[] }) {
  const [f, setF] = useState({ from: monthStart(), to: "", provider: "", model: "", state: "", purpose: "" });
  const [applied, setApplied] = useState(f);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.from) p.set("from", new Date(`${applied.from}T00:00:00Z`).toISOString());
    if (applied.to) p.set("to", new Date(`${applied.to}T23:59:59Z`).toISOString());
    for (const k of ["provider", "model", "state", "purpose"] as const) if (applied[k]) p.set(k, applied[k]);
    return p.toString();
  }, [applied]);
  const u = useApi<Usage>(`/api/admin/providers/usage?${qs}&limit=300`, [qs]);
  const [job, setJob] = useState<UsageRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setMsg(null);
    try {
      const r = await api<{ filename: string; csv: string; rows: number }>(`/api/admin/providers/usage/export?${qs}`);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      if (r.rows >= 2000) setMsg("The export holds the latest 2,000 entries; narrow the dates for a complete file.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const t = u.data?.totals;
  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <Field label="From (UTC)">
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={inputCls} />
        </Field>
        <Field label="To (UTC)">
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Provider">
          <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} className={inputCls}>
            <option value="">All</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.provider}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model id">
          <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value.trim() })} className={inputCls} placeholder="any" />
        </Field>
        <Field label="Status">
          <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} className={inputCls}>
            <option value="">All</option>
            {Object.entries(STATE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jobs">
          <select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} className={inputCls}>
            <option value="">All</option>
            <option value="customer">Customers</option>
            <option value="staff_test">Private tests</option>
          </select>
        </Field>
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <Button size="sm" type="submit">
            Apply filters
          </Button>
          <Button size="sm" type="button" variant="secondary-light" busy={exporting} icon={<Download aria-hidden className="size-4" />} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </div>
      </form>
      {msg ? <Notice tone="attention">{msg}</Notice> : null}

      {u.error && !u.data ? (
        <Notice tone="error">{u.error.message}</Notice>
      ) : !u.data || !t ? (
        <div role="status" aria-busy="true" aria-label="Loading usage" className="h-40 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Sum label="Confirmed" value={money(t.confirmedUsd)} sub={`Estimated beforehand: ${money(t.estimateOfConfirmedUsd)}`} />
            <Sum label="Estimated, awaiting confirmation" value={money(t.estimatedAwaitingUsd)} sub="Provider has not reported the charge yet" />
            <Sum label="Pending" value={money(t.pendingUsd)} sub="Sent or being verified" />
            <Sum
              label="Without a known cost"
              value={fmtNum(t.unknownCost + t.historicalUnknown)}
              sub={`${fmtNum(t.historicalUnknown)} recorded before cost tracking · ${fmtNum(t.notChargedOrFailed)} refused or failed`}
            />
          </div>
          <p className="text-xs text-muted-dark">
            {when(u.data.from)} – {when(u.data.to)} ({u.data.timezone}). USD at each account&apos;s funding terms; unknown amounts are counted, never guessed.
          </p>

          {u.data.accountReported.length ? (
            <Panel title="Reported by the providers (account level)">
              <p className="mb-2 text-xs text-muted-dark">Totals from the providers&apos; usage endpoints. They can include other applications on the same account and are never assigned to Genlixs customers.</p>
              <ul className="space-y-1 text-sm">
                {u.data.accountReported.map((r) => (
                  <li key={`${r.provider}-${r.fetchedAt}`}>
                    <span className="font-semibold">{r.provider}</span> · {r.amountUsd !== null ? money(r.amountUsd) : native(r.nativeAmount, r.unit)} · {when(r.from)} – {when(r.to)} ({r.timezone}) · read {when(r.fetchedAt)}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {t.byProvider.length ? (
            <Panel title="By provider" bodyClass="p-0">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-semibold">Provider</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Entries</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Confirmed</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Estimated</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {t.byProvider.map((p) => (
                    <tr key={p.provider}>
                      <th scope="row" className="px-4 py-2 font-medium">{p.name}</th>
                      <td className="px-3 py-2 text-right tabular">{fmtNum(p.entries)}</td>
                      <td className="px-3 py-2 text-right tabular">{money(p.confirmedUsd)}</td>
                      <td className="px-3 py-2 text-right tabular">{money(p.estimatedAwaitingUsd)}</td>
                      <td className="px-3 py-2 text-right tabular">{money(p.pendingUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Panel>
          ) : null}

          <Panel title="Jobs and attempts" bodyClass="p-0">
            {u.data.rows.length === 0 ? (
              <div className="p-5">
                <Empty>No supplier spending recorded for these filters.</Empty>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-paper text-xs text-muted-dark">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">When</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Job</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Provider · model</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Customer</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Estimated</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Charged</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {u.data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2 align-top text-xs">{when(r.at)}</td>
                        <td className="px-3 py-2 align-top">
                          <button type="button" className="font-semibold text-info-text hover:underline" onClick={() => setJob(r)}>
                            {r.jobRef}
                          </button>
                          <span className="block text-xs text-muted-dark">
                            attempt {r.attempt} · {r.purpose === "staff_test" ? "test" : "customer"}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          {r.providerName} · {r.modelName}
                          <span className="block text-xs text-muted-dark">{settingsText(r.options)}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-xs">{r.userEmail ?? r.userId.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right align-top tabular">
                          {usd(r.estimatedUsd)}
                          <span className="block text-xs text-muted-dark">{native(r.estimatedNative, r.unit)}</span>
                        </td>
                        <td className="px-3 py-2 text-right align-top tabular">
                          {r.confirmedUsd === null ? "—" : usd(r.confirmedUsd)}
                          {r.confirmedNative !== null ? <span className="block text-xs text-muted-dark">{native(r.confirmedNative, r.unit)}</span> : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge surface="light" tone={STATE[r.state]?.tone ?? "neutral"}>
                            {STATE[r.state]?.label ?? r.state}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      {job ? <JobRouteDialog row={job} onClose={() => setJob(null)} /> : null}
    </div>
  );
}

function Sum({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[var(--radius-media)] border border-rule bg-sheet p-4">
      <p className="text-xs font-semibold text-muted-dark">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular text-ink-dark">{value}</p>
      <p className="mt-1 text-[11px] text-muted-dark">{sub}</p>
    </div>
  );
}

/** Every attempt of one job: the route it took, the candidates compared, the estimate and the confirmed charge. */
function JobRouteDialog({ row, onClose }: { row: UsageRow; onClose: () => void }) {
  const d = useApi<JobRoute>(`/api/admin/providers/jobs/${row.jobId}/route`);
  return (
    <Dialog open surface="light" size="lg" onClose={onClose} title={`Job ${row.jobRef}`} description={`${row.modelName} · ${settingsText(row.options)}`}>
      {!d.data ? (
        d.error ? <Notice tone="error">{d.error.message}</Notice> : <div role="status" aria-busy="true" aria-label="Loading" className="h-32 animate-pulse-soft rounded-xl bg-paper" />
      ) : (
        <ol className="space-y-4">
          {d.data.attempts.map((a) => {
            const r = (a.route ?? {}) as { explanation?: string; candidates?: { provider: string; effectiveUsd: number | null; excluded: string | null }[]; funding?: { feeBps?: number; bonusBps?: number }; price?: { version?: number; confidence?: string } };
            return (
              <li key={a.attemptId} className="rounded-xl border border-rule p-4">
                <p className="font-semibold">
                  Attempt {a.ordinal} · {a.provider} · {a.state}
                  {a.errorCode ? ` (${a.errorCode})` : ""}
                </p>
                <dl className="mt-2">
                  <KV k="Sent">{when(a.submittedAt)}</KV>
                  <KV k="Why this supplier">{r.explanation ?? "Recorded before routing (original KIE route)"}</KV>
                  {r.candidates?.length ? (
                    <KV k="Compared">
                      {r.candidates.map((c) => `${c.provider}: ${c.excluded ?? usd(c.effectiveUsd)}`).join(" · ")}
                    </KV>
                  ) : null}
                  <KV k="Key version">{a.credentialVersion ? `v${a.credentialVersion}` : "Server setting"}</KV>
                  <KV k="Price used">{r.price ? `v${r.price.version} (${r.price.confidence})` : "—"}</KV>
                  <KV k="Funding terms">{r.funding ? `fee ${Number(r.funding.feeBps ?? 0) / 100} % · bonus ${Number(r.funding.bonusBps ?? 0) / 100} %` : "—"}</KV>
                  {a.ledger ? (
                    <KV k="Cost">
                      Estimated {usd(a.ledger.estimatedUsd)} ({native(a.ledger.estimatedNative, a.ledger.unit)}) · charged {a.ledger.confirmedUsd === null ? "not reported" : `${usd(a.ledger.confirmedUsd)} (${native(a.ledger.confirmedNative, a.ledger.unit)})`} · {STATE[a.ledger.state]?.label ?? a.ledger.state}
                      {a.ledger.note ? ` — ${a.ledger.note}` : ""}
                    </KV>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}
