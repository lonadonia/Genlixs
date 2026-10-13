import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PageHead } from "@/components/console/parts";
import { COMMISSION_STATUS } from "@/components/partner/status";
import { COMMISSIONS } from "@/lib/admin-data";
import { fmtUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Commissions" };

export default function CommissionsPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Commissions"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Each commission comes from one confirmed payment. Rates follow the agreement version in force when the payment was made.
            <Badge surface="light" tone="attention" icon="none">
              Sample data · rates not shown
            </Badge>
          </span>
        }
      />

      <div className="hidden overflow-hidden rounded-[var(--radius-media)] border border-rule bg-sheet md:block">
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Commissions table" tabIndex={0}>
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Commissions with source payment, base, rate, agreement, status and eligibility date</caption>
            <thead>
              <tr className="border-b border-rule text-left text-muted-dark">
                <th scope="col" className="px-5 py-3 font-semibold">Commission</th>
                <th scope="col" className="px-3 py-3 font-semibold">Referral</th>
                <th scope="col" className="px-3 py-3 font-semibold">Source payment</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Base (USD)</th>
                <th scope="col" className="px-3 py-3 font-semibold">Rate</th>
                <th scope="col" className="px-3 py-3 font-semibold">Agreement</th>
                <th scope="col" className="px-3 py-3 font-semibold">Eligible on</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {COMMISSIONS.map((c) => (
                <tr key={c.id} className="border-b border-rule align-top last:border-0">
                  <td className="px-5 py-3 font-mono text-xs text-ink-dark">{c.id}</td>
                  <td className="px-3 py-3 font-mono text-xs">{c.referral}</td>
                  <td className="px-3 py-3 font-mono text-xs">{c.sourcePayment}</td>
                  <td className="px-3 py-3 text-right tabular">{fmtUsd(c.base)}</td>
                  <td className="px-3 py-3 text-muted-dark">{c.rate}</td>
                  <td className="px-3 py-3">{c.agreement}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{c.eligibleOn}</td>
                  <td className="px-5 py-3">
                    <Badge surface="light" tone={COMMISSION_STATUS[c.status].tone}>
                      {COMMISSION_STATUS[c.status].label}
                    </Badge>
                    {c.note ? <p className="mt-1 max-w-xs text-xs text-muted-dark">{c.note}</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="space-y-3 md:hidden">
        {COMMISSIONS.map((c) => (
          <li key={c.id} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-ink-dark">{c.id}</span>
              <Badge surface="light" tone={COMMISSION_STATUS[c.status].tone}>
                {COMMISSION_STATUS[c.status].label}
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-muted-dark">Referral</dt>
                <dd className="font-mono text-ink-dark">{c.referral}</dd>
              </div>
              <div>
                <dt className="text-muted-dark">Base</dt>
                <dd className="text-ink-dark">{fmtUsd(c.base)} USD</dd>
              </div>
              <div>
                <dt className="text-muted-dark">Source</dt>
                <dd className="font-mono text-ink-dark">{c.sourcePayment}</dd>
              </div>
              <div>
                <dt className="text-muted-dark">Eligible on</dt>
                <dd className="text-ink-dark">{c.eligibleOn}</dd>
              </div>
            </dl>
            {c.note ? <p className="mt-2 text-xs text-warning">{c.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
