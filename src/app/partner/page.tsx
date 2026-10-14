import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LivePartnerOverview } from "@/components/live/partner/live-partner";
import Link from "next/link";
import { CircleCheck, CircleDashed, ExternalLink, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { PageHead, Panel } from "@/components/console/parts";
import { ColumnChart } from "@/components/partner/column-chart";
import { CAMPAIGNS, COMMISSIONS, PARTNER, PARTNER_BALANCES, PARTNER_COUNTS, PARTNER_WEEKS, PAYOUT_RULES } from "@/lib/admin-data";
import { cn, fmtUsd } from "@/lib/format";
import { COMMISSION_STATUS } from "@/components/partner/status";

export const metadata: Metadata = { title: "Overview" };

export default function PartnerOverview() {
  if (LIVE) return <LivePartnerOverview />;
  const available = PARTNER_BALANCES.find((b) => b.key === "available")!.value;
  const readiness = [
    { ok: true, label: "Agreement accepted", detail: PARTNER.agreement },
    { ok: true, label: "Payout method verified", detail: "Bank transfer ••21 · verified 3 Sep 2026" },
    { ok: available >= PAYOUT_RULES.threshold, label: `Available balance at least ${fmtUsd(PAYOUT_RULES.threshold)}`, detail: `${fmtUsd(available)} available now · ${fmtUsd(PAYOUT_RULES.threshold - available)} to go` },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Partner overview"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            {PARTNER.agreement}
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />

      {/* 1–2. Main link first: the easiest element to find (guide §10). */}
      <section aria-labelledby="link-h" className="rounded-[var(--radius-media)] border border-[#c7cefd] bg-info-tint p-5 sm:p-6">
        <h2 id="link-h" className="text-sm font-semibold text-info-text">
          Your main link
        </h2>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center">
          <p className="min-w-0 flex-1 font-mono text-base font-semibold break-all text-ink-dark sm:truncate sm:text-xl sm:break-normal">{PARTNER.link}</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={PARTNER.link} label="Copy link" variant="primary" />
            <ButtonLink href="/" variant="secondary-light" target="_blank" icon={<ExternalLink aria-hidden className="size-4" />}>
              Preview
            </ButtonLink>
            <ButtonLink href="/partner/links" variant="secondary-light" icon={<Plus aria-hidden className="size-4" />}>
              Create campaign
            </ButtonLink>
          </div>
        </div>
        <p className="mt-2 text-xs text-info-text">Preview links use the reserved example domain and do not track visits.</p>
        <p className="mt-3 border-t border-[#c7cefd] pt-3 text-sm text-ink-dark xl:hidden">
          Next payout: {readiness.every((r) => r.ok) ? "ready to request." : `${readiness.find((r) => !r.ok)?.detail}.`}{" "}
          <Link href="/partner/payouts" className="font-semibold text-info-text underline">
            View payouts
          </Link>
        </p>
      </section>

      {/* 3. Performance counts — separate from money */}
      <section aria-labelledby="perf-h">
        <h2 id="perf-h" className="mb-3 text-base font-semibold text-ink-dark">
          Referral performance · last 8 weeks
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            { k: "Eligible clicks", v: PARTNER_COUNTS.clicks, d: "Unique visits from your links, after bot filtering." },
            { k: "Registrations", v: PARTNER_COUNTS.registrations, d: "Accounts created within the attribution window." },
            { k: "Paying referrals", v: PARTNER_COUNTS.paying, d: "Referred accounts with at least one confirmed payment." },
          ].map((c) => (
            <div key={c.k} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
              <dt className="text-sm font-semibold text-muted-dark">{c.k}</dt>
              <dd className="mt-2 text-[1.875rem] leading-none font-semibold text-ink-dark">{c.v.toLocaleString("en-US")}</dd>
              <dd className="mt-2 text-xs text-muted-dark">{c.d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 4. Money — four distinct balances, never summed into one badge */}
      <section aria-labelledby="bal-h">
        <h2 id="bal-h" className="mb-3 text-base font-semibold text-ink-dark">
          Commission balances (USD)
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PARTNER_BALANCES.map((b) => (
            <div key={b.key} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
              <dt className="flex items-center gap-2 text-sm font-semibold text-muted-dark">
                {/* Key markers on white: olive success for Available (lime would be 1.1:1), blue for Reserved, neutrals for Paid / Pending. */}
                <span aria-hidden className={cn("h-3 w-1 rounded-full", b.key === "available" ? "bg-success-text" : b.key === "reserved" ? "bg-brand-blue" : b.key === "paid" ? "bg-rule-strong" : "bg-[#cfd4cd]")} />
                {b.label}
              </dt>
              <dd className="mt-2 text-[1.875rem] leading-none font-semibold text-ink-dark">{fmtUsd(b.value)}</dd>
              <dd className="mt-2 text-xs text-muted-dark">{b.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* 5. Period chart + top campaigns */}
        <Panel title="Registrations per week" id="chart-h" className="xl:col-span-3">
          <ColumnChart data={PARTNER_WEEKS.map((w) => ({ x: w.week, y: w.registrations }))} label="Registrations from your links per week, last 8 weeks" unit="Registrations" />
        </Panel>
        <Panel title="Top campaigns" id="camp-h" className="xl:col-span-2" bodyClass="p-0" action={<Link href="/partner/links" className="text-sm font-semibold text-info-text hover:underline">All links</Link>}>
          <ul className="divide-y divide-rule">
            {CAMPAIGNS.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-dark">{c.name}</p>
                  <p className="text-xs text-muted-dark">{c.platform}</p>
                </div>
                <p className="text-right text-xs text-muted-dark tabular">
                  <span className="block text-sm font-semibold text-ink-dark">{c.regs} registrations</span>
                  {c.clicks} clicks · {c.paying} paying
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* 6. Recent commissions + next payout readiness */}
        <Panel title="Recent commissions" id="rc-h" className="xl:col-span-3" bodyClass="p-0" action={<Link href="/partner/commissions" className="text-sm font-semibold text-info-text hover:underline">All commissions</Link>}>
          <ul className="divide-y divide-rule">
            {COMMISSIONS.slice(0, 4).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-dark">
                    {c.referral} · base {fmtUsd(c.base)}
                  </p>
                  <p className="text-xs text-muted-dark">
                    {c.id} · source {c.sourcePayment} · eligible {c.eligibleOn}
                  </p>
                  {c.note ? <p className="mt-1 text-xs text-warning">{c.note}</p> : null}
                </div>
                <Badge surface="light" tone={COMMISSION_STATUS[c.status].tone}>
                  {COMMISSION_STATUS[c.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Next payout" id="np-h" className="xl:col-span-2">
          <ul className="space-y-3">
            {readiness.map((r) => (
              <li key={r.label} className="flex items-start gap-3">
                {r.ok ? <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-text" /> : <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />}
                <div>
                  <p className="text-sm font-semibold text-ink-dark">
                    {r.label}
                    <span className="sr-only">{r.ok ? " — met" : " — not met yet"}</span>
                  </p>
                  <p className="text-xs text-muted-dark">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <ButtonLink href="/partner/payouts" variant="secondary-light" className="mt-5 w-full">
            View payouts
          </ButtonLink>
        </Panel>
      </div>
    </div>
  );
}
