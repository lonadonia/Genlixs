"use client";

import { useState } from "react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { STATE_LABEL, units, type Job } from "@/lib/live/types";
import { fmtCredits } from "@/lib/format";

const TONE: Record<string, Tone> = {
  succeeded: "success",
  failed: "error",
  cancelled: "neutral",
  processing_delayed: "attention",
  review_required: "attention",
  submission_unknown: "attention",
};

const SETTLEMENT: Record<Job["settlementState"], string> = {
  reserved: "reserved — charged only when the file is saved",
  captured: "charged for the saved file",
  released: "returned to your balance",
};

/** Honest job state from the database: reservation, events and terminal outcome (§14, §19.2). */
export function LiveJobStatus({ job, onChanged }: { job: Job; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = TONE[job.state] ?? "info";
  const running = !["succeeded", "failed", "cancelled"].includes(job.state);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/generations/${job.id}/cancel`, { method: "POST", body: {} });
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Job status" className="rounded-[24px] border border-white/[0.08] bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{job.title}</p>
          <p className="text-xs text-muted">
            {job.ref} · {job.modelName}
          </p>
        </div>
        <Badge tone={tone} icon={running && tone === "info" ? "busy" : undefined}>
          {STATE_LABEL[job.state] ?? job.state}
        </Badge>
      </div>
      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {fmtCredits(units(job.units))} {SETTLEMENT[job.settlementState]}.
      </p>
      {job.failureMessage ? <p className="mt-2 text-sm text-orange-on-dark">{job.failureMessage}</p> : null}
      {job.state === "review_required" ? (
        <p className="mt-2 text-sm text-muted">Our team checks these by hand. Your credits stay reserved and are never charged without a saved file.</p>
      ) : null}
      {job.events.length ? (
        <ol className="mt-4 space-y-1.5 border-t border-white/[0.07] pt-3 text-sm">
          {job.events.slice(-6).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3">
              <time dateTime={e.at} className="w-16 shrink-0 text-xs text-subtle tabular">
                {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
              <span className="text-muted">{e.message}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {job.state === "queued" ? (
        <div className="mt-4">
          <Button variant="secondary" size="sm" busy={busy} onClick={cancel}>
            Cancel and return credits
          </Button>
          {error ? <p className="mt-1 text-sm text-error-on-dark">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
