import type { Metadata } from "next";
import { CircleCheck, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHead, Panel } from "@/components/console/parts";
import { PARTNER_BALANCES, PAYOUTS, PAYOUT_RULES } from "@/lib/admin-data";
import { fmtUsd } from "@/lib/format";

export const metadata: Metadata = { title: "Payouts" };

export default function PartnerPayoutsPage() {
  const available = PARTNER_BALANCES.find((b) => b.key === "available")!.value;
  const reserved = PARTNER_BALANCES.find((b) => b.key === "reserved")!.value;
  const short = PAYOUT_RULES.threshold - available;
  const ready = short <= 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Payouts"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Request a payout once every condition is met. Transfers that are not confirmed stay reserved.
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Request a payout" id="req-h" className="lg:col-span-3">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-dark">Available</dt>
              <dd className="text-[1.875rem] leading-tight font-semibold text-ink-dark">{fmtUsd(available)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-dark">Minimum payout</dt>
              <dd className="text-[1.875rem] leading-tight font-semibold text-ink-dark">{fmtUsd(PAYOUT_RULES.threshold)}</dd>
            </div>
          </dl>
          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex items-center gap-2 text-ink-dark">
              <CircleCheck aria-hidden className="size-4 text-success-text" /> Payout method verified (Bank transfer ••21)
            </li>
            <li className="flex items-center gap-2 text-ink-dark">
              <CircleCheck aria-hidden className="size-4 text-success-text" /> Agreement v1.2 accepted
            </li>
            <li className="flex items-center gap-2 text-ink-dark">
              {ready ? <CircleCheck aria-hidden className="size-4 text-success-text" /> : <CircleDashed aria-hidden className="size-4 text-warning" />}
              Available balance reaches the minimum
              <span className="sr-only">{ready ? " — met" : " — not met"}</span>
            </li>
          </ul>
          <div className="mt-5">
            <Button disabled={!ready} aria-describedby="payout-why">
              Request payout of {fmtUsd(available)}
            </Button>
            <p id="payout-why" className="mt-2 text-sm text-muted-dark">
              {ready
                ? "Requests are reviewed by Genlixs finance before transfer."
                : `Unavailable: you need ${fmtUsd(short)} more in available commission. Pending commission becomes available after its eligibility date.`}
            </p>
          </div>
        </Panel>
        <Panel title="Reserved" id="res-h" className="lg:col-span-2">
          <p className="text-[1.875rem] leading-tight font-semibold text-ink-dark">{fmtUsd(reserved)}</p>
          <p className="mt-2 text-sm text-muted-dark">
            Held for payout PO-0418. The transfer was sent but the bank has not confirmed it. We keep the amount reserved — not paid, not available — until the
            bank reference arrives or the transfer is returned.
          </p>
        </Panel>
      </div>

      <Panel title="Payout history" id="hist-h" bodyClass="p-0">
        <ul className="divide-y divide-rule">
          {PAYOUTS.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink-dark">
                  {p.id} · {fmtUsd(p.amount)} USD
                </p>
                <p className="text-sm text-muted-dark">
                  Requested {p.requested} · {p.method} · reference {p.ref}
                </p>
                {p.note ? <p className="mt-1 text-xs text-warning">{p.note}</p> : null}
              </div>
              {p.state === "paid" ? (
                <Badge surface="light" tone="violet">Paid</Badge>
              ) : (
                <Badge surface="light" tone="warning">Transfer unconfirmed · reserved</Badge>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
