"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, Info, RefreshCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RatioChips, Segmented } from "@/components/studio/controls";
import { TOOLS, type ToolId } from "@/lib/catalog";
import { api, ApiClientError, newIdempotencyKey } from "@/lib/live/api";
import { useQuote, type QuoteRequest } from "@/lib/live/use-quote";
import { useAccount, useApi } from "@/lib/live/account";
import { TERMINAL_STATES, units, type Catalog, type CatalogModel, type Job } from "@/lib/live/types";
import { cn, fmtCredits, fmtNum } from "@/lib/format";
import { useDemo } from "@/lib/demo-store";
import { LiveReferenceUploader, type LiveReference } from "./live-reference";
import { HistoryTile, prefetchOutputs, type UseAction } from "./preview/generation-card";
import { EmptyPreview, LiveJobCard } from "./preview/job-card";

const selectable = (m: CatalogModel) => (m.state === "enabled" || m.state === "experimental") && m.priced;
const BADGE_LABEL: Record<string, string> = { recommended: "Recommended", premium: "Premium", budget: "Budget", fast: "Fast", long: "Longer clips" };
const defaults = (m: CatalogModel) => Object.fromEntries(Object.entries(m.options ?? {}).map(([k, o]) => [k, o.default]));

/** Live studio for one tool: catalog-driven controls, server quote, one idempotent intent, honest job state (§19.2). */
export function LiveWorkspace({ tool }: { tool: ToolId }) {
  const t = TOOLS[tool];
  const acct = useAccount();
  const catalog = useApi<Catalog>("/api/catalog");
  const models = useMemo(() => (catalog.data?.models ?? []).filter((m) => m.tool === tool), [catalog.data, tool]);
  const usable = models.filter(selectable);
  // Models under maintenance stay visible (with their note) but cannot be chosen.
  const inMaintenance = models.filter((m) => m.state === "maintenance");

  const [modelId, setModelId] = useState<string | null>(null);
  const model = usable.find((m) => m.id === modelId) ?? usable[0] ?? null;
  const [options, setOptions] = useState<Record<string, string | number>>({});
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<LiveReference>({ status: "empty" });
  const [now, setNow] = useState(() => Date.now());
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const recent = useApi<Job[]>(`/api/generations?tool=${tool}&limit=8`);
  const router = useRouter();

  // A saved image can start a video: as the start frame, or as the character for motion control. Offered only when a
  // matching video model is on sale (or, for staff, as a private test in the video studio).
  const videoModels = (catalog.data?.models ?? []).filter((m) => m.tool === "video" && selectable(m));
  const canTest = Boolean(acct.me?.capabilities?.includes("catalog.test"));
  const uses: UseAction[] = [
    {
      id: "animate",
      label: "Animate this image",
      applies: (_j, o) => o.mime.startsWith("image/") && videoModels.some((m) => (m.operation ?? "create") === "create" && m.inputs?.first_frame),
      run: (_j, o) => router.push(`/studio/video?mode=frames&use=${o.assetId}&slot=first_frame`),
    },
    {
      id: "character",
      label: "Use as character",
      applies: (_j, o) => o.mime.startsWith("image/") && (canTest || videoModels.some((m) => m.operation === "motion")),
      run: (_j, o) => router.push(`/studio/video?tab=motion&use=${o.assetId}&slot=character_image`),
    },
  ];
  const refreshWallet = acct.refreshWallet;
  const reloadRecent = recent.reload;
  const onSettled = useCallback(() => {
    void refreshWallet();
    reloadRecent();
  }, [refreshWallet, reloadRecent]);
  useEffect(() => {
    if (recent.data) prefetchOutputs(recent.data);
  }, [recent.data]);
  const anyRunning = (recent.data ?? []).some((j) => !TERMINAL_STATES.includes(j.state));
  useEffect(() => {
    if (!anyRunning) return;
    const i = window.setInterval(() => {
      if (document.visibilityState === "visible") reloadRecent();
    }, 20_000);
    return () => window.clearInterval(i);
  }, [anyRunning, reloadRecent]);

  // A draft written on the homepage before sign-in (kept only in this browser) pre-fills the prompt once.
  const demo = useDemo();
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !demo.hydrated) return;
    restored.current = true;
    const d = demo.draft;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from local draft storage
    if (d && d.tool === tool && d.prompt) setPrompt((p) => p || d.prompt);
  }, [demo.hydrated, demo.draft, tool]);

  // Options follow the selected model's capability spec.
  const effectiveOptions: Record<string, string | number> = model ? { ...defaults(model), ...pick(options, Object.keys(model.options ?? {})) } : {};
  const refId = reference.status === "ready" ? reference.assetId : null;
  const needsRef = (model?.references?.min ?? 0) > 0;
  const promptOk = model ? prompt.trim().length >= (model.prompt?.min ?? 3) : false;

  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);

  // Fresh server quote whenever the request changes. The quote freezes prompt, options and price.
  const quoteRequest: QuoteRequest | null =
    model && promptOk && (!needsRef || refId)
      ? { modelId: model.id, prompt: prompt.trim(), options: effectiveOptions, referenceAssetIds: refId ? [refId] : [] }
      : null;
  // The model was disabled or repriced meanwhile: refresh the choices instead of keeping a stale list.
  const { state: quoteState, quote, renew: renewQuote } = useQuote(quoteRequest, { onUnavailable: () => catalog.reload() });
  const quoting = quoteState.status === "loading";
  const quoteError = quoteState.status === "error" ? quoteState.error : null;

  const quoteExpired = quote ? Date.parse(quote.expiresAt) <= now : false;
  const cost = quote ? units(quote.creditUnits) : null;
  const available = units(acct.wallet?.availableUnits);
  const insufficient = cost !== null && cost > available;

  const generate = async () => {
    // One click, one intent: a second click while the first is in flight is ignored.
    if (!quote || quoteExpired || submitLock.current) return;
    submitLock.current = true;
    // One key per intent (quote); reused if the same intent is retried after a network error.
    const key = keys.current.get(quote.quoteId) ?? newIdempotencyKey();
    keys.current.set(quote.quoteId, key);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<{ job: Job }>("/api/generations", { body: { quoteId: quote.quoteId }, idempotencyKey: key });
      setJobId(r.job.id);
      // On phones the result sits below the composer: bring it into view.
      if (window.matchMedia("(max-width: 1023px)").matches) document.getElementById("live-result")?.scrollIntoView({ block: "start" });
      // The quote was used by this job; price the same input again for the next one.
      renewQuote();
      void acct.refreshWallet();
      recent.reload();
    } catch (e) {
      setSubmitError(e instanceof ApiClientError ? e : null);
      if (e instanceof ApiClientError && ["MODEL_UNAVAILABLE", "QUOTE_STALE"].includes(e.code)) catalog.reload();
      // A new price was published since the quote: fetch a fresh quote so the customer sees the new cost before retrying.
      if (e instanceof ApiClientError && ["QUOTE_STALE", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED", "QUOTE_NOT_FOUND"].includes(e.code)) renewQuote();
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (catalog.loading && !catalog.data) return <PanelSkeleton />;
  if (catalog.error) return <Unavailable title="The studio could not load" body={catalog.error.message} action={<Button onClick={catalog.reload}>Try again</Button>} />;
  if (!model) {
    return (
      <Unavailable
        title={`${t.label} generation is not available yet`}
        body="This tool opens once its model has passed our checks and its price is published. Nothing is charged in the meantime."
        action={
          <ButtonLink href="/studio/library" variant="secondary">
            Open your library
          </ButtonLink>
        }
      />
    );
  }

  const paused = catalog.data?.generationPaused;

  return (
    <div className="lg:flex lg:items-start lg:gap-6 lg:pr-6 lg:pb-3">
      <section
        aria-label="Prompt and settings"
        className="scroll-thin border-y border-white/[0.07] bg-surface lg:sticky lg:top-[68px] lg:flex lg:h-[calc(100dvh-80px)] lg:w-[380px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:rounded-[24px] lg:border"
      >
        <div className="hidden border-b border-white/[0.07] px-5 py-4 lg:block">
          <h2 className="text-sm font-semibold text-ink">Prompt and settings</h2>
          <p className="text-xs text-muted">{t.summary}</p>
        </div>
        <div className="space-y-6 p-4 sm:p-5">
          {paused ? (
            <p role="status" className="flex gap-2 rounded-2xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] p-3 text-sm text-orange-on-dark">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> New generations are paused for maintenance. Running jobs continue.
            </p>
          ) : null}
          {needsRef ? <LiveReferenceUploader value={reference} onChange={setReference} /> : null}

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <label htmlFor="live-prompt" className="text-sm font-semibold text-ink">
                {t.promptLabel}
              </label>
              <span className="text-xs text-muted tabular">
                {prompt.length}/{model.prompt?.max ?? 4000}
              </span>
            </div>
            <textarea
              ref={promptRef}
              id="live-prompt"
              value={prompt}
              maxLength={model.prompt?.max ?? 4000}
              rows={5}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.promptPlaceholder}
              className="block min-h-[132px] w-full resize-y rounded-2xl border border-line-strong bg-canvas/60 px-4 py-3 text-[15px] leading-relaxed text-ink placeholder:text-subtle focus:border-brand-blue-bright"
            />
            {!prompt ? (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Starter prompts">
                {t.starters.map((s) => (
                  <button key={s} type="button" onClick={() => setPrompt(s)} className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-muted hover:border-white/30 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {usable.length > 1 || inMaintenance.length ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink">Model</legend>
              <div className="grid gap-2">
                {usable.map((m) => (
                  <label key={m.id} className={cn("flex cursor-pointer gap-3 rounded-2xl border p-3.5", m.id === model.id ? "border-brand-blue bg-[rgb(37_63_246/0.14)]" : "border-line-strong bg-raised")}>
                    <input type="radio" name="live-model" checked={m.id === model.id} onChange={() => setModelId(m.id)} className="mt-1 size-4 accent-brand-blue" />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                        {m.name} {m.state === "experimental" ? <Badge tone="violet">Experimental</Badge> : null}
                        {(m.badges ?? []).map((b) => (
                          <span key={b} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-muted">
                            {BADGE_LABEL[b] ?? b}
                          </span>
                        ))}
                      </span>
                      {m.purpose ? <span className="block text-[13px] text-muted">{m.purpose}</span> : null}
                    </span>
                  </label>
                ))}
                {inMaintenance.map((m) => (
                  <div key={m.id} aria-disabled="true" className="flex gap-3 rounded-2xl border border-line-strong bg-raised p-3.5 opacity-70">
                    <input type="radio" name="live-model" disabled aria-label={`${m.name} (temporarily unavailable)`} className="mt-1 size-4" />
                    <span>
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        {m.name} <Badge tone="attention">Temporarily unavailable</Badge>
                      </span>
                      <span className="block text-[13px] text-muted">{m.note ?? "Back soon. Your other models work as usual."}</span>
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted">
              Model: <span className="font-semibold text-ink">{model.name}</span>
              {model.state === "experimental" ? <Badge tone="violet" className="ml-2">Experimental</Badge> : null}
            </p>
          )}
          {model.note ? <p className="text-sm text-orange-on-dark">{model.note}</p> : null}

          {Object.entries(model.options ?? {}).map(([key, spec]) =>
            spec.values.length < 2 ? (
              <p key={key} className="text-sm text-muted">
                {spec.label}: <span className="font-semibold text-ink">{spec.labels?.[String(spec.values[0])] ?? String(spec.values[0])}</span>
              </p>
            ) : key === "aspect_ratio" ? (
              <RatioChips
                key={key}
                legend={spec.label}
                value={String(effectiveOptions[key])}
                options={spec.values.map(String)}
                onChange={(v) => setOptions((o) => ({ ...o, [key]: v }))}
              />
            ) : (
              <Segmented
                key={key}
                legend={spec.label}
                value={String(effectiveOptions[key])}
                options={spec.values.map(String)}
                format={(v) => spec.labels?.[v] ?? (key === "duration" ? `${v}s` : v)}
                onChange={(v) => setOptions((o) => ({ ...o, [key]: typeof spec.values[0] === "number" ? Number(v) : v }))}
              />
            ),
          )}
          {model.fixed
            ? Object.values(model.fixed).map((note) => (
                <p key={note} className="text-xs text-muted">
                  {note}
                </p>
              ))
            : null}
        </div>

        <div className="gen-bar sticky bottom-0 mt-auto border-t border-white/[0.07] bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-raised px-3 py-2">
              <p className="text-xs text-muted">Cost</p>
              <p className="font-semibold text-ink tabular" aria-live="polite">
                {quoting ? <span className="text-muted">Updating quote…</span> : cost !== null ? fmtCredits(cost) : <span className="text-muted">—</span>}
              </p>
            </div>
            <div className="rounded-xl bg-raised px-3 py-2">
              <p className="text-xs text-muted">Available</p>
              <p className="font-semibold text-ink tabular">
                {fmtNum(available)}
                {units(acct.wallet?.reservedUnits) ? <span className="ml-1 text-xs font-normal text-muted">· {fmtNum(units(acct.wallet?.reservedUnits))} reserved</span> : null}
              </p>
            </div>
          </div>

          {quoteError || quoteState.status === "timeout" ? (
            <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm">
              <span className="text-orange-on-dark">{quoteError ? quoteError.message : "The price check is taking longer than usual."}</span>
              <Button variant="secondary" size="sm" onClick={renewQuote}>
                Try again
              </Button>
            </div>
          ) : quoteExpired ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm">
              <span className="text-orange-on-dark">Quote expired. Getting a new one…</span>
              <RefreshCw aria-hidden className="size-4 animate-spin-slow text-orange-on-dark" />
            </div>
          ) : insufficient ? (
            <div className="mb-3 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm">
              <p className="text-orange-on-dark">You need {fmtCredits((cost ?? 0) - available)} more for this job.</p>
              <Link href="/studio/credits" className="mt-1 inline-flex items-center gap-1 font-semibold text-link hover:underline">
                <Coins aria-hidden className="size-4" /> Get credits
              </Link>
            </div>
          ) : null}
          {submitError ? (
            <p role="alert" className="mb-3 rounded-xl border border-[rgb(239_68_68/0.4)] bg-[rgb(239_68_68/0.12)] px-3 py-2 text-sm text-error-on-dark">
              {submitError.message}
              {submitError.code === "NETWORK" ? " Pressing Generate again resumes the same request — it is never charged twice." : null}
            </p>
          ) : null}

          <Button size="lg" className="w-full" onClick={generate} busy={submitting} disabled={!quote || quoting || quoteExpired || insufficient || Boolean(paused)}>
            {quote && cost !== null
              ? `Generate · ${fmtCredits(cost)}`
              : quoting
                ? "Checking the price…"
                : quoteRequest
                  ? "Price unavailable"
                  : needsRef && !refId
                    ? "Add a reference image to get a price"
                    : `${t.promptLabel} to get a price`}
          </Button>
          <p className="mt-2 text-center text-xs text-muted">Credits are reserved now and charged only when the file is saved. Failed jobs return them.</p>
        </div>
      </section>

      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:px-0 lg:pt-1">
        <h1 className="sr-only">{t.studioTitle}</h1>
        <div id="live-result" className="scroll-mt-20">
          {jobId ? (
            <LiveJobCard jobId={jobId} uses={uses} onSettled={onSettled} onGone={() => setJobId(null)} />
          ) : (
            <EmptyPreview kind="image" hint="Write a prompt and press Generate. Credits are reserved, then charged only when the file is saved." />
          )}
        </div>
        {recent.data && recent.data.length ? (
          <section aria-labelledby="live-hist" className="mt-8 border-t border-white/[0.07] pt-6">
            <div className="flex items-center justify-between">
              <h2 id="live-hist" className="text-sm font-semibold text-ink">
                Recent {t.label.toLowerCase()} jobs
              </h2>
              <ButtonLink href="/studio/library" variant="ghost" size="sm">
                Open library
              </ButtonLink>
            </div>
            <ul className="mt-3 flex flex-wrap gap-3">
              {recent.data.map((h) => (
                <li key={h.id}>
                  <HistoryTile job={h} selected={jobId === h.id} onSelect={() => setJobId(h.id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** A stored job followed until it settles (reload-safe: everything comes from the database). */
export function LiveJobPanel({ jobId, onSettled }: { jobId: string; onSettled?: () => void }) {
  return <LiveJobCard jobId={jobId} onSettled={onSettled ? () => onSettled() : undefined} />;
}

function pick(o: Record<string, string | number>, keys: string[]) {
  return Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
}

function PanelSkeleton() {
  return (
    <div className="p-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="h-48 animate-pulse-soft rounded-[28px] bg-surface" />
    </div>
  );
}

export function Unavailable({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl p-6 text-center sm:p-10">
      <div className="console-frame p-8">
        <h1 className="font-display text-2xl font-extrabold">{title}</h1>
        <p className="mt-2 text-muted">{body}</p>
        {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
