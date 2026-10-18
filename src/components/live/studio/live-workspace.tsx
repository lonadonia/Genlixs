"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, Gem, ImagePlus, Info, RectangleHorizontal, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { TOOLS } from "@/lib/catalog";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useQuote, type QuoteRequest } from "@/lib/live/use-quote";
import { useAccount, useApi } from "@/lib/live/account";
import { TERMINAL_STATES, units, type Catalog, type CatalogModel, type Job } from "@/lib/live/types";
import { canonicalMime, uploadReference, UploadAborted } from "@/lib/live/uploads";
import { modelsTaking, planAdd, readyRefIds, referenceLimit, referenceProblem, type RefItem } from "@/lib/live/references";
import { fmtCredits, fmtNum } from "@/lib/format";
import { useDemo } from "@/lib/demo-store";
import { HistoryTile, prefetchOutputs, type UseAction } from "./preview/generation-card";
import { EmptyPreview, LiveJobCard } from "./preview/job-card";
import { ModelPicker } from "./model-picker";
import { ChoiceBar, OptionChip, OptionRow } from "./video/controls";
import { ReferenceCollection } from "./image/reference-collection";

export type ImageMode = "image" | "edit";
type ModeDraft = { modelId: string | null; options: Record<string, string | number>; prompt: string; refs: RefItem[] };

const selectable = (m: CatalogModel) => (m.state === "enabled" || m.state === "experimental") && m.priced;
const defaults = (m: CatalogModel) => Object.fromEntries(Object.entries(m.options ?? {}).map(([k, o]) => [k, o.default]));
const emptyDraft = (): ModeDraft => ({ modelId: null, options: {}, prompt: "", refs: [] });
const CHIP_ICON: Record<string, typeof Gem> = { aspect_ratio: RectangleHorizontal, resolution: Gem };

/**
 * Image studio with two modes — Generate (text to image) and Edit (one or more reference images + an instruction).
 * Each mode keeps its own draft (model, settings, prompt, references) while the customer switches. Catalog-driven
 * controls, a server quote for the exact request, one idempotent intent and honest job state (§19.2).
 */
export function LiveWorkspace({ initialMode = "image" }: { initialMode?: ImageMode }) {
  const acct = useAccount();
  const catalog = useApi<Catalog>("/api/catalog");
  const router = useRouter();
  const [mode, setModeState] = useState<ImageMode>(initialMode);
  const t = TOOLS[mode];
  const [drafts, setDrafts] = useState<Record<ImageMode, ModeDraft>>(() => ({ image: emptyDraft(), edit: emptyDraft() }));
  const draft = drafts[mode];
  const update = useCallback((m: ImageMode, fn: (d: ModeDraft) => ModeDraft) => setDrafts((all) => ({ ...all, [m]: fn(all[m]) })), []);

  const all = useMemo(() => catalog.data?.models ?? [], [catalog.data]);
  const models = useMemo(() => all.filter((m) => m.tool === mode), [all, mode]);
  const usable = models.filter(selectable);
  // Models under maintenance stay visible (with their note) but cannot be chosen.
  const inMaintenance = models.filter((m) => m.state === "maintenance");
  const model = usable.find((m) => m.id === draft.modelId) ?? usable[0] ?? null;

  const [now, setNow] = useState(() => Date.now());
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const recent = useApi<Job[]>(`/api/generations?tool=${mode}&limit=8`);

  const setMode = (m: ImageMode) => {
    setModeState(m);
    setNotice(null);
    setSubmitError(null);
    setJobId(null);
    const u = new URL(window.location.href);
    if (m === "edit") u.searchParams.set("mode", "edit");
    else u.searchParams.delete("mode");
    window.history.replaceState(null, "", u);
  };

  // A saved image can start a video: as the start frame, or as the character for motion control. Offered only when a
  // matching video model is on sale (or, for staff, as a private test in the video studio).
  const videoModels = all.filter((m) => m.tool === "video" && selectable(m));
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
    if (d && (d.tool === "image" || d.tool === "edit") && d.prompt) {
      const m: ImageMode = d.tool;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from local draft storage
      setDrafts((all) => ({ ...all, [m]: { ...all[m], prompt: all[m].prompt || d.prompt } }));
    }
  }, [demo.hydrated, demo.draft]);

  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, []);
  useEffect(() => {
    const live = controllers.current;
    return () => live.forEach((c) => c.abort());
  }, []);

  // ---------------------------------------------------------------- references (Edit mode)
  const limit = referenceLimit(model);
  const refs = drafts.edit.refs;
  const patchRef = useCallback(
    (key: string, patch: Partial<RefItem>) => update("edit", (d) => ({ ...d, refs: d.refs.map((r) => (r.key === key ? { ...r, ...patch } : r)) })),
    [update],
  );
  const uploadOne = useCallback(
    async (key: string, file: File, mime: string) => {
      const ac = new AbortController();
      controllers.current.set(key, ac);
      try {
        const asset = await uploadReference(file, mime, (f) => patchRef(key, { progress: f }), ac.signal);
        patchRef(key, { status: "ready", assetId: asset.assetId, progress: 1, error: undefined });
        files.current.delete(key);
      } catch (e) {
        if (e instanceof UploadAborted || ac.signal.aborted) return;
        patchRef(key, { status: "error", error: errorMessage(e) });
      } finally {
        controllers.current.delete(key);
      }
    },
    [patchRef],
  );
  const addRefs = (picked: File[]) => {
    const plan = planAdd(limit, refs, picked.map((f) => ({ name: f.name, size: f.size, mime: canonicalMime(f), file: f })));
    const added: RefItem[] = plan.accepted.map(({ file, mime }) => ({
      key: newIdempotencyKey(),
      status: "uploading",
      progress: 0,
      name: file.name,
      mime: mime!,
      previewUrl: URL.createObjectURL(file),
    }));
    // Append in the order chosen; a later selection never replaces earlier images.
    update("edit", (d) => ({ ...d, refs: [...d.refs, ...added] }));
    added.forEach((it, i) => {
      files.current.set(it.key, plan.accepted[i].file);
      void uploadOne(it.key, plan.accepted[i].file, it.mime);
    });
    setNotice(plan.rejected.length ? plan.rejected.map((r) => r.reason).join(" ") : null);
  };
  const removeRef = (key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    files.current.delete(key);
    update("edit", (d) => {
      const gone = d.refs.find((r) => r.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return { ...d, refs: d.refs.filter((r) => r.key !== key) };
    });
    setNotice(null);
  };
  const retryRef = (key: string) => {
    const f = files.current.get(key);
    const it = refs.find((r) => r.key === key);
    if (!f || !it) return removeRef(key);
    patchRef(key, { status: "uploading", progress: 0, error: undefined });
    void uploadOne(key, f, it.mime);
  };

  // ---------------------------------------------------------------- price and submission
  const effectiveOptions: Record<string, string | number> = model ? { ...defaults(model), ...pick(draft.options, Object.keys(model.options ?? {})) } : {};
  const needsRefs = mode === "edit" && limit.max > 0;
  const refProblem = needsRefs ? referenceProblem(limit, refs) : null;
  const refIds = needsRefs ? readyRefIds(refs) : [];
  const promptOk = model ? draft.prompt.trim().length >= (model.prompt?.min ?? 3) : false;
  const takingAll = needsRefs && refProblem?.startsWith("This model takes") ? modelsTaking(usable, readyRefIds(refs).length) : [];

  // Fresh server quote whenever the request changes. The quote freezes prompt, options, references (in order) and price.
  const quoteRequest: QuoteRequest | null =
    model && promptOk && !refProblem ? { modelId: model.id, prompt: draft.prompt.trim(), options: effectiveOptions, referenceAssetIds: refIds } : null;
  // The model was disabled or repriced meanwhile: refresh the choices instead of keeping a stale list.
  const { state: quoteState, quote, renew: renewQuote } = useQuote(quoteRequest, { onUnavailable: () => catalog.reload() });
  const quoting = quoteState.status === "loading";
  const quoteError = quoteState.status === "error" ? quoteState.error : null;
  const quoteExpired = quote ? Date.parse(quote.expiresAt) <= now : false;
  const cost = quote ? units(quote.creditUnits) : null;
  const available = units(acct.wallet?.availableUnits);
  const reserved = units(acct.wallet?.reservedUnits);
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

  const paused = catalog.data?.generationPaused;
  const setOption = (k: string, v: string | number) => update(mode, (d) => ({ ...d, options: { ...d.options, [k]: v } }));
  const optionEntries = model ? Object.entries(model.options ?? {}) : [];
  const chips = optionEntries.filter(([k, o]) => CHIP_ICON[k] && o.values.length > 0);
  const rows = optionEntries.filter(([k, o]) => !CHIP_ICON[k] && o.values.length > 1);
  const buttonLabel = quote && cost !== null
    ? `Generate · ${fmtCredits(cost)}`
    : quoting
      ? "Checking the price…"
      : quoteRequest
        ? "Price unavailable"
        : !model
          ? "Not available yet"
          : refProblem
            ? refProblem.startsWith("This model takes")
              ? "Too many images for this model"
              : refProblem
            : `${t.promptLabel} to get a price`;

  return (
    <div className="lg:flex lg:items-start lg:gap-5 lg:pr-5 lg:pb-3">
      <section
        aria-label="Prompt and settings"
        className="panel-scroll border-y border-white/[0.07] bg-surface lg:sticky lg:top-[64px] lg:flex lg:h-[calc(100dvh-76px)] lg:w-[352px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:rounded-[20px] lg:border"
      >
        <div className="space-y-3 p-3 sm:p-3.5">
          <ChoiceBar
            label="Image mode"
            value={mode}
            options={[
              { id: "image", label: "Generate", icon: <ImagePlus aria-hidden className="size-3.5" /> },
              { id: "edit", label: "Edit", icon: <WandSparkles aria-hidden className="size-3.5" /> },
            ]}
            onChange={setMode}
          />
          <p className="px-0.5 text-xs text-muted">{t.summary}</p>
          {paused ? (
            <p role="status" className="flex gap-2 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] p-2.5 text-[13px] text-orange-on-dark">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> New generations are paused for maintenance. Running jobs continue.
            </p>
          ) : null}

          {!model ? (
            <div className="rounded-xl border border-white/[0.08] bg-raised p-3.5">
              <p className="text-sm font-semibold text-ink">{mode === "edit" ? "Image editing" : "Image generation"} is not available yet</p>
              <p className="mt-1 text-[13px] text-muted">It opens once a model has passed our checks and its price is published. Nothing is charged in the meantime.</p>
            </div>
          ) : (
            <>
              {mode === "edit" ? (
                <ReferenceCollection limit={limit} items={refs} onAdd={addRefs} onRemove={removeRef} onRetry={retryRef} notice={notice} />
              ) : null}
              {takingAll.length ? (
                <div className="rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] p-2.5 text-xs text-orange-on-dark">
                  <p>{refProblem}.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {takingAll.slice(0, 3).map((m) => (
                      <Button key={m.id} size="sm" variant="secondary" onClick={() => update("edit", (d) => ({ ...d, modelId: m.id }))}>
                        Use {m.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl bg-raised ring-1 ring-white/[0.06] focus-within:ring-brand-blue-bright/70">
                <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5">
                  <label htmlFor="live-prompt" className="text-[11px] font-medium text-muted">
                    {t.promptLabel}
                  </label>
                  <span className="text-[11px] text-subtle tabular">
                    {draft.prompt.length}/{model.prompt?.max ?? 4000}
                  </span>
                </div>
                <textarea
                  id="live-prompt"
                  value={draft.prompt}
                  maxLength={model.prompt?.max ?? 4000}
                  rows={4}
                  onChange={(e) => update(mode, (d) => ({ ...d, prompt: e.target.value }))}
                  placeholder={t.promptPlaceholder}
                  className="field-bare block max-h-64 min-h-[96px] w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-subtle focus:outline-none"
                />
                {!draft.prompt ? (
                  <div className="flex flex-wrap gap-1 px-2.5 pb-2.5" aria-label="Starter prompts">
                    {t.starters.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => update(mode, (d) => ({ ...d, prompt: s }))}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-white/[0.05] px-2 text-[11.5px] font-medium text-muted hover:bg-white/[0.09] hover:text-ink"
                      >
                        <Sparkles aria-hidden className="size-3" /> {s}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <ModelPicker models={usable} value={model} unavailable={inMaintenance} onChange={(id) => update(mode, (d) => ({ ...d, modelId: id }))} />
              {model.note ? <p className="px-0.5 text-[13px] text-orange-on-dark">{model.note}</p> : null}

              {chips.length ? (
                <div className="flex gap-1.5">
                  {chips.map(([k, o]) => {
                    const Icon = CHIP_ICON[k];
                    return <OptionChip key={k} optionKey={k} spec={o} value={effectiveOptions[k]} onChange={(v) => setOption(k, v)} icon={<Icon aria-hidden className="size-3.5" />} />;
                  })}
                </div>
              ) : null}
              {rows.map(([k, o]) => (
                <OptionRow key={k} optionKey={k} spec={o} value={effectiveOptions[k]} onChange={(v) => setOption(k, v)} />
              ))}
              {model.fixed
                ? Object.values(model.fixed).map((note) => (
                    <p key={note} className="px-0.5 text-[11.5px] text-muted">
                      {note}
                    </p>
                  ))
                : null}
            </>
          )}
        </div>

        <div className="gen-bar sticky bottom-0 mt-auto border-t border-white/[0.07] bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-3.5">
          <p className="mb-2 flex items-center justify-between gap-2 text-xs text-muted tabular">
            <span aria-live="polite">
              {cost !== null ? (
                <>
                  Cost <span className="font-semibold text-ink">{fmtCredits(cost)}</span> ·{" "}
                </>
              ) : null}
              Balance <span className="font-semibold text-ink">{fmtNum(available)}</span>
              {reserved ? ` · ${fmtNum(reserved)} reserved` : ""}
            </span>
            <Link href="/studio/credits" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
              <Coins aria-hidden className="size-3.5" /> Get credits
            </Link>
          </p>

          {quoteError || quoteState.status === "timeout" ? (
            <div role="alert" className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-2.5 py-1.5 text-[13px]">
              <span className="text-orange-on-dark">{quoteError ? quoteError.message : "The price check is taking longer than usual."}</span>
              <Button variant="secondary" size="sm" onClick={renewQuote}>
                Try again
              </Button>
            </div>
          ) : quoteExpired ? (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-2.5 py-1.5 text-[13px]">
              <span className="text-orange-on-dark">Quote expired. Getting a new one…</span>
              <RefreshCw aria-hidden className="size-4 animate-spin-slow text-orange-on-dark" />
            </div>
          ) : insufficient ? (
            <p className="mb-2 rounded-lg border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-2.5 py-1.5 text-[13px] text-orange-on-dark">
              You need {fmtCredits((cost ?? 0) - available)} more for this image.
            </p>
          ) : null}
          {submitError ? (
            <p role="alert" className="mb-2 rounded-lg border border-[rgb(239_68_68/0.4)] bg-[rgb(239_68_68/0.12)] px-2.5 py-1.5 text-[13px] text-error-on-dark">
              {submitError.message}
              {submitError.code === "NETWORK" ? " Pressing Generate again resumes the same request — it is never charged twice." : null}
            </p>
          ) : null}

          <Button size="lg" className="w-full" onClick={generate} busy={submitting} disabled={!quote || quoting || quoteExpired || insufficient || Boolean(paused)}>
            {buttonLabel}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-muted">Credits are reserved now and charged only when the file is saved. Failed jobs return them.</p>
        </div>
      </section>

      <div className="min-w-0 flex-1 p-3 sm:p-5 lg:px-0 lg:pt-1">
        <h1 className="sr-only">Image studio</h1>
        <div id="live-result" className="scroll-mt-20">
          {jobId ? (
            <LiveJobCard jobId={jobId} uses={uses} onSettled={onSettled} onGone={() => setJobId(null)} />
          ) : (
            <EmptyPreview
              kind="image"
              hint={
                mode === "edit"
                  ? "Add the image to edit, describe the change and press Generate. Credits are reserved, then charged only when the file is saved."
                  : "Write a prompt and press Generate. Credits are reserved, then charged only when the file is saved."
              }
            />
          )}
        </div>
        {recent.data && recent.data.length ? (
          <section aria-labelledby="live-hist" className="mt-7 border-t border-white/[0.07] pt-5">
            <div className="flex items-center justify-between">
              <h2 id="live-hist" className="text-sm font-semibold text-ink">
                {mode === "edit" ? "Recent edits" : "Recent images"}
              </h2>
              <ButtonLink href="/studio/library" variant="ghost" size="sm">
                Open library
              </ButtonLink>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2.5">
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
      <div className="h-48 animate-pulse-soft rounded-[24px] bg-surface" />
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

