"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Coins, FlaskConical, Info, RefreshCw, X } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { MediaFrame } from "@/components/ui/media-frame";
import { Badge } from "@/components/ui/badge";
import {
  EXAMPLES,
  QUOTE_TTL_MS,
  TOOLS,
  defaultSettings,
  demoQuote,
  modelById,
  modelsFor,
  reconcileSettings,
  type Settings,
  type ToolId,
} from "@/lib/catalog";
import {
  SEED_TIME,
  issueQuote,
  isTerminal,
  jobPhase,
  saveDraft,
  submitJob,
  useDemo,
  useNow,
  type Job,
  type JobOutcome,
} from "@/lib/demo-store";
import { cn, fmtCountdown, fmtCredits, fmtNum } from "@/lib/format";
import type { MediaKey } from "@/lib/media";
import { ModelPicker, RatioChips, Segmented, Toggle } from "./controls";
import { JobStatus } from "./job-status";
import { ReferenceUploader, type Reference } from "./reference-uploader";
import { ResultActions, ResultDetails, ResultMedia, outputRatioClass } from "./result-view";

const LIMIT = 1000;

/** Preview only: pick the concept image closest to the prompt so reviewers see a plausible result. */
const pickMedia = (tool: ToolId, s: Settings, prompt: string): MediaKey => {
  if (tool === "video") return "auroraClip";
  if (tool === "edit") return "dunesDusk";
  const p = prompt.toLowerCase();
  if (/sphere|ball|abstract|still life/.test(p)) return "spheres";
  if (/bottle|product|pedestal|packshot/.test(p)) return "product";
  if (/aurora|night|northern/.test(p)) return "auroraVertical";
  if (/noon|midday|blue sky/.test(p)) return "dunesNoon";
  if (/dune|desert|dusk|sunset/.test(p)) return "dunesDusk";
  if (s.ratio === "9:16" || s.ratio === "2:3") return "auroraVertical";
  if (s.ratio === "1:1" || s.ratio === "4:5") return "product";
  if (s.ratio === "16:9") return "spheres";
  return "dunesDusk";
};

const titleFrom = (prompt: string) => {
  const t = prompt.trim().split(/[,.;\n]/)[0].trim();
  return t.length > 48 ? `${t.slice(0, 46)}…` : t || "Untitled";
};

type Pane = "input" | "status" | "result";

export function Workspace({ tool }: { tool: ToolId }) {
  const demo = useDemo();
  const now = useNow();
  const t = TOOLS[tool];
  const models = modelsFor(tool);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const paneId = useId();

  const draft = demo.draft && demo.draft.tool === tool ? demo.draft : null;
  const prompt = draft?.prompt ?? "";
  const settings = draft?.settings ?? defaultSettings(tool);
  const model = modelById(settings.modelId) ?? models[0];
  const restored = draft && draft.source !== "studio" && draft.prompt ? draft.source : null;

  const [reference, setReference] = useState<Reference>({ status: "empty" });
  const [errors, setErrors] = useState<{ prompt?: string; reference?: string }>({});
  const [outcome, setOutcome] = useState<JobOutcome>("success");
  const [viewJobId, setViewJobId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("input");

  // Sample reference chosen earlier survives navigation via the draft.
  const effectiveRef: Reference =
    reference.status === "empty" && tool === "edit" && draft?.referenceSample
      ? { status: "accepted", name: "dunes-midday.jpg", type: "JPEG", size: 177_509, url: "/media/concept/dunes-noon.jpg", sample: true }
      : reference;

  const write = (patch: { prompt?: string; settings?: Settings; referenceSample?: boolean }) =>
    saveDraft({
      tool,
      prompt: patch.prompt ?? prompt,
      settings: patch.settings ?? settings,
      source: "studio",
      referenceSample: patch.referenceSample ?? draft?.referenceSample,
    });

  /* ---- quote: refresh whenever a cost-changing setting changes ---- */
  const credits = demoQuote(settings);
  const quoteKey = JSON.stringify(settings);
  const quote = demo.quotes[tool];
  const quoteStale = !quote || quote.key !== quoteKey;
  useEffect(() => {
    if (!demo.hydrated) return;
    const q = demo.quotes[tool];
    if (!q || q.key !== quoteKey) issueQuote(tool, quoteKey, demoQuote(JSON.parse(quoteKey)));
  }, [demo.hydrated, demo.quotes, quoteKey, tool]);
  const quoteLoading = quoteStale || (now > 0 && now < (quote?.readyAt ?? 0));
  const quoteLeft = quote && now ? quote.issuedAt + QUOTE_TTL_MS - now : QUOTE_TTL_MS;
  const quoteExpired = !quoteLoading && quoteLeft <= 0;
  const insufficient = !quoteLoading && credits > demo.available;

  /* ---- job shown in the canvas ---- */
  const sessionJobs = demo.jobs.filter((j) => j.tool === tool && j.createdAt > SEED_TIME && !j.removed);
  const job: Job | undefined = (viewJobId && demo.jobs.find((j) => j.id === viewJobId)) || sessionJobs[0];
  const phase = job ? jobPhase(job, now) : null;
  const running = Boolean(job && phase && !isTerminal(phase));
  const example = EXAMPLES.find((e) => e.tool === tool)!;

  const generate = () => {
    const next: typeof errors = {};
    if (prompt.trim().length < 3) next.prompt = `${t.promptLabel} in a few words before generating.`;
    if (tool === "edit" && effectiveRef.status !== "accepted") next.reference = "Add a reference image to edit.";
    setErrors(next);
    if (next.reference) return;
    if (next.prompt) {
      promptRef.current?.focus();
      return;
    }
    const created = submitJob({
      tool,
      title: titleFrom(prompt),
      prompt: prompt.trim(),
      settings,
      credits,
      outcome,
      media: pickMedia(tool, settings, prompt),
      referenceMedia: tool === "edit" ? "dunesNoon" : undefined,
    });
    if (created) {
      setViewJobId((created as Job).id);
      setPane("status");
    }
  };

  const reuse = (j: Job) => {
    saveDraft({ tool: j.tool, prompt: j.prompt, settings: { ...j.settings }, source: "studio", referenceSample: j.tool === "edit" ? true : undefined });
    setPane("input");
    promptRef.current?.focus();
  };

  const uploadedRefUrl = effectiveRef.status === "accepted" && !effectiveRef.sample ? effectiveRef.url : null;

  /* ------------------------------------------------------------- input */
  const inputPanel = (
    <div className="flex h-full flex-col">
      <div className="space-y-6 p-4 sm:p-5">
        {restored ? (
          <div role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[rgb(28_93_255/0.4)] bg-[rgb(28_93_255/0.1)] p-3 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-link" />
            <p className="flex-1 text-ink">
              Draft restored from the {restored === "example" ? "example you picked" : "homepage"}. Nothing has been generated yet.
            </p>
            <button type="button" onClick={() => write({})} className="-m-1 grid size-8 place-items-center rounded-[8px] text-muted hover:text-ink">
              <X aria-hidden className="size-4" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ) : null}

        {tool === "edit" ? (
          <ReferenceUploader
            value={effectiveRef}
            invalid={errors.reference}
            onChange={(r) => {
              setReference(r);
              if (r.status === "accepted" || r.status === "empty") setErrors((e) => ({ ...e, reference: undefined }));
              if (r.status === "accepted" && r.sample) write({ referenceSample: true });
              if (r.status !== "accepted" || !r.sample) if (draft?.referenceSample) write({ referenceSample: false });
            }}
          />
        ) : null}

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label htmlFor="studio-prompt" className="text-sm font-semibold text-ink">
              {t.promptLabel}
            </label>
            <span id="studio-prompt-count" className="text-xs text-muted tabular">
              {prompt.length}/{LIMIT}
            </span>
          </div>
          <textarea
            ref={promptRef}
            id="studio-prompt"
            value={prompt}
            maxLength={LIMIT}
            rows={5}
            onChange={(e) => {
              write({ prompt: e.target.value });
              if (errors.prompt && e.target.value.trim().length >= 3) setErrors((x) => ({ ...x, prompt: undefined }));
            }}
            placeholder={t.promptPlaceholder}
            aria-invalid={Boolean(errors.prompt)}
            aria-describedby={cn("studio-prompt-count", errors.prompt && "studio-prompt-error") || undefined}
            className="block min-h-[120px] w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-raised px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-[#8794ab] aria-invalid:border-error-on-dark"
          />
          {errors.prompt ? (
            <p id="studio-prompt-error" className="mt-1.5 text-sm text-error-on-dark">
              {errors.prompt}
            </p>
          ) : null}
          {!prompt ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Starter prompts">
              {t.starters.map((s) => (
                <button key={s} type="button" onClick={() => write({ prompt: s })} className="rounded-full border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <ModelPicker models={models} value={model.id} onChange={(m) => write({ settings: reconcileSettings(settings, m) })} />

        {model.ratios.length > 1 ? <RatioChips value={settings.ratio} options={model.ratios} onChange={(r) => write({ settings: { ...settings, ratio: r } })} /> : null}
        {model.ratios.length === 1 && model.ratios[0] === "Original" ? <p className="text-sm text-muted">Output keeps the reference image&apos;s aspect ratio.</p> : null}

        <div className="flex flex-wrap gap-x-6 gap-y-5">
          {model.qualities ? <Segmented legend="Quality" value={settings.quality ?? model.qualities[0]} options={model.qualities} onChange={(q) => write({ settings: { ...settings, quality: q } })} /> : null}
          {model.durations ? (
            <Segmented legend="Length" value={settings.duration ?? model.durations[0]} options={model.durations} format={(d) => `${d}s`} onChange={(d) => write({ settings: { ...settings, duration: d } })} />
          ) : null}
          {model.resolutions && model.resolutions.length > 1 ? (
            <Segmented legend="Resolution" value={settings.resolution ?? model.resolutions[0]} options={model.resolutions} onChange={(r) => write({ settings: { ...settings, resolution: r } })} />
          ) : null}
        </div>
        {model.audio ? (
          <Toggle label="Ambient audio" description="Adds 12 credits. Audio never plays automatically." checked={Boolean(settings.audio)} onChange={(v) => write({ settings: { ...settings, audio: v } })} />
        ) : null}

        <details className="group rounded-[var(--radius-control)] border border-dashed border-line-strong">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-semibold text-muted">
            <FlaskConical aria-hidden className="size-4" /> Prototype: next job outcome
          </summary>
          <fieldset className="grid gap-1.5 px-3 pb-3">
            <legend className="sr-only">Simulated outcome for the next job</legend>
            {(
              [
                ["success", "Completes normally"],
                ["delayed", "Takes longer than usual"],
                ["failed", "Fails (credits returned)"],
                ["unknown", "Submission needs confirming"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="radio" name={`${paneId}-outcome`} checked={outcome === v} onChange={() => setOutcome(v)} className="size-4 accent-[#1c5dff]" />
                {l}
              </label>
            ))}
          </fieldset>
        </details>
      </div>

      {/* Price + action: adjacent, sticky at the bottom of the settings column */}
      <div className="gen-bar sticky bottom-0 mt-auto border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-[10px] bg-raised px-3 py-2">
            <p className="text-xs text-muted">Cost</p>
            <p className="font-semibold text-ink tabular" aria-live="polite">
              {quoteLoading ? <span className="text-muted">Updating quote…</span> : fmtCredits(credits)}
            </p>
          </div>
          <div className="rounded-[10px] bg-raised px-3 py-2">
            <p className="text-xs text-muted">Available</p>
            <p className="font-semibold text-ink tabular">
              {fmtNum(demo.available)}
              {demo.reserved ? <span className="ml-1 text-xs font-normal text-muted">· {fmtNum(demo.reserved)} reserved</span> : null}
            </p>
          </div>
        </div>

        {quoteExpired ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-[rgb(254_85_17/0.35)] bg-[rgb(254_85_17/0.08)] px-3 py-2 text-sm">
            <span className="text-orange-on-dark">Quote expired. Prices may have changed.</span>
            <Button size="sm" variant="secondary" onClick={() => issueQuote(tool, quoteKey, credits)} icon={<RefreshCw aria-hidden className="size-3.5" />}>
              Refresh
            </Button>
          </div>
        ) : insufficient ? (
          <div className="mb-3 rounded-[10px] border border-[rgb(254_85_17/0.35)] bg-[rgb(254_85_17/0.08)] px-3 py-2 text-sm">
            <p className="text-orange-on-dark">You need {fmtCredits(credits - demo.available)} more for this job.</p>
            <Link href={`/studio/credits?return=${encodeURIComponent(t.href)}`} className="mt-1 inline-flex items-center gap-1 font-semibold text-link hover:underline">
              <Coins aria-hidden className="size-4" /> Top up — your draft stays here
            </Link>
          </div>
        ) : null}

        <Button
          size="lg"
          className="w-full"
          onClick={generate}
          disabled={quoteLoading || quoteExpired || insufficient}
          aria-describedby="gen-note"
        >
          {quoteLoading ? "Updating quote…" : `Generate for ${fmtCredits(credits)}`}
        </Button>
        <p id="gen-note" className="mt-2 text-center text-xs text-muted">
          {quoteExpired
            ? "Refresh the quote to continue."
            : insufficient
              ? "Generate is unavailable until you have enough credits."
              : quoteLoading
                ? "Cost changes with model and settings."
                : `Credits are reserved now and charged only when the file is saved. Quote valid ${fmtCountdown(Math.min(quoteLeft, QUOTE_TTL_MS))}.`}
        </p>
      </div>
    </div>
  );

  /* ------------------------------------------------------------- canvas */
  const statusPanel = job ? (
    <JobStatus job={job} now={now} onRetry={() => reuse(job)} />
  ) : (
    <div className="rounded-[var(--radius-media)] border border-dashed border-line-strong p-6 text-center text-sm text-muted">No job yet. Your job status appears here after you press Generate.</div>
  );

  const resultPanel =
    job && phase === "ready" ? (
      <div className="space-y-4">
        <ResultMedia job={job} uploadedRef={uploadedRefUrl} />
        {tool === "edit" && uploadedRefUrl ? (
          <p className="text-xs text-muted">Preview note: the edited version shown is concept media — your file was not uploaded or processed.</p>
        ) : null}
        <ResultActions job={job} onReuse={() => reuse(job)} />
        <ResultDetails job={job} />
      </div>
    ) : job && running ? (
      <div className={cn("grid place-items-center rounded-[var(--radius-media)] border border-line bg-surface", outputRatioClass(job), "max-h-[60vh] w-full")}>
        <div className="p-6 text-center">
          <span aria-hidden className="mx-auto block size-10 animate-pulse-soft rounded-full bg-[rgb(28_93_255/0.25)]" />
          <p className="mt-3 text-sm font-semibold text-ink">Space reserved for your {tool === "video" ? "clip" : "image"}</p>
          <p className="text-xs text-muted">{settingsSummaryShort(job.settings)}</p>
        </div>
      </div>
    ) : (
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Badge tone="neutral" icon="none">
            Example — not your output
          </Badge>
          <button
            type="button"
            onClick={() => saveDraft({ tool, prompt: example.prompt, settings: { ...example.settings }, source: "studio", referenceSample: tool === "edit" ? true : undefined })}
            className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
          >
            Start from this example <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
        <MediaFrame media={example.media} ratio={example.settings.ratio === "Original" ? "3:2" : example.settings.ratio === "16:9" ? "16:9" : "3:2"} sizes="(min-width: 1024px) 55vw, 100vw" />
        <p className="mt-3 text-sm text-muted">“{example.prompt}”</p>
      </div>
    );

  const history = sessionJobs.slice(0, 6);

  return (
    <div className="lg:flex lg:min-h-[calc(100dvh-64px)]">
      {/* Mobile/tablet: Input / Status / Result */}
      <div role="tablist" aria-label="Studio sections" className="sticky top-16 z-20 flex gap-1 border-b border-line bg-canvas px-4 py-2 lg:hidden">
        {(["input", "status", "result"] as Pane[]).map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            id={`${paneId}-tab-${p}`}
            aria-selected={pane === p}
            aria-controls={`${paneId}-pane-${p}`}
            onClick={() => setPane(p)}
            className={cn("h-10 flex-1 rounded-[var(--radius-control)] text-sm font-semibold capitalize", pane === p ? "bg-raised text-ink" : "text-muted")}
          >
            {p}
            {p === "status" && running ? <span className="ml-1.5 inline-block size-2 rounded-full bg-brand-blue align-middle" aria-hidden /> : null}
            {p === "result" && phase === "ready" ? <span className="ml-1.5 inline-block size-2 rounded-full bg-brand-lime align-middle" aria-hidden /> : null}
          </button>
        ))}
      </div>

      <section
        id={`${paneId}-pane-input`}
        aria-label="Prompt and settings"
        className={cn("border-line bg-surface lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-64px)] lg:w-[360px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:border-r scroll-thin", pane !== "input" && "hidden lg:flex")}
      >
        <div className="hidden border-b border-line px-5 py-3 lg:block">
          <h2 className="text-sm font-semibold text-ink">Prompt and settings</h2>
          <p className="text-xs text-muted">{t.summary}</p>
        </div>
        {inputPanel}
      </section>

      <div className="min-w-0 flex-1 p-4 sm:p-6">
        <h1 className="sr-only">{t.studioTitle}</h1>
        <section id={`${paneId}-pane-status`} aria-label="Job status" className={cn("mb-5", pane !== "status" && "hidden lg:block", !job && "lg:hidden")}>
          {statusPanel}
        </section>
        <section id={`${paneId}-pane-result`} aria-label="Result" className={cn(pane !== "result" && "hidden lg:block")}>
          {resultPanel}
        </section>
        {pane === "status" && job && phase === "ready" ? (
          <div className="mt-4 lg:hidden">
            <Button variant="secondary" onClick={() => setPane("result")} className="w-full">
              View result
            </Button>
          </div>
        ) : null}

        {history.length > 1 ? (
          <section aria-labelledby="hist-h" className="mt-8 border-t border-line pt-6">
            <div className="flex items-center justify-between">
              <h2 id="hist-h" className="text-sm font-semibold text-ink">
                This session
              </h2>
              <ButtonLink href="/studio/library" variant="ghost" size="sm">
                Open library
              </ButtonLink>
            </div>
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 scroll-thin">
              {history.map((h) => {
                const p = jobPhase(h, now);
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setViewJobId(h.id);
                        setPane(isTerminal(p) ? "result" : "status");
                      }}
                      aria-current={job?.id === h.id ? "true" : undefined}
                      className={cn("w-40 rounded-[12px] border p-2 text-left text-xs", job?.id === h.id ? "border-brand-blue" : "border-line hover:border-line-strong")}
                    >
                      <span className="block truncate font-semibold text-ink">{h.title}</span>
                      <span className="text-muted">
                        {h.id} · {p === "ready" ? "Ready" : p === "failed" ? "Failed" : p === "cancelled" ? "Cancelled" : "Running"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function settingsSummaryShort(s: Settings) {
  return [s.ratio !== "Original" ? s.ratio : "Original ratio", s.quality, s.duration ? `${s.duration}s` : null, s.resolution].filter(Boolean).join(" · ");
}
