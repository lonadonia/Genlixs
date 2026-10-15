"use client";

import type { Job } from "@/lib/live/types";
import { useJob } from "@/lib/live/use-job";
import { GenerationPreviewCard, type UseAction } from "./generation-card";
import { GenlixsEmblem } from "./emblem";

/** One stored job, followed until it settles; the card turns into the saved image or playable video. */
export function LiveJobCard({
  jobId,
  uses = [],
  onSettled,
  onGone,
}: {
  jobId: string;
  uses?: UseAction[];
  onSettled?: (job: Job) => void;
  onGone?: () => void;
}) {
  const { job, connection, reload } = useJob(jobId, onSettled);
  if (!job) {
    if (connection === "gone") {
      return (
        <div className="rounded-[24px] border border-white/[0.08] bg-surface p-6 text-center text-sm text-muted">
          This job is not available.
          {onGone ? (
            <>
              {" "}
              <button type="button" onClick={onGone} className="font-semibold text-link underline">
                Start a new one
              </button>
            </>
          ) : null}
        </div>
      );
    }
    return <div className="aspect-video w-full animate-pulse-soft rounded-[24px] bg-surface" role="status" aria-label="Loading the job" />;
  }
  return <GenerationPreviewCard key={job.id} job={job} connection={connection} onChanged={reload} uses={uses} />;
}

/** Calm placeholder before the first job: the same frame language as the card, without a fake result. */
export function EmptyPreview({ kind, hint }: { kind: "image" | "video"; hint: string }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-surface p-3 sm:p-4">
      <div className={`relative grid place-items-center overflow-hidden rounded-[18px] bg-canvas ring-1 ring-white/[0.06] ${kind === "video" ? "aspect-video" : "aspect-[4/3]"}`}>
        <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(110% 80% at 50% 35%, rgb(37 63 246 / 0.12) 0%, rgb(15 18 18 / 0.9) 70%)" }} />
        <div className="relative flex flex-col items-center gap-3 px-6 text-center">
          <GenlixsEmblem size={56} animated={false} />
          <p className="text-base font-semibold text-ink">Your {kind} appears here</p>
          <p className="max-w-sm text-sm text-muted">{hint}</p>
        </div>
      </div>
    </div>
  );
}
