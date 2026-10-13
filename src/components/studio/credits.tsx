"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRight, CircleCheck, CircleX, FlaskConical, Info, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TOOLS } from "@/lib/catalog";
import { PACKS, paymentState, startPayment, useDemo, useNow, type LedgerEntry, type PaymentOutcome } from "@/lib/demo-store";
import { cn, fmtDate, fmtDateTime, fmtNum, fmtSigned } from "@/lib/format";

const KIND: Record<LedgerEntry["kind"], string> = {
  purchase: "Purchase",
  reserve: "Reserved",
  charge: "Charged",
  return: "Returned",
  grant: "Grant",
};

const safeReturn = (v: string | null) => (v && v.startsWith("/studio/") && !v.startsWith("//") ? v : null);

export function Credits() {
  const demo = useDemo();
  const now = useNow();
  const params = useSearchParams();
  const returnTo = safeReturn(params.get("return"));
  const [topup, setTopup] = useState(false);
  const [pack, setPack] = useState<string>(PACKS[1].id);
  const [outcome, setOutcome] = useState<PaymentOutcome>("confirmed");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const ids = useId();

  const payment = paymentId ? demo.payments.find((p) => p.id === paymentId) : undefined;
  const pState = payment ? paymentState(payment, now) : null;
  const draftTool = demo.draft?.tool;
  const backHref = returnTo ?? (draftTool ? TOOLS[draftTool].href : null);
  const lateNotice = payment && pState === "verifying" && now - payment.createdAt > 7000;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Credits</h1>
          <p className="text-muted">Balances are kept separate so you always know what you can spend.</p>
        </div>
        <Button size="lg" onClick={() => setTopup(true)}>
          Top up credits
        </Button>
      </div>

      {returnTo && !payment ? (
        <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[rgb(28_93_255/0.4)] bg-[rgb(28_93_255/0.1)] p-3 text-sm text-ink">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-link" />
          Your draft is saved. After topping up you can return to it — nothing is generated until you press Generate again.
        </p>
      ) : null}

      {payment ? (
        <section aria-live="polite" className={cn("rounded-[var(--radius-media)] border p-5", pState === "confirmed" ? "border-[rgb(173_219_90/0.35)] bg-[rgb(173_219_90/0.07)]" : pState === "failed" ? "border-[rgb(214_54_82/0.45)] bg-[rgb(214_54_82/0.08)]" : "border-line bg-surface")}>
          {pState === "verifying" ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <LoaderCircle aria-hidden className="size-5 animate-spin-slow text-link" /> Verifying payment
              </p>
              <p className="mt-1 text-sm text-muted">
                We&apos;re waiting for the payment provider to confirm {payment.id}. Credits are added only after confirmation — returning from checkout is not enough.
              </p>
              {lateNotice ? (
                <p className="mt-2 text-sm text-orange-on-dark">This is taking longer than usual. You can leave this page; the credits appear as soon as the payment is confirmed.</p>
              ) : null}
            </>
          ) : pState === "confirmed" ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CircleCheck aria-hidden className="size-5 text-brand-lime" /> Payment confirmed — {fmtNum(payment.credits)} credits added
              </p>
              <p className="mt-1 text-sm text-muted">Reference {payment.id}. Your available balance is now {fmtNum(demo.available)} credits.</p>
              {backHref ? (
                <ButtonLink href={backHref} className="mt-4" icon={<ArrowRight aria-hidden className="order-last size-4" />}>
                  Return to your draft
                </ButtonLink>
              ) : null}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CircleX aria-hidden className="size-5 text-error-on-dark" /> Payment not completed
              </p>
              <p className="mt-1 text-sm text-muted">The provider declined {payment.id}. No credits were added and you were not charged. You can try again or use another payment method.</p>
              <Button variant="secondary" className="mt-4" onClick={() => setTopup(true)}>
                Try again
              </Button>
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="bal-h">
        <h2 id="bal-h" className="sr-only">
          Balances
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            { k: "Available", v: demo.available, d: "Can start new jobs now.", accent: "bg-brand-lime" },
            { k: "Reserved", v: demo.reserved, d: "Held for running jobs. Charged on save, returned on failure.", accent: "bg-brand-blue" },
            { k: "Used this period", v: demo.usedThisPeriod, d: "Charged since 1 Oct 2026 (sample period).", accent: "bg-line-strong" },
          ].map((b) => (
            <div key={b.k} className="rounded-[var(--radius-media)] border border-line bg-surface p-5">
              <dt className="flex items-center gap-2 text-sm font-semibold text-muted">
                <span aria-hidden className={cn("h-3 w-1 rounded-full", b.accent)} />
                {b.k}
              </dt>
              <dd className="mt-2 text-[2rem] leading-none font-semibold tracking-tight text-ink tabular">{fmtNum(b.v)}</dd>
              <dd className="mt-2 text-sm text-muted">{b.d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="lots-h" className="rounded-[var(--radius-media)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-5">
          <h2 id="lots-h" className="font-semibold">
            Credit lots
          </h2>
          <Badge tone="attention" icon="none">
            Sample data
          </Badge>
        </div>
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Credit lots table" tabIndex={0}>
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Credit lots with remaining balance and expiry</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-5 py-3 font-semibold">Lot</th>
                <th scope="col" className="px-5 py-3 font-semibold">Source</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Granted</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Remaining</th>
                <th scope="col" className="px-5 py-3 font-semibold">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-5 py-3 font-mono text-xs">LOT-30418</td>
                <td className="px-5 py-3">Starter pack · P-30418</td>
                <td className="px-5 py-3 text-right tabular">200</td>
                <td className="px-5 py-3 text-right tabular">{fmtNum(Math.min(200, demo.available + demo.reserved))}</td>
                <td className="px-5 py-3">13 Apr 2027</td>
              </tr>
              {demo.payments
                .filter((p) => p.settled && p.outcome !== "failed")
                .map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 font-mono text-xs">LOT-{p.id.slice(2)}</td>
                    <td className="px-5 py-3">{PACKS.find((x) => x.id === p.packId)?.name} · {p.id}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNum(p.credits)}</td>
                    <td className="px-5 py-3 text-right tabular">{fmtNum(p.credits)}</td>
                    <td className="px-5 py-3">Per approved policy</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ledger-h" className="rounded-[var(--radius-media)] border border-line bg-surface">
        <div className="border-b border-line p-5">
          <h2 id="ledger-h" className="font-semibold">
            Ledger movements
          </h2>
          <p className="text-sm text-muted">Every change to your balance, with the job or payment it belongs to.</p>
        </div>
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Ledger table" tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Credit ledger</caption>
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-5 py-3 font-semibold">Date</th>
                <th scope="col" className="px-5 py-3 font-semibold">Movement</th>
                <th scope="col" className="px-5 py-3 font-semibold">Reference</th>
                <th scope="col" className="px-5 py-3 font-semibold">Detail</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {demo.ledger.slice(0, 14).map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3 whitespace-nowrap text-muted">{fmtDateTime(l.at)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={l.kind === "charge" ? "neutral" : l.kind === "reserve" ? "info" : "success"} icon="none">
                      {KIND[l.kind]}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{l.ref}</td>
                  <td className="px-5 py-3 text-muted">{l.note}</td>
                  <td className={cn("px-5 py-3 text-right font-semibold tabular", l.credits > 0 ? "text-brand-lime" : "text-ink")}>{fmtSigned(l.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={topup}
        onClose={() => setTopup(false)}
        title="Top up credits"
        description="Choose a pack. You'll confirm the payment with the payment provider."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTopup(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const p = startPayment(pack, outcome);
                if (p) setPaymentId(p.id);
                setTopup(false);
              }}
            >
              Continue to checkout
            </Button>
          </>
        }
      >
        <fieldset>
          <legend className="text-sm font-semibold">Pack</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {PACKS.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-control)] border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                  pack === p.id ? "border-brand-blue bg-[rgb(28_93_255/0.12)]" : "border-line-strong bg-raised",
                )}
              >
                <input type="radio" name={`${ids}-pack`} checked={pack === p.id} onChange={() => setPack(p.id)} className="sr-only" />
                <span className="block text-sm text-muted">{p.name}</span>
                <span className="mt-1 block text-2xl font-semibold tabular">{fmtNum(p.credits)}</span>
                <span className="block text-sm text-muted">credits · {p.priceLabel}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="mt-4 text-sm text-muted">Sample packs and prices for layout review — not approved pricing. Taxes and currency are confirmed at checkout.</p>
        <details className="mt-4 rounded-[var(--radius-control)] border border-dashed border-line-strong">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold text-muted">
            <FlaskConical aria-hidden className="size-4" /> Prototype: payment outcome
          </summary>
          <fieldset className="grid gap-1.5 px-3 pb-3">
            <legend className="sr-only">Simulated payment outcome</legend>
            {(
              [
                ["confirmed", "Confirmed after verification"],
                ["late", "Confirmation arrives late"],
                ["failed", "Declined by the provider"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={`${ids}-out`} checked={outcome === v} onChange={() => setOutcome(v)} className="size-4 accent-[#1c5dff]" />
                {l}
              </label>
            ))}
          </fieldset>
        </details>
      </Dialog>

      <p className="text-xs text-muted">
        Last purchase {fmtDate(Date.UTC(2026, 9, 4))}. Questions about a charge?{" "}
        <Link href="/studio/support" className="font-semibold text-link hover:underline">
          Contact support
        </Link>
        .
      </p>
    </div>
  );
}
