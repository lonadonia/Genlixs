"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleCheck, CircleDashed, FlaskConical } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { setDemo, useDemo } from "@/lib/demo-store";
import { cn } from "@/lib/format";

type Decision = "submitted" | "needs-info" | "accepted" | "rejected";

export function ApplyForm() {
  const demo = useDemo();
  const ids = useId();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [niche, setNiche] = useState("");
  const [method, setMethod] = useState("");
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<Decision | null>(null);

  const status: Decision | null = decision ?? (demo.partnerStatus === "accepted" ? "accepted" : demo.partnerStatus === "submitted" ? "submitted" : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n: Record<string, string> = {};
    if (name.trim().length < 2) n.name = "Enter your name or brand.";
    if (!/^https?:\/\/\S+\.\S+/.test(channel.trim())) n.channel = "Enter a full channel link, starting with https://";
    if (!niche) n.niche = "Choose your main topic.";
    if (method.trim().length < 20) n.method = "Tell us in at least 20 characters how you would promote Genlixs.";
    if (!terms) n.terms = "Accept the program terms to apply.";
    setErrors(n);
    const first = Object.keys(n)[0];
    if (first) {
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    setDemo((s) => ({ ...s, partnerStatus: "submitted" }));
    setDecision("submitted");
  };

  if (status) {
    const steps: { k: Decision | "review"; label: string }[] = [
      { k: "submitted", label: "Application submitted" },
      { k: "review", label: "Manual review" },
      { k: status === "rejected" ? "rejected" : status === "needs-info" ? "needs-info" : "accepted", label: status === "rejected" ? "Not accepted" : status === "needs-info" ? "More information needed" : "Decision" },
    ];
    const done = status === "accepted" || status === "rejected" ? 3 : status === "needs-info" ? 2 : 1;
    return (
      <div className="grid max-w-4xl gap-6 lg:grid-cols-5">
        <section aria-live="polite" className="rounded-[var(--radius-media)] border border-line bg-surface p-6 lg:col-span-3">
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                {i < done ? <CircleCheck aria-hidden className="size-5 text-brand-lime" /> : <CircleDashed aria-hidden className="size-5 text-muted" />}
                <span className={i < done ? "font-semibold text-ink" : "text-muted"}>{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 border-t border-line pt-5">
            {status === "submitted" ? (
              <p className="text-muted">Thanks — we review applications by hand and reply by email, usually within a few working days (sample timing).</p>
            ) : status === "needs-info" ? (
              <p className="text-muted">We need one more thing: a link to a recent post where you used an AI creation tool. Reply to the email we sent to continue.</p>
            ) : status === "rejected" ? (
              <p className="text-muted">We can&apos;t accept this application right now. The email explains why and when you can apply again.</p>
            ) : (
              <>
                <p className="font-semibold text-ink">You&apos;re in. Your partner portal is ready.</p>
                <p className="mt-1 text-sm text-muted">Use the same account to switch between your customer studio and the partner portal.</p>
                <ButtonLink href="/partner" className="mt-4">
                  Open the partner portal
                </ButtonLink>
              </>
            )}
          </div>
        </section>
        <details className="h-fit rounded-[var(--radius-media)] border border-dashed border-line-strong lg:col-span-2" open>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold text-muted">
            <FlaskConical aria-hidden className="size-4" /> Prototype: review outcome
          </summary>
          <div className="grid gap-2 px-4 pb-4">
            {(
              [
                ["needs-info", "Ask for more information"],
                ["accepted", "Accept"],
                ["rejected", "Reject"],
              ] as const
            ).map(([v, l]) => (
              <Button
                key={v}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDecision(v);
                  setDemo((s) => ({ ...s, partnerStatus: v === "accepted" ? "accepted" : "submitted" }));
                }}
              >
                {l}
              </Button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDecision(null);
                setDemo((s) => ({ ...s, partnerStatus: "none" }));
              }}
              className="mt-1 text-left text-xs font-semibold text-link underline"
            >
              Start a new application
            </button>
          </div>
        </details>
      </div>
    );
  }

  const field = "mt-1.5 block w-full rounded-[var(--radius-control)] border border-line-strong bg-raised px-3.5 text-[15px] text-ink aria-invalid:border-error-on-dark";
  const err = (k: string) =>
    errors[k] ? (
      <p id={`${ids}-${k}-e`} className="mt-1.5 text-sm text-error-on-dark">
        {errors[k]}
      </p>
    ) : null;
  const describe = (k: string, extra?: string) => cn(errors[k] && `${ids}-${k}-e`, extra) || undefined;

  return (
    <form noValidate onSubmit={submit} className="max-w-2xl space-y-5 rounded-[var(--radius-media)] border border-line bg-surface p-6">
      <div>
        <label htmlFor={`${ids}-name`} className="text-sm font-semibold">
          Name or brand
        </label>
        <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={describe("name")} className={`${field} h-12`} />
        {err("name")}
      </div>
      <div>
        <label htmlFor={`${ids}-channel`} className="text-sm font-semibold">
          Main channel link
        </label>
        <input
          id={`${ids}-channel`}
          type="url"
          inputMode="url"
          placeholder="https://youtube.com/@yourchannel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          aria-invalid={Boolean(errors.channel)}
          aria-describedby={describe("channel")}
          className={`${field} h-12`}
        />
        {err("channel")}
      </div>
      <div>
        <label htmlFor={`${ids}-niche`} className="text-sm font-semibold">
          Main topic
        </label>
        <select id={`${ids}-niche`} value={niche} onChange={(e) => setNiche(e.target.value)} aria-invalid={Boolean(errors.niche)} aria-describedby={describe("niche")} className={`${field} h-12`}>
          <option value="">Choose a topic</option>
          <option>Design and illustration</option>
          <option>Video and filmmaking</option>
          <option>Marketing and e-commerce</option>
          <option>AI tools and education</option>
          <option>Other</option>
        </select>
        {err("niche")}
      </div>
      <div>
        <label htmlFor={`${ids}-method`} className="text-sm font-semibold">
          How would you promote Genlixs?
        </label>
        <textarea id={`${ids}-method`} rows={4} value={method} onChange={(e) => setMethod(e.target.value)} aria-invalid={Boolean(errors.method)} aria-describedby={describe("method")} className={`${field} py-3`} />
        {err("method")}
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input
            id={`${ids}-terms`}
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={Boolean(errors.terms)}
            aria-describedby={describe("terms")}
            className="mt-0.5 size-4 accent-[#1c5dff]"
          />
          <span>
            I accept the partner program terms, version 1.2 (sample). Commission rates, holding periods and payout minimums are set in those terms.
          </span>
        </label>
        {err("terms")}
      </div>
      <Button type="submit" size="lg">
        Submit application
      </Button>
      <p className="text-xs text-muted">Preview: nothing is sent. Your answers stay in this page.</p>
    </form>
  );
}
