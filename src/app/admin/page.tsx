import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHead, Panel, StatTile } from "@/components/console/parts";
import { ADMIN_JOBS, AUDIT, MODEL_PERFORMANCE, OVERVIEW_METRICS, SERVICE_HEALTH, STATUS_META } from "@/lib/admin-data";
import { fmtDateTime } from "@/lib/format";
import { TOOLS } from "@/lib/catalog";

export const metadata: Metadata = { title: "Operations overview" };

export default function AdminOverview() {
  const queue = [
    { label: "Delayed jobs", detail: "2 video jobs past the p95 duration", href: "/admin/jobs?status=delayed", tone: "warning" as const, count: ADMIN_JOBS.filter((j) => j.status === "delayed").length },
    { label: "Unconfirmed submission", detail: "Provider did not acknowledge; reconcile before any resubmission", href: "/admin/jobs?status=unconfirmed", tone: "warning" as const, count: ADMIN_JOBS.filter((j) => j.status === "unconfirmed").length },
    { label: "Payout batch to review", detail: "PB-0913 · 3 payees · 1 unverified method", href: "/admin/payouts", tone: "info" as const, count: 1 },
    { label: "Uncertain transfer", detail: "PO-0418 stays reserved until the bank confirms", href: "/admin/payouts#transfers", tone: "error" as const, count: 1 },
  ];
  const recent = ADMIN_JOBS.slice(0, 6);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Operations overview"
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Period: last 7 days (6–13 Oct 2026, UTC)</span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-3.5" /> Last updated 13 Oct 2026, 09:00 UTC
            </span>
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />

      <section aria-label="Service health" className="flex flex-wrap gap-2 rounded-[var(--radius-media)] border border-rule bg-sheet px-4 py-3">
        <span className="mr-1 self-center text-sm font-semibold text-ink-dark">Service health</span>
        {SERVICE_HEALTH.map((s) => (
          <Badge key={s.name} surface="light" tone={s.tone}>
            {s.name}: {s.state}
          </Badge>
        ))}
      </section>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {OVERVIEW_METRICS.map((m) => (
          <StatTile key={m.key} label={m.label} value={m.value} sub={m.delta} def={m.def} href={m.href} />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel title="Model performance" id="perf-h" className="xl:col-span-3" bodyClass="p-0" action={<span className="text-xs text-muted-dark">Success = ready ÷ settled</span>}>
          <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Model performance table" tabIndex={0}>
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Success rate and median duration per model, last 7 days</caption>
              <thead>
                <tr className="border-b border-rule text-left text-muted-dark">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Model</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Jobs</th>
                  <th scope="col" className="w-[38%] px-3 py-2.5 font-semibold">Success rate</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Median time</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_PERFORMANCE.map((m) => (
                  <tr key={m.model} className="border-b border-rule last:border-0">
                    <th scope="row" className="px-5 py-3 text-left font-semibold text-ink-dark">
                      {m.model}
                      <span className="block text-xs font-normal text-muted-dark">{m.tool}</span>
                    </th>
                    <td className="px-3 py-3 text-right tabular">{m.jobs.toLocaleString("en-US")}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div aria-hidden className="h-2 flex-1 rounded-full bg-info-tint">
                          <div className="h-2 rounded-r-[4px] rounded-l-full bg-brand-blue" style={{ width: `${m.success}%` }} />
                        </div>
                        <span className="w-12 text-right font-semibold text-ink-dark tabular">{m.success.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right tabular">{m.medianS < 60 ? `${m.medianS}s` : `${Math.floor(m.medianS / 60)}m ${m.medianS % 60}s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Action queue" id="queue-h" className="xl:col-span-2" bodyClass="p-2">
          <ul>
            {queue.map((q) => (
              <li key={q.label}>
                <Link href={q.href} className="flex items-start gap-3 rounded-[12px] p-3 hover:bg-paper">
                  <Badge surface="light" tone={q.tone} icon="none" className="mt-0.5 min-w-8 justify-center tabular">
                    {q.count}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-dark">{q.label}</span>
                    <span className="block text-xs text-muted-dark">{q.detail}</span>
                  </span>
                  <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-dark" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel
          title="Recent jobs"
          id="recent-h"
          className="xl:col-span-3"
          bodyClass="p-0"
          action={
            <Link href="/admin/jobs" className="text-sm font-semibold text-info-text hover:underline">
              All jobs
            </Link>
          }
        >
          <ul className="divide-y divide-rule">
            {recent.map((j) => (
              <li key={j.id}>
                <Link href={`/admin/jobs/${j.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-paper">
                  <span className="w-20 font-mono text-xs text-ink-dark">{j.id}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-dark">
                    {TOOLS[j.tool].label} · {j.model}
                  </span>
                  <span className="text-muted-dark tabular">{j.credits} cr</span>
                  <Badge surface="light" tone={STATUS_META[j.status].tone}>
                    {STATUS_META[j.status].label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Financial and audit activity" id="audit-h" className="xl:col-span-2" bodyClass="p-0">
          <ol className="divide-y divide-rule">
            {AUDIT.map((a) => (
              <li key={a.ref} className="px-5 py-3 text-sm">
                <p className="text-ink-dark">{a.action}</p>
                <p className="mt-0.5 text-xs text-muted-dark">
                  {fmtDateTime(a.at)} · {a.actor} · <span className="font-mono">{a.ref}</span>
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
