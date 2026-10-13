"use client";

import { useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { setDemo, useDemo } from "@/lib/demo-store";

const INVOICES: { id: string; date: string; item: string; amount: string; status: string; tone: Tone }[] = [
  { id: "INV-2026-0412", date: "1 Oct 2026", item: "Creator plan · October", amount: "$12.00", status: "Paid", tone: "success" },
  { id: "INV-2026-0388", date: "4 Oct 2026", item: "Starter pack · 200 credits", amount: "$9.00", status: "Paid", tone: "success" },
  { id: "INV-2026-0301", date: "1 Sep 2026", item: "Creator plan · September", amount: "$12.00", status: "Refunded", tone: "info" },
  { id: "INV-2026-0297", date: "28 Aug 2026", item: "Medium pack · 600 credits", amount: "$24.00", status: "Payment failed", tone: "error" },
];

export function Billing() {
  const demo = useDemo();
  const [cancel, setCancel] = useState(false);
  const cancelling = demo.subscription === "cancelling";

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Billing</h1>
        <p className="text-muted">Plan, invoices and payment method. Sample records for layout review.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="plan-h" className="rounded-[var(--radius-media)] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plan-h" className="font-semibold">
              Plan
            </h2>
            {cancelling ? <Badge tone="warning">Cancels 1 Nov 2026</Badge> : <Badge tone="success">Active</Badge>}
          </div>
          <p className="mt-3 text-2xl font-semibold">Creator monthly</p>
          <p className="text-sm text-muted">Sample plan · $12.00 per month · cycle 1–31 Oct 2026</p>
          <p className="mt-3 text-sm text-muted">
            {cancelling ? "Your plan stays active until 1 Nov 2026 and won't renew." : "Renews on 1 Nov 2026."}
          </p>
          <div className="mt-4">
            {cancelling ? (
              <Button variant="secondary" onClick={() => setDemo((s) => ({ ...s, subscription: "active" }))}>
                Keep my plan
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setCancel(true)}>
                Cancel subscription
              </Button>
            )}
          </div>
        </section>

        <section aria-labelledby="pm-h" className="rounded-[var(--radius-media)] border border-line bg-surface p-5">
          <h2 id="pm-h" className="font-semibold">
            Payment method
          </h2>
          <p className="mt-3 flex items-center gap-2 text-ink">
            <CreditCard aria-hidden className="size-5 text-muted" /> Card ending 4242 · expires 08/28
          </p>
          <p className="mt-2 text-sm text-muted">Card details are stored and changed by the payment provider, not by Genlixs.</p>
          <div className="mt-4">
            <Button variant="secondary" disabled aria-describedby="pm-reason" icon={<ExternalLink aria-hidden className="size-4" />}>
              Manage in provider portal
            </Button>
            <p id="pm-reason" className="mt-2 text-xs text-muted">
              Unavailable in this preview: the provider portal connects when payments are integrated.
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="inv-h" className="rounded-[var(--radius-media)] border border-line bg-surface">
        <h2 id="inv-h" className="border-b border-line p-5 font-semibold">
          Invoices
        </h2>
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Invoices table" tabIndex={0}>
          <table className="w-full min-w-[620px] text-sm">
            <caption className="sr-only">Invoices with payment and refund status</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-5 py-3 font-semibold">Invoice</th>
                <th scope="col" className="px-5 py-3 font-semibold">Date</th>
                <th scope="col" className="px-5 py-3 font-semibold">Item</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Amount</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {INVOICES.map((i) => (
                <tr key={i.id}>
                  <td className="px-5 py-3 font-mono text-xs">{i.id}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted">{i.date}</td>
                  <td className="px-5 py-3">{i.item}</td>
                  <td className="px-5 py-3 text-right tabular">{i.amount} USD</td>
                  <td className="px-5 py-3">
                    <Badge tone={i.tone}>{i.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancel your subscription?"
        description="Here is exactly what happens before you confirm."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancel(false)}>
              Keep plan
            </Button>
            <Button
              onClick={() => {
                setDemo((s) => ({ ...s, subscription: "cancelling" }));
                setCancel(false);
              }}
            >
              Cancel at end of period
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          <li>Your plan stays active until the end of this period, 1 Nov 2026.</li>
          <li>You won&apos;t be charged again unless you resume the plan.</li>
          <li>Credits you already bought stay in your balance until their lot expiry.</li>
          <li>Your library and files are not deleted.</li>
        </ul>
      </Dialog>
    </div>
  );
}
