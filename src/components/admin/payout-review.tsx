"use client";

import { useId, useState } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/console/parts";
import { ROLE_LABEL } from "./admin-chrome";
import { PAYOUT_BATCH, TRANSFERS } from "@/lib/admin-data";
import { setDemo, useDemo } from "@/lib/demo-store";
import { fmtDateTime, fmtUsd } from "@/lib/format";

/**
 * Payout review (guide §09 "Financial dialogs"): payee, verified method, exact
 * items and amounts, preparer/approver separation and transfer state.
 * "Mark paid" is never an unguarded toggle; uncertain transfers stay reserved.
 */
export function PayoutReview() {
  const demo = useDemo();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const decision = demo.payoutDecisions[PAYOUT_BATCH.id];
  const eligible = PAYOUT_BATCH.items.filter((i) => i.methodVerified);
  const held = PAYOUT_BATCH.items.filter((i) => !i.methodVerified);
  const total = eligible.reduce((a, i) => a + i.amount, 0);
  const fees = eligible.reduce((a, i) => a + i.fee, 0);

  let blocked: string | null = null;
  if (decision) blocked = decision === "approved" ? "This batch is approved and queued for transfer." : "This batch is on hold.";
  else if (demo.adminRole !== "finance") blocked = `Only a Finance approver can approve payouts. You are signed in as ${ROLE_LABEL[demo.adminRole]}.`;

  return (
    <div className="space-y-6">
      <Panel
        id={`${ids}-b`}
        title={`Batch ${PAYOUT_BATCH.id} · review`}
        action={
          decision === "approved" ? (
            <Badge surface="light" tone="success">Approved · queued for transfer</Badge>
          ) : decision === "held" ? (
            <Badge surface="light" tone="warning">On hold</Badge>
          ) : (
            <Badge surface="light" tone="info" icon="pending">Awaiting approval</Badge>
          )
        }
        bodyClass="p-0"
      >
        <p className="border-b border-rule px-5 py-3 text-sm text-muted-dark">
          Prepared by <strong className="text-ink-dark">{PAYOUT_BATCH.preparedBy}</strong> on {fmtDateTime(PAYOUT_BATCH.preparedAt)}. The approver must be a different person. Currency: {PAYOUT_BATCH.currency}.
        </p>
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Payout batch table" tabIndex={0}>
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Payees in this batch</caption>
            <thead>
              <tr className="border-b border-rule text-left text-muted-dark">
                <th scope="col" className="px-5 py-2.5 font-semibold">Payee</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Method</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Items</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Fee</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">In this approval</th>
              </tr>
            </thead>
            <tbody>
              {PAYOUT_BATCH.items.map((i) => (
                <tr key={i.partnerId} className="h-12 border-b border-rule last:border-0">
                  <td className="px-5">
                    <span className="block font-semibold text-ink-dark">{i.payee}</span>
                    <span className="text-xs text-muted-dark">{i.partnerId}</span>
                  </td>
                  <td className="px-3">
                    <span className="block text-ink-dark">{i.method}</span>
                    {i.methodVerified ? (
                      <Badge surface="light" tone="success" className="mt-1">Verified</Badge>
                    ) : (
                      <Badge surface="light" tone="warning" className="mt-1">Not verified</Badge>
                    )}
                  </td>
                  <td className="px-3 text-right tabular">{i.items}</td>
                  <td className="px-3 text-right font-semibold tabular">{fmtUsd(i.amount)}</td>
                  <td className="px-3 text-right tabular">{fmtUsd(i.fee)}</td>
                  <td className="px-5 text-sm">{i.methodVerified ? "Included" : <span className="text-warning">Excluded — method must be verified first</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-4 border-t border-rule p-5 lg:flex-row lg:items-end lg:justify-between">
          <dl className="grid grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="text-muted-dark">Payees included</dt>
              <dd className="text-lg font-semibold text-ink-dark">{eligible.length}</dd>
            </div>
            <div>
              <dt className="text-muted-dark">Transfer total</dt>
              <dd className="text-lg font-semibold text-ink-dark">{fmtUsd(total)}</dd>
            </div>
            <div>
              <dt className="text-muted-dark">Fees</dt>
              <dd className="text-lg font-semibold text-ink-dark">{fmtUsd(fees)}</dd>
            </div>
          </dl>
          <div className="lg:max-w-sm">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button variant="secondary-light" disabled={Boolean(blocked)} onClick={() => setDemo((s) => ({ ...s, payoutDecisions: { ...s.payoutDecisions, [PAYOUT_BATCH.id]: "held" } }))}>
                Hold batch
              </Button>
              <Button disabled={Boolean(blocked)} aria-describedby={`${ids}-why`} onClick={() => setOpen(true)} icon={<ShieldCheck aria-hidden className="size-4" />}>
                Review and approve
              </Button>
            </div>
            <p id={`${ids}-why`} className="mt-2 text-sm text-muted-dark lg:text-right">
              {blocked ?? "Approval queues transfers; it does not mark anything paid."}
            </p>
          </div>
        </div>
      </Panel>

      <Panel id="transfers" title="Transfers in progress" bodyClass="p-0">
        <ul className="divide-y divide-rule">
          {TRANSFERS.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink-dark">
                  {t.id} · {t.payee} · {fmtUsd(t.amount)}
                </p>
                <p className="text-sm text-muted-dark">
                  Sent {t.sentAt} · {t.ref}
                </p>
              </div>
              {t.state === "unconfirmed" ? (
                <div className="sm:text-right">
                  <Badge surface="light" tone="warning">Unconfirmed — amount stays reserved</Badge>
                  <p className="mt-1 max-w-xs text-xs text-muted-dark">Resolve with the bank reference before marking paid or returning the amount to available.</p>
                </div>
              ) : t.state === "paid" ? (
                <Badge surface="light" tone="success">Paid</Badge>
              ) : (
                <Badge surface="light" tone="error">Failed — returned to available</Badge>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        surface="light"
        size="lg"
        title={`Approve batch ${PAYOUT_BATCH.id}?`}
        description="Check payees, methods and amounts. Approval queues bank transfers in the payout provider."
        footer={
          <>
            <Button variant="secondary-light" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!ack}
              onClick={() => {
                setDemo((s) => ({ ...s, payoutDecisions: { ...s.payoutDecisions, [PAYOUT_BATCH.id]: "approved" } }));
                setOpen(false);
              }}
            >
              Approve {fmtUsd(total)} to {eligible.length} payees
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-rule rounded-[var(--radius-control)] border border-rule text-sm">
          {eligible.map((i) => (
            <li key={i.partnerId} className="flex justify-between gap-3 px-3 py-2.5">
              <span>
                {i.payee} · {i.method}
              </span>
              <span className="font-semibold tabular">{fmtUsd(i.amount)}</span>
            </li>
          ))}
        </ul>
        {held.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-tint p-3 text-sm text-warning">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {held.map((h) => h.payee).join(", ")} stays out of this approval until the payout method is verified. Their balance remains available to them.
          </p>
        ) : null}
        <label className="mt-4 flex items-start gap-2 text-sm text-ink-dark">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[#253ff6]" />I am not the preparer of this batch and I checked every payee and amount.
        </label>
      </Dialog>
    </div>
  );
}
