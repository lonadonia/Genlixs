"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ChevronDown, Clock3, Download, ImageIcon, Info, RotateCcw, Sparkles, Video } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { displayPercent, estimateProgress, fmtElapsed, type Progress, type Stage } from "@/lib/live/progress";
import { units, type Job, type JobOutput } from "@/lib/live/types";
import { cn, fmtCredits } from "@/lib/format";
import { GenlixsEmblem } from "./emblem";
import { signedUrl, useSignedUrl } from "./signed-media";

/** A follow-up action on a delivered file, e.g. "Use as start frame" or "Edit this video". */
export type UseAction = { id: string; label: string; applies: (job: Job, output: JobOutput) => boolean; run: (job: Job, output: JobOutput) => void };

const TONE: Record<Stage, Tone> = {
  preparing: "info",
  confirming: "attention",
  generating: "info",
  saving: "info",
  ready: "success",
  failed: "error",
  cancelled: "neutral",
  review: "attention",
};
const LABEL: Record<Stage, string> = {
  preparing: "Preparing",
  confirming: "Confirming",
  generating: "Generating",
  saving: "Saving",
  ready: "Ready",
  failed: "Not completed",
  cancelled: "Cancelled",
  review: "In review",
};

const RATIO: Record<string, [number, number]> = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:3": [4, 3], "3:4": [3, 4], "21:9": [21, 9], "3:2": [3, 2], "2:3": [2, 3], "4:5": [4, 5], "5:4": [5, 4] };

/** Frame shape for the preview well: the saved file's size when known, else the requested aspect ratio. */
export function frameRatio(job: Pick<Job, "options" | "outputs" | "outputKind" | "tool">): [number, number] {
  const out = job.outputs?.[0];
  if (out?.width && out?.height) return [out.width, out.height];
  const r = RATIO[String(job.options?.aspect_ratio ?? "")];
  if (r) return r;
  return (job.outputKind ?? (job.tool === "video" ? "video" : "image")) === "video" ? [16, 9] : [1, 1];
}

// One shared one-second clock for every running card: local animation between server updates, no extra requests.
let clockNow = 0;
let clockTimer: number | undefined;
const clockListeners = new Set<() => void>();
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (clockTimer === undefined) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(cb);
    if (!clockListeners.size && clockTimer !== undefined) {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
const noSubscribe = () => () => {};
function useSecond(active: boolean) {
  return useSyncExternalStore(active ? subscribeClock : noSubscribe, () => (active ? clockNow : 0), () => 0);
}

/** Settings worth showing next to the model name, in the customer's words. */
export function optionSummary(job: Pick<Job, "options">) {
  const o = job.options ?? {};
  const parts: string[] = [];
  if (o.duration !== undefined) parts.push(`${o.duration} s`);
  if (o.seconds !== undefined) parts.push(`${o.seconds} s`);
  if (o.aspect_ratio && o.aspect_ratio !== "adaptive") parts.push(String(o.aspect_ratio));
  const res = o.resolution ?? o.mode;
  if (res) parts.push(String(res).replace(/^4k$/i, "4K"));
  return parts.join(" · ");
}

/**
 * The generation preview card shared by image and video work: a frame of the requested shape with the white Genlixs
 * emblem, a stage caption, a slim progress bar with a percentage (labelled as an estimate unless the generator
 * reported it), then the saved file with its actions. Server state decides every stage; the bar animates locally
 * between updates and never shows 100 % before the file is saved.
 */
export function GenerationPreviewCard({
  job,
  connection = "live",
  onChanged,
  uses = [],
  className,
}: {
  job: Job;
  connection?: "loading" | "live" | "reconnecting" | "gone";
  onChanged?: () => void;
  uses?: UseAction[];
  className?: string;
}) {
  const running = !["succeeded", "failed", "cancelled"].includes(job.state);
  const now = useSecond(running);
  const progress = useMonotonicProgress(job, now);
  const pct = displayPercent(progress);
  const [w, h] = frameRatio(job);
  const video = (job.outputKind ?? (job.tool === "video" ? "video" : "image")) === "video";
  // Some models deliver several files per job (Grok Imagine: two images); one is shown large, the others as thumbnails.
  const [shown, setShown] = useState(0);
  const outputs = job.outputs ?? [];
  const output = outputs[Math.min(shown, Math.max(0, outputs.length - 1))] ?? null;
  const ready = progress.stage === "ready" && output !== null;
  const cost = units(job.units);
  const testRun = job.purpose === "staff_test";
  const reference = firstImageInput(job);

  return (
    <article aria-label={`${video ? "Video" : "Image"} ${job.ref}`} className={cn("overflow-hidden rounded-[24px] border border-white/[0.08] bg-surface", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink" title={job.prompt}>
            {job.title || (video ? "Untitled video" : "Untitled image")}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {job.modelName}
            {optionSummary(job) ? ` · ${optionSummary(job)}` : ""} · {job.ref}
            {testRun ? " · private test" : ""}
          </p>
        </div>
        <Badge tone={TONE[progress.stage]} icon={running && progress.stage !== "review" && progress.stage !== "confirming" ? "busy" : undefined}>
          {LABEL[progress.stage]}
        </Badge>
      </header>

      <div className="p-3 sm:p-4">
        <div
          className="relative mx-auto overflow-hidden rounded-[18px] bg-canvas ring-1 ring-white/[0.06]"
          style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, calc(min(64vh, 680px) * ${w / h}))` }}
        >
          {ready ? (
            <DeliveredMedia key={output.assetId} output={output} alt={job.title} video={video} />
          ) : (
            <Stagewell progress={progress} pct={pct} video={video} job={job} reference={reference} now={now} />
          )}
        </div>
        {ready && outputs.length > 1 ? (
          <div role="group" aria-label={`${outputs.length} results`} className="mt-2.5 flex flex-wrap justify-center gap-2">
            {outputs.map((o, i) => (
              <OutputThumb key={o.assetId} output={o} index={i} selected={o.assetId === output.assetId} onSelect={() => setShown(i)} />
            ))}
          </div>
        ) : null}
      </div>

      <footer className="space-y-3 px-4 pb-4 sm:px-5">
        <p className="sr-only" aria-live="polite">
          {progress.stage === "ready" ? `${video ? "Video" : "Image"} ready.` : progress.caption}
        </p>
        <CreditLine job={job} cost={cost} testRun={testRun} />
        {connection === "reconnecting" ? (
          <p className="flex items-center gap-2 text-xs text-orange-on-dark">
            <RotateCcw aria-hidden className="size-3.5" /> Reconnecting… your job keeps running on our servers.
          </p>
        ) : null}
        {progress.stage === "failed" || progress.stage === "cancelled" ? <FailureNote job={job} /> : null}
        {progress.detail && running ? (
          <p className="flex gap-2 text-sm text-muted">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> {progress.detail}
          </p>
        ) : null}
        <Actions job={job} output={ready ? output : null} uses={uses} onChanged={onChanged} />
        <Details job={job} />
      </footer>
    </article>
  );
}

/**
 * Progress for one job that never moves backwards while it runs (a late, lower provider reading or a refreshed
 * timing sample does not pull the bar back). The highest value shown is kept in state and adjusted during render,
 * React's pattern for values derived from earlier renders.
 */
function useMonotonicProgress(job: Job, now: number): Progress {
  const [peak, setPeak] = useState<{ id: string; stage: Stage; percent: number } | null>(null);
  const before = peak && peak.id === job.id ? peak : null;
  const progress = useMemo(() => estimateProgress(job, now || Date.parse(job.createdAt), before), [job, now, before]);
  if (progress.percent !== null && progress.stage !== "ready" && (!before || progress.percent > before.percent || progress.stage !== before.stage)) {
    setPeak({ id: job.id, stage: progress.stage, percent: progress.percent });
  }
  return progress;
}

function firstImageInput(job: Job): string | null {
  for (const slot of ["first_frame", "character_image", "reference_images"]) {
    const it = job.inputs?.[slot]?.find((x) => x.kind === "image");
    if (it) return it.id;
  }
  return null;
}

function Stagewell({ progress, pct, video, job, reference, now }: { progress: Progress; pct: number | null; video: boolean; job: Job; reference: string | null; now: number }) {
  const { url: refUrl } = useSignedUrl(reference);
  const failed = progress.stage === "failed" || progress.stage === "cancelled";
  // `now` comes from the shared one-second clock (0 until it starts); elapsed time is hidden until then.
  const elapsed = now ? fmtElapsed(Math.max(0, now - Date.parse(job.createdAt))) : null;
  const typical = job.timing?.generateSeconds ? Math.round((job.timing.generateSeconds + (job.timing.saveSeconds ?? 0)) / 60) : null;
  return (
    <div className="absolute inset-0">
      {/* Atmosphere only: a heavily blurred input (never shown as output) or a quiet gradient. */}
      {refUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL
        <img src={refUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-[36px] saturate-150" />
      ) : null}
      <div
        aria-hidden
        className={cn("absolute inset-0", !failed && "gx-shimmer overflow-hidden")}
        style={{ background: "radial-gradient(120% 90% at 50% 40%, rgb(37 63 246 / 0.16) 0%, rgb(21 25 25 / 0.55) 55%, rgb(15 18 18 / 0.9) 100%)" }}
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {failed ? (
          <>
            <span className="grid size-12 place-items-center rounded-full bg-[rgb(239_68_68/0.14)]">
              <AlertTriangle aria-hidden className="size-6 text-error-on-dark" />
            </span>
            <p className="max-w-sm text-sm font-semibold text-ink">
              {progress.stage === "cancelled" ? "Cancelled before it started" : `This ${video ? "video" : "image"} could not be created`}
            </p>
          </>
        ) : (
          <>
            <GenlixsEmblem size={progress.stage === "review" ? 48 : 64} animated={progress.stage !== "review"} />
            <p className="text-sm font-semibold text-ink sm:text-base">{progress.caption}</p>
            {elapsed ? (
              <p className="flex items-center gap-1.5 text-xs text-muted tabular">
                <Clock3 aria-hidden className="size-3.5" /> {elapsed}
                {typical && progress.stage !== "review" && !progress.delayed ? <span>· usually about {Math.max(1, typical)} min</span> : null}
              </p>
            ) : null}
          </>
        )}
      </div>
      {pct !== null && !failed ? (
        <div className="absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-4 sm:pb-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[11px] font-medium text-muted">
            <span>{progress.kind === "provider" ? "Progress from the generator" : "Estimated progress"}</span>
            <span className="text-sm font-semibold text-ink tabular">{pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={progress.kind === "provider" ? "Generation progress" : "Estimated generation progress"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${progress.kind === "provider" ? "" : "About "}${pct}%, ${progress.caption}`}
            className="h-1 overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-blue to-brand-blue-bright shadow-[0_0_12px_rgb(81_101_248/0.7)] transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One of several files of a job, as a small selectable thumbnail. */
function OutputThumb({ output, index, selected, onSelect }: { output: JobOutput; index: number; selected: boolean; onSelect: () => void }) {
  const { url } = useSignedUrl(output.assetId);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Result ${index + 1}`}
      onClick={onSelect}
      className={cn("relative size-14 overflow-hidden rounded-lg bg-canvas ring-1 ring-white/[0.1]", selected && "ring-2 ring-brand-blue-bright")}
    >
      {url && output.mime.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link to a private file
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-xs font-semibold text-muted">{index + 1}</span>
      )}
    </button>
  );
}

function DeliveredMedia({ output, alt, video }: { output: JobOutput; alt: string; video: boolean }) {
  const { url, error, renew } = useSignedUrl(output.assetId);
  const [loaded, setLoaded] = useState(false);
  const retried = useRef(false);
  const onError = () => {
    // Usually an expired link: fetch a fresh one once; it is not a failed generation.
    if (!retried.current) {
      retried.current = true;
      renew();
    }
  };
  if (error) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
        <span>
          The preview could not load. <button type="button" onClick={renew} className="font-semibold text-link underline">Try again</button>
        </span>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 bg-black">
      {!loaded ? (
        <div className="absolute inset-0 grid place-items-center">
          <GenlixsEmblem size={44} />
        </div>
      ) : null}
      {url ? (
        video ? (
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            onLoadedData={() => setLoaded(true)}
            onError={onError}
            className={cn("absolute inset-0 size-full object-contain transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
            aria-label={alt}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL; not optimizable
          <img
            src={url}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={onError}
            className={cn("absolute inset-0 size-full object-contain transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
          />
        )
      ) : null}
    </div>
  );
}

function CreditLine({ job, cost, testRun }: { job: Job; cost: number; testRun: boolean }) {
  if (testRun) return <p className="text-sm text-muted">Private test: no customer credits are reserved or charged; the KIE account pays for it.</p>;
  const text =
    job.settlementState === "captured"
      ? `${fmtCredits(cost)} charged for the saved file.`
      : job.settlementState === "released"
        ? `${fmtCredits(cost)} returned to your balance.`
        : `${fmtCredits(cost)} reserved — charged only when the file is saved.`;
  return <p className="text-sm text-muted">{text}</p>;
}

function FailureNote({ job }: { job: Job }) {
  if (!job.failureMessage) return null;
  return (
    <p role="alert" className="rounded-xl border border-[rgb(239_68_68/0.35)] bg-[rgb(239_68_68/0.08)] px-3 py-2 text-sm text-error-on-dark">
      {job.failureMessage}
    </p>
  );
}

function Actions({ job, output, uses, onChanged }: { job: Job; output: JobOutput | null; uses: UseAction[]; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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
  const download = async () => {
    if (!output) return;
    setDownloading(true);
    setError(null);
    try {
      const d = await api<{ url: string }>(`/api/assets/${output.assetId}/download`, { method: "POST", body: {} });
      window.location.assign(d.url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  };
  const applicable = output ? uses.filter((u) => u.applies(job, output)) : [];
  if (!output && job.state !== "queued") return error ? <p className="text-sm text-error-on-dark">{error}</p> : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {output ? (
        <>
          <Button size="sm" variant="secondary" busy={downloading} onClick={download} icon={<Download aria-hidden className="size-4" />}>
            Download
          </Button>
          {job.purpose !== "staff_test" ? (
            <Link href={`/studio/library?job=${job.id}`} className="inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold text-ink hover:bg-white/[0.07]">
              Open in library
            </Link>
          ) : null}
          {applicable.map((u) => (
            <Button key={u.id} size="sm" variant="ghost" onClick={() => u.run(job, output)} icon={<Sparkles aria-hidden className="size-4" />}>
              {u.label}
            </Button>
          ))}
        </>
      ) : (
        <Button variant="secondary" size="sm" busy={busy} onClick={cancel}>
          Cancel and return credits
        </Button>
      )}
      {error ? <p className="w-full text-sm text-error-on-dark">{error}</p> : null}
    </div>
  );
}

function Details({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  if (!job.events?.length) return null;
  return (
    <div className="border-t border-white/[0.06] pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-muted hover:text-ink"
      >
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} /> Details
      </button>
      {open ? (
        <ol className="mt-1 space-y-1 pb-1 text-sm">
          {job.events.slice(-8).map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3">
              <time dateTime={e.at} className="w-14 shrink-0 text-xs text-subtle tabular">
                {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
              <span className="text-muted">{e.message}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Compact history tile in the same visual language as the card: emblem while running, the file once saved. */
export function HistoryTile({ job, selected, onSelect }: { job: Job; selected: boolean; onSelect: () => void }) {
  const running = !["succeeded", "failed", "cancelled"].includes(job.state);
  const now = useSecond(running);
  const progress = estimateProgress(job, now || Date.parse(job.createdAt));
  const pct = displayPercent(progress);
  const video = (job.outputKind ?? (job.tool === "video" ? "video" : "image")) === "video";
  const output = job.outputs?.[0] ?? null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={`${job.title || "Untitled"} — ${LABEL[progress.stage]}`}
      className={cn(
        "group block w-40 shrink-0 overflow-hidden rounded-2xl border bg-surface text-left sm:w-44",
        selected ? "border-brand-blue-bright" : "border-white/[0.08] hover:border-white/25",
      )}
    >
      <span className="relative block aspect-video bg-canvas">
        {output && progress.stage === "ready" ? <TileMedia output={output} video={video} /> : null}
        {running ? (
          <span className="absolute inset-0 grid place-items-center">
            <GenlixsEmblem size={28} animated={false} />
          </span>
        ) : null}
        {!output && !running ? (
          <span className="absolute inset-0 grid place-items-center text-subtle">
            {progress.stage === "failed" || progress.stage === "cancelled" ? <AlertTriangle aria-hidden className="size-5" /> : video ? <Video aria-hidden className="size-5" /> : <ImageIcon aria-hidden className="size-5" />}
          </span>
        ) : null}
        {running && pct !== null ? (
          <span className="absolute inset-x-2 bottom-2 h-0.5 overflow-hidden rounded-full bg-white/10">
            <span className="block h-full bg-brand-blue-bright transition-[width] duration-1000" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
      </span>
      <span className="block px-2.5 py-2 text-xs">
        <span className="block truncate font-semibold text-ink">{job.title || "Untitled"}</span>
        <span className="block truncate text-muted">
          {LABEL[progress.stage]}
          {running && pct !== null ? ` · ${pct}%` : ""}
        </span>
      </span>
    </button>
  );
}

function TileMedia({ output, video }: { output: JobOutput; video: boolean }) {
  const { url, renew } = useSignedUrl(output.assetId);
  if (!url) return null;
  return video ? (
    <video src={`${url}#t=0.1`} muted playsInline preload="metadata" onError={renew} className="absolute inset-0 size-full object-cover" aria-hidden />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL
    <img src={url} alt="" onError={renew} className="absolute inset-0 size-full object-cover" />
  );
}

/** Prefetches signed links for the outputs of the given jobs (keeps thumbnails from popping in one by one). */
export function prefetchOutputs(jobs: Job[]) {
  for (const j of jobs) for (const o of j.outputs ?? []) void signedUrl(o.assetId).catch(() => null);
}
