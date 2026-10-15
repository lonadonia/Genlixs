/**
 * Progress shown on a generation card. Server state is authoritative; this only turns it into a stage, a caption and
 * a percentage for the bar. The percentage comes from the provider only when the provider reported one ("provider");
 * otherwise it is an estimate from the completed stages and the model's typical timing ("estimate"). It never reaches
 * 100 before the file is saved, never goes backwards while a job runs, and an overrun turns into an honest
 * "taking longer" state instead of a bar parked at 99 %.
 */
export type ProgressJob = {
  state: string;
  stage?: string | null;
  outputKind?: string | null;
  createdAt: string;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  generatedAt?: string | null;
  completedAt?: string | null;
  delayedAfterAt?: string | null;
  providerProgress?: { value: number | string; at: string } | null;
  timing?: { generateSeconds?: number | null; saveSeconds?: number | null; basis?: string | null } | null;
  outputs?: unknown[];
  events?: { event: string; at: string }[];
};

export type Stage = "preparing" | "confirming" | "generating" | "saving" | "ready" | "failed" | "cancelled" | "review";

export type Progress = {
  stage: Stage;
  /** 0–100 for the bar; null when there is nothing to show (failed, cancelled, under review). */
  percent: number | null;
  kind: "provider" | "estimate" | "final" | "none";
  caption: string;
  /** Short line for the help area: why it is slow, what happens to the credits. Never a provider log. */
  detail: string | null;
  delayed: boolean;
  elapsedMs: number;
};

const PREP_END = 6;
const GEN_END = 90;
const SAVE_END = 98;

const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function stageOf(job: Pick<ProgressJob, "state" | "stage">): Stage {
  if (job.stage && ["preparing", "confirming", "generating", "saving", "ready", "failed", "cancelled", "review"].includes(job.stage)) return job.stage as Stage;
  switch (job.state) {
    case "queued":
    case "submitting":
      return "preparing";
    case "submission_unknown":
      return "confirming";
    case "provider_pending":
    case "processing_delayed":
      return "generating";
    case "importing":
      return "saving";
    case "succeeded":
      return "ready";
    case "review_required":
      return "review";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

export function estimateProgress(job: ProgressJob, now: number, previous?: { stage: Stage; percent: number | null } | null): Progress {
  const stage = stageOf(job);
  const video = job.outputKind === "video";
  const noun = video ? "video" : "image";
  const elapsedMs = Math.max(0, now - t(job.createdAt));
  const lastEvent = job.events?.length ? job.events[job.events.length - 1].event : null;

  let out: Progress;
  if (stage === "ready") {
    out = { stage, percent: (job.outputs?.length ?? 1) > 0 ? 100 : SAVE_END, kind: "final", caption: "Ready", detail: null, delayed: false, elapsedMs };
  } else if (stage === "failed" || stage === "cancelled") {
    out = { stage, percent: null, kind: "none", caption: stage === "cancelled" ? "Cancelled" : "Not completed", detail: null, delayed: false, elapsedMs };
  } else if (stage === "review") {
    out = {
      stage, percent: null, kind: "none", caption: "Being checked by our team",
      detail: "Our team checks this job by hand. Your credits stay reserved and are never charged without a saved file.",
      delayed: true, elapsedMs,
    };
  } else if (stage === "preparing" || stage === "confirming") {
    const since = now - t(job.createdAt);
    const waitingService = lastEvent === "waiting_service" || lastEvent === "retry_scheduled";
    const pct = PREP_END * (1 - Math.exp(-since / 20_000));
    out = {
      stage, percent: clamp(pct, 1, PREP_END - 0.5), kind: "estimate",
      caption: stage === "confirming" ? "Confirming with the generator" : waitingService ? "Waiting for the generation service" : `Preparing your ${noun}`,
      detail: waitingService
        ? "The generation service is not taking new jobs right now. Your job waits in line; credits stay reserved and nothing is charged."
        : stage === "confirming"
          ? "We are checking that the generator received the request. It is never sent twice."
          : since > 120_000
            ? "Still waiting to start. Nothing is charged until your file is saved."
            : null,
      delayed: since > 120_000, elapsedMs,
    };
  } else if (stage === "generating") {
    const start = t(job.acceptedAt) || t(job.submittedAt) || t(job.createdAt);
    const since = Math.max(0, now - start);
    const expected = Math.max(15, Number(job.timing?.generateSeconds ?? (video ? 150 : 45))) * 1000;
    const provider = Number(job.providerProgress?.value);
    const delayed = job.state === "processing_delayed" || since > expected * 2.2;
    let pct: number;
    let kind: Progress["kind"] = "estimate";
    if (Number.isFinite(provider) && provider > 0 && provider <= 100) {
      pct = PREP_END + (GEN_END - PREP_END) * (provider / 100);
      kind = "provider";
    } else {
      // Most of the bar within the typical time, then an ever slower approach that stays below the saving stage.
      const g = 1 - Math.exp((-1.6 * since) / expected);
      pct = PREP_END + (GEN_END - 2 - PREP_END) * g;
    }
    out = {
      stage, percent: clamp(pct, PREP_END, GEN_END - 1), kind,
      caption: delayed ? "Taking longer than usual" : `Creating your ${noun}`,
      detail: delayed ? "The generator is slower than usual. Your job keeps running even if you close this page; nothing is charged until the file is saved." : null,
      delayed, elapsedMs,
    };
  } else {
    const since = Math.max(0, now - (t(job.generatedAt) || now));
    const expected = Math.max(4, Number(job.timing?.saveSeconds ?? (video ? 20 : 8))) * 1000;
    const pct = GEN_END + (SAVE_END - GEN_END) * (1 - Math.exp(-since / expected));
    const delayed = since > Math.max(90_000, expected * 6);
    out = {
      stage, percent: clamp(pct, GEN_END, SAVE_END), kind: "estimate",
      caption: delayed ? "Still saving your result" : "Saving your result",
      detail: delayed ? "Saving is taking longer than usual. The finished file is kept and saved again automatically; it is never generated twice." : null,
      delayed, elapsedMs,
    };
  }

  // Never move backwards within the same run, and never show 100 before "ready".
  if (previous && previous.percent !== null && out.percent !== null && out.stage !== "ready") {
    out.percent = Math.min(Math.max(out.percent, previous.percent), out.stage === "saving" ? SAVE_END : GEN_END - 1);
  }
  return out;
}

/** Whole percent for display; a running job shows at least 1 % and at most 99 %. */
export function displayPercent(p: Progress): number | null {
  if (p.percent === null) return null;
  if (p.stage === "ready") return Math.round(p.percent);
  return clamp(Math.floor(p.percent), 1, 99);
}

/** "1:05" style elapsed time. */
export function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
