"use client";

import Link from "next/link";
import { Check, CircleX, Clock, Hourglass, LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHASE_LABEL, cancelJob, isDelayed, jobPhase, type Job, type JobPhase } from "@/lib/demo-store";
import { cn, fmtCredits, fmtElapsed } from "@/lib/format";

const STEPS: JobPhase[] = ["waiting", "submitting", "generating", "saving", "ready"];

const COPY: Record<string, (tool: string) => string> = {
  waiting: () => "Waiting for a free slot. You can still cancel.",
  submitting: () => "Sending your request to the generation service.",
  checking: () => "We're checking whether the request was accepted.",
  generating: (t) => `Your ${t} is generating. You can leave this page; we'll keep the job in your library.`,
  saving: () => "Saving the file to your library.",
};

/** Real job phases only — no fake percentage bar (guide §08 "Waiting, delayed and failed states"). */
export function JobStatus({ job, now, onRetry }: { job: Job; now: number; onRetry?: () => void }) {
  const phase = jobPhase(job, now);
  const delayed = isDelayed(job, now);
  const elapsed = now ? now - job.createdAt : 0;
  const toolWord = job.tool === "video" ? "video" : "image";
  const stepIndex = phase === "checking" ? 1 : STEPS.indexOf(phase);

  if (phase === "failed" || phase === "cancelled") {
    return (
      <div role="status" className="rounded-[20px] border border-[rgb(214_54_82/0.45)] bg-[rgb(214_54_82/0.08)] p-5">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <CircleX aria-hidden className="size-5 text-error-on-dark" />
          {phase === "cancelled" ? "Job cancelled before submission" : "This job didn't finish"}
        </p>
        <p className="mt-2 text-sm text-muted">
          {phase === "cancelled" ? "Nothing was sent to the generation service." : job.failureReason ?? "The generation service could not complete this request."}
        </p>
        <p className="mt-2 text-sm font-semibold text-brand-lime">
          {job.settled === "returned" ? `We returned the ${fmtCredits(job.credits)} reserved for this job.` : "Returning the reserved credits…"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Edit and try again
            </Button>
          ) : null}
          <Link href="/studio/support" className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-link hover:underline">
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-2xl border border-[rgb(225_255_1/0.3)] bg-[rgb(225_255_1/0.07)] px-4 py-3 text-sm font-semibold text-ink">
        <Check aria-hidden className="size-4 text-brand-lime" />
        Your file is ready · {job.settled === "charged" ? `${fmtCredits(job.credits)} charged` : "settling credits…"}
      </p>
    );
  }

  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold text-ink" role="status" aria-live="polite">
          <LoaderCircle aria-hidden className="size-5 animate-spin-slow text-brand-blue-bright" />
          {phase === "checking" ? "Confirming submission" : PHASE_LABEL[phase]}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted tabular">
          <Clock aria-hidden className="size-4" /> Elapsed {fmtElapsed(elapsed)}
        </p>
      </div>

      <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Job phases">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li key={s} className="min-w-0">
              <span aria-hidden className={cn("block h-1.5 rounded-full", done ? "bg-brand-blue" : current ? "animate-pulse-soft bg-link" : "bg-elevated")} />
              <span className={cn("mt-1.5 block truncate text-[11px] font-semibold sm:text-xs", current ? "text-ink" : done ? "text-muted" : "text-subtle")}>
                {PHASE_LABEL[s]}
                <span className="sr-only">{done ? " (done)" : current ? " (current)" : " (not started)"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-sm text-muted">{COPY[phase]?.(toolWord)}</p>

      {phase === "checking" ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-[rgb(37_63_246/0.14)] p-3 text-sm text-link">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          Please don&apos;t generate again while we check — the {fmtCredits(job.credits)} stay reserved and you won&apos;t be charged twice for this request.
        </p>
      ) : null}

      {delayed ? (
        <div className="mt-3 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-orange-on-dark">
            <TriangleAlert aria-hidden className="size-4" /> This is taking longer than usual
          </p>
          <p className="mt-1 text-muted">
            The job is still running and your credits stay reserved. You can leave this page — it will appear in your library when it&apos;s ready.{" "}
            <Link href="/status" className="font-semibold text-link hover:underline">
              Check service status
            </Link>
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4 text-sm">
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Hourglass aria-hidden className="size-4" /> {fmtCredits(job.credits)} reserved
        </span>
        <span className="flex-1" />
        {phase === "waiting" ? (
          <Button variant="secondary" size="sm" onClick={() => cancelJob(job.id)}>
            Cancel job
          </Button>
        ) : (
          <span className="text-xs text-muted">Cancellation is no longer available once submitted.</span>
        )}
      </div>
    </div>
  );
}
