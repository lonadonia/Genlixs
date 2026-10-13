"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, CircleX, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Panel } from "@/components/console/parts";
import { ROLE_LABEL } from "./admin-chrome";
import { STATUS_META, jobEvents, type AdminJob } from "@/lib/admin-data";
import { TOOLS } from "@/lib/catalog";
import { recordAdminAction, useDemo, useNow } from "@/lib/demo-store";
import { cn, fmtDateTime } from "@/lib/format";

const REASONS = ["Job failed after charge", "Duplicate submission", "Output not delivered to customer", "Service delay goodwill", "Other (explain in note)"];

export function JobDetail({ job, back }: { job: AdminJob; back: string | null }) {
  const demo = useDemo();
  const now = useNow();
  const ids = useId();
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recon, setRecon] = useState<"idle" | "running" | "done">("idle");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(job.credits));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const action = demo.adminActions.find((a) => a.jobId === job.id && a.kind === "return-credits");
  const stale = refreshedAt === null || (now > 0 && now - refreshedAt > 5 * 60_000);
  const meta = STATUS_META[job.status];
  const canAdjust = demo.adminRole !== "support";

  // Why the financial action is (un)available — always explained (guide §09 "Financial dialogs").
  let blocked: string | null = null;
  if (action) blocked = `Already adjusted: ${action.credits} credits returned by ${ROLE_LABEL[action.actor]} (${action.id}).`;
  else if (job.settlement === "returned") blocked = "Reserved credits were already returned automatically when the job failed.";
  else if (job.status === "unconfirmed" && recon !== "done") blocked = "Reconcile with the provider first — the request may still have been accepted.";
  else if (!canAdjust) blocked = `Your role (${ROLE_LABEL[demo.adminRole]}) can view jobs but cannot adjust credits. Ask an Operations admin or Finance approver.`;
  else if (stale) blocked = "Refresh this record before making a financial decision.";

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshedAt(Date.now());
      setRefreshing(false);
    }, 700);
  };

  const submit = () => {
    const n = Number(amount);
    const e: Record<string, string> = {};
    if (!Number.isInteger(n) || n < 1) e.amount = "Enter a whole number of credits, at least 1.";
    else if (n > job.credits) e.amount = `Cannot exceed the ${job.credits} credits on this job.`;
    if (!reason) e.reason = "Choose a reason.";
    if (note.trim().length < 10) e.note = "Add a note of at least 10 characters for the audit record.";
    if (!confirm) e.confirm = "Confirm that you checked the timeline.";
    setErrors(e);
    if (Object.keys(e).length) return;
    recordAdminAction({ jobId: job.id, kind: "return-credits", credits: n, reason, note: note.trim(), actor: demo.adminRole });
    setOpen(false);
  };

  const events = jobEvents(job);
  const facts: [string, React.ReactNode][] = [
    ["Customer", <>{job.customerId} · {job.customer}</>],
    ["Tool · model", `${TOOLS[job.tool].label} · ${job.model}`],
    ["Created", fmtDateTime(job.createdAt)],
    ["Duration", job.durationS === null ? "Still running" : `${job.durationS}s`],
    ["Quote", `${job.credits} credits · ${job.priceVersion}`],
    ["Settlement", action ? `Returned by adjustment (${action.id})` : job.settlement === "reserved" ? "Reserved — not yet charged" : job.settlement === "charged" ? "Charged" : "Returned"],
    ["Attempts", String(job.attempts)],
    ["Provider task", <span key="p" className="font-mono text-xs">{job.providerTask}</span>],
    ["Supplier cost", `$${job.supplierCostUsd.toFixed(3)} USD`],
    ["Import", job.importState],
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <Link href={back ? `/admin/jobs?${back}` : "/admin/jobs"} className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-info-text hover:underline">
        <ArrowLeft aria-hidden className="size-4" /> Back to jobs{back ? " (filters kept)" : ""}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[1.625rem] font-semibold tracking-tight text-ink-dark">{job.id}</h1>
            <Badge surface="light" tone={meta.tone}>
              {meta.label}
            </Badge>
            <CopyButton value={job.id} label="Copy ID" surface="light" variant="inline" className="h-8" />
          </div>
          <p className="mt-1 text-sm text-muted-dark">
            {TOOLS[job.tool].label} · {job.model} · {job.customerId}
          </p>
        </div>
        <div className={cn("flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-sm", stale ? "border-[#f3d9a8] bg-warning-tint text-warning" : "border-[#dceb8f] bg-success-tint text-success-text")}>
          {stale ? <CircleAlert aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
          <span role="status">{stale ? "Data may be stale — last refreshed 13 Oct, 09:00 UTC" : "Refreshed just now"}</span>
          <Button variant="secondary-light" size="sm" busy={refreshing} onClick={refresh} icon={<RefreshCw aria-hidden className="size-3.5" />}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel title="Facts" id={`${ids}-facts`}>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0 border-b border-rule pb-3">
                  <dt className="text-xs font-semibold text-muted-dark">{k}</dt>
                  <dd className="mt-0.5 break-words text-sm text-ink-dark">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Event timeline" id={`${ids}-tl`}>
            <ol className="relative space-y-5 border-l border-rule pl-6">
              {[...events, ...(action ? [{ at: action.at, title: "Credits returned by adjustment", detail: `${action.credits} credits · ${action.reason} · “${action.note}” · ${ROLE_LABEL[action.actor]} · ${action.id}`, tone: "success" as const }] : [])].map((e, i) => (
                <li key={i} className="relative">
                  {/* Status dots mirror the light badges: tone tint inside a tone ring that clears 3:1 on white
                      (success olive 9.9, warning 6.8, error 4.7, neutral 3.9) — lime itself would be 1.1:1. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-1 -left-[31px] grid size-4 place-items-center rounded-full border-2 ring-4 ring-sheet",
                      e.tone === "error"
                        ? "border-error bg-error-tint"
                        : e.tone === "warning"
                          ? "border-warning bg-warning-tint"
                          : e.tone === "success"
                            ? "border-success-text bg-success-tint"
                            : "border-rule-strong bg-sheet",
                    )}
                  />
                  <p className="text-sm font-semibold text-ink-dark">{e.title}</p>
                  <p className="text-sm text-muted-dark">{e.detail}</p>
                  <p className="mt-0.5 text-xs text-muted-dark">{fmtDateTime(e.at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Actions" id={`${ids}-act`}>
            <div className="space-y-4">
              {job.status === "unconfirmed" ? (
                <div className="rounded-[var(--radius-control)] border border-[#f3d9a8] bg-warning-tint p-3 text-sm text-warning">
                  <p className="font-semibold">Submission not acknowledged</p>
                  <p className="mt-1">Do not resubmit. Check with the provider whether task {job.providerTask} exists.</p>
                  <Button
                    variant="secondary-light"
                    size="sm"
                    className="mt-3"
                    busy={recon === "running"}
                    disabled={recon === "done"}
                    onClick={() => {
                      setRecon("running");
                      window.setTimeout(() => setRecon("done"), 900);
                    }}
                    icon={recon === "done" ? <Check aria-hidden className="size-3.5" /> : <Search aria-hidden className="size-3.5" />}
                  >
                    {recon === "done" ? "Provider has no record of this task" : "Run reconciliation check"}
                  </Button>
                </div>
              ) : null}

              <div>
                <Button className="w-full" disabled={Boolean(blocked)} aria-describedby={`${ids}-why`} onClick={() => setOpen(true)}>
                  Return credits to customer
                </Button>
                <p id={`${ids}-why`} className="mt-2 text-sm text-muted-dark">
                  {blocked ?? "Opens a guarded adjustment with a reason, a preview of the effect and confirmation."}
                </p>
              </div>
              <p className="border-t border-rule pt-3 text-xs text-muted-dark">
                Private customer media is not shown here. Opening it requires a recorded support purpose (later phase).
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        surface="light"
        size="lg"
        title="Return credits to customer"
        description={`Adjustment for ${job.customerId} on job ${job.id}. Recorded in the append-only credit ledger and audit log.`}
        footer={
          <>
            <Button variant="secondary-light" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>Return {Number(amount) > 0 ? Number(amount) : "—"} credits</Button>
          </>
        }
      >
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 rounded-[var(--radius-control)] bg-paper p-3 text-sm">
            <div>
              <dt className="text-muted-dark">Customer</dt>
              <dd className="font-semibold text-ink-dark">{job.customerId}</dd>
            </div>
            <div>
              <dt className="text-muted-dark">Reference</dt>
              <dd className="font-mono text-xs font-semibold text-ink-dark">{job.id}</dd>
            </div>
          </dl>
          <div>
            <label htmlFor={`${ids}-amt`} className="text-sm font-semibold text-ink-dark">
              Credits to return (max {job.credits})
            </label>
            <input
              id={`${ids}-amt`}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? `${ids}-amt-e` : undefined}
              // `!`: globals.css's light-field border rule (unlayered, higher specificity) otherwise hides the error border on text inputs.
              className="mt-1.5 block h-11 w-40 rounded-[var(--radius-control)] border border-rule-strong px-3 text-ink-dark tabular aria-invalid:border-error!"
            />
            {errors.amount ? <p id={`${ids}-amt-e`} className="mt-1 text-sm text-error-text">{errors.amount}</p> : null}
          </div>
          <div>
            <label htmlFor={`${ids}-reason`} className="text-sm font-semibold text-ink-dark">
              Reason
            </label>
            <select
              id={`${ids}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={Boolean(errors.reason)}
              aria-describedby={errors.reason ? `${ids}-reason-e` : undefined}
              className="mt-1.5 block h-11 w-full rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-ink-dark aria-invalid:border-error"
            >
              <option value="">Choose a reason</option>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {errors.reason ? <p id={`${ids}-reason-e`} className="mt-1 text-sm text-error-text">{errors.reason}</p> : null}
          </div>
          <div>
            <label htmlFor={`${ids}-note`} className="text-sm font-semibold text-ink-dark">
              Note for the audit record
            </label>
            <textarea
              id={`${ids}-note`}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={Boolean(errors.note)}
              aria-describedby={errors.note ? `${ids}-note-e` : undefined}
              className="mt-1.5 block w-full rounded-[var(--radius-control)] border border-rule-strong px-3 py-2 text-ink-dark aria-invalid:border-error"
            />
            {errors.note ? <p id={`${ids}-note-e`} className="mt-1 text-sm text-error-text">{errors.note}</p> : null}
          </div>
          <div className="rounded-[var(--radius-control)] border border-[#c7cefd] bg-info-tint p-3 text-sm text-info-text">
            <p className="font-semibold">Preview of effect</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                {job.customerId} available credits: <strong>+{Number(amount) > 0 ? Number(amount) : 0}</strong>
              </li>
              <li>Ledger: new “return” entry referencing {job.id}; the original charge is kept.</li>
              <li>Audit: recorded as {ROLE_LABEL[demo.adminRole]} with your reason and note.</li>
              <li>No cash refund is issued — this returns generation credits only.</li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-dark">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-4 accent-[#253ff6]" aria-describedby={errors.confirm ? `${ids}-c-e` : undefined} />
            I checked the event timeline and this adjustment is correct.
          </label>
          {errors.confirm ? (
            <p id={`${ids}-c-e`} className="-mt-3 flex items-center gap-1 text-sm text-error-text">
              <CircleX aria-hidden className="size-4" />
              {errors.confirm}
            </p>
          ) : null}
          <p className="text-xs text-muted-dark">
            <LoaderCircle aria-hidden className="mr-1 inline size-3" />
            Preview build: recorded in this browser only.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
