"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Clock3, Coins, FlaskConical, Gem, History, Info, Plus, RectangleHorizontal, Type, Volume2, VolumeX } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { useQuote } from "@/lib/live/use-quote";
import { canonicalMime, kindOf, precheck, uploadReference, UploadAborted } from "@/lib/live/uploads";
import { TERMINAL_STATES, units, type Catalog, type CatalogModel, type InputSlotSpec, type Job, type JobOutput } from "@/lib/live/types";
import {
  activeMode,
  DRAFT_KEYS,
  derivedSeconds,
  effectiveOptions,
  emptyDraft,
  estimateSupplierCredits,
  factsProblem,
  loadDrafts,
  missingReason,
  modesOf,
  onSale,
  OPERATION_OF,
  operationOf,
  quoteRequest,
  readyItems,
  routeFiles,
  saveDrafts,
  TAB_OF,
  visibleOptions,
  visibleSlots,
  type Draft,
  type DraftInput,
  type DraftKey,
  type TabId,
} from "@/lib/live/video-studio";
import { stillOf } from "@/lib/media";
import { cn, fmtCredits, fmtNum } from "@/lib/format";
import { HistoryTile, prefetchOutputs, type UseAction } from "../preview/generation-card";
import { EmptyPreview, LiveJobCard } from "../preview/job-card";
import { DropArea, InputThumb, SingleSlot, localMediaFacts, slotHint, useRevokeUrls } from "./inputs";
import { ModelPicker, type PickerModel } from "./model-picker";
import { ChoiceBar, Disclosure, ModeBanner, OptionChip, OptionRow, Steps } from "./controls";

export type VideoStudioProps = {
  initialDraft?: DraftKey;
  initialJobId?: string | null;
  /** Opened from "Use as …" on a saved result: put that file into a slot once. */
  use?: { assetId: string; slot: string; draft: DraftKey; mode?: string | null } | null;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "create", label: "Create Video" },
  { id: "edit", label: "Edit Video" },
  { id: "motion", label: "Motion Control" },
];

const BANNER: Record<DraftKey, { title: string; subtitle: string; poster: string }> = {
  create: { title: "Create video", subtitle: "From a prompt, start and end frames or references", poster: stillOf("giantAstronaut") },
  extend: { title: "Extend video", subtitle: "Continue one of your own clips", poster: stillOf("goldenHourWalk") },
  edit: { title: "Edit video", subtitle: "Make targeted changes with a prompt", poster: stillOf("hairRollers") },
  motion: { title: "Motion control", subtitle: "Move your character like the person in a video", poster: stillOf("teeDance") },
};

const MODE_NAME: Record<DraftKey, string> = { create: "Video creation", extend: "Extending videos", edit: "Video editing", motion: "Motion control" };

const HOW: Record<DraftKey, { title: string; body: string }[]> = {
  create: [
    { title: "Choose how to start", body: "Text only, start and end frames (the clip begins on your image), or reference images that keep a subject or style consistent. The options shown are the ones the selected model supports." },
    { title: "Describe the clip", body: "Say what happens, how the camera moves and the mood. With elements, mention them in the prompt with @element1, @element2…" },
    { title: "Pick length, shape and resolution", body: "The price updates from the server for exactly these settings before you generate." },
    { title: "Generate", body: "Credits are reserved, then charged only when the video is saved. You can close the page; the job keeps running and appears in your library." },
  ],
  extend: [
    { title: "Choose one of your videos", body: "Only your own clips from a compatible model, created in the last 13 days, can be continued." },
    { title: "Describe what happens next", body: "The new part continues from the last frame of your clip." },
    { title: "Generate", body: "The longer clip is saved as a new video; the original stays as it is." },
  ],
  edit: [
    { title: "Add the video to edit", body: "MP4 or MOV, 4–30 seconds, 480p or 720p, 24–60 fps, up to 50 MB. You can also use one of your saved videos." },
    { title: "Add references if you want", body: "Up to 9 images and up to 3 audio clips (30 seconds in total) guide the look or the sound of the edit." },
    { title: "Describe the change", body: "For example “Make it snow” or “Turn the scene into night”. Everything you do not mention should stay the same." },
    { title: "Price follows the clip", body: "The cost is based on the length of your video, rounded up to the next second, and is shown before you generate." },
  ],
  motion: [
    { title: "Add the motion to copy", body: "A 3–30 second video of one person with head, shoulders and torso visible. Their movement is transferred." },
    { title: "Add your character", body: "A JPG or PNG with a clearly visible face and body. This is who will move." },
    { title: "Choose the orientation", body: "“Follow the video” makes your character face and turn like the person in the video (clips up to 30 s). “Keep the image's pose” keeps the direction your character faces in the image (clips up to 10 s). This setting does not choose the background." },
    { title: "Price follows the clip", body: "The cost is per second of the motion video, rounded up, and is shown before you generate." },
  ],
};

const PLACEHOLDER: Record<DraftKey, string> = {
  create: "Describe the scene, the action and the camera — e.g. “A slow dolly shot of a lighthouse at dusk as waves crash below”.",
  extend: "Describe what happens next — e.g. “The camera keeps rising until the whole city is visible”.",
  edit: "Describe what to change in the video — e.g. “Make it snow” or “Turn the scene into night”.",
  motion: "Optional: describe the scene or style — e.g. “in a neon-lit studio”.",
};

const MODE_SHORT: Record<string, string> = { text: "Text only", frames: "Frames", reference: "References" };
const MODE_HELP: Record<string, string> = {
  text: "Describe the whole scene; no files needed.",
  frames: "The clip starts on your image. Add an end frame to choose where it lands.",
  reference: "Reference images keep a subject, product or style consistent.",
};

/** On phones the composer and the result are stacked: bring the relevant one into view after an action. */
function reveal(id: string) {
  if (!window.matchMedia("(max-width: 1023px)").matches) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Clock reads for event handlers (kept out of render). */
const isPast = (iso: string) => Date.parse(iso) <= Date.now();
const ageDays = (iso: string) => (Date.now() - Date.parse(iso)) / 86_400_000;

const isUuid = (s: string | null | undefined) => Boolean(s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));

/** Video studio: Create Video (references or extend), Edit Video and Motion Control on the live backend. */
export function VideoStudio(props: VideoStudioProps) {
  const acct = useAccount();
  if (!acct.hydrated) return <StudioSkeleton />;
  if (!acct.me) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center sm:p-10">
        <div className="console-frame p-8">
          <h1 className="font-display text-2xl font-extrabold">Sign in to create videos</h1>
          <p className="mt-2 text-muted">Drafts, files and results belong to your account.</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/sign-in?next=/studio/video">Sign in</ButtonLink>
          </div>
        </div>
      </div>
    );
  }
  // Keyed by account: drafts kept in this browser belong to one person.
  return <Studio key={acct.me.id} userId={acct.me.id} {...props} />;
}

function Studio({ userId, initialDraft = "create", initialJobId = null, use = null }: VideoStudioProps & { userId: string }) {
  const acct = useAccount();
  const catalog = useApi<Catalog>("/api/catalog");
  const canTest = Boolean(acct.me?.capabilities?.includes("catalog.test"));
  const [testMode, setTestMode] = useState(false);
  const testCatalog = useApi<{ models: CatalogModel[] }>(canTest && testMode ? "/api/admin/catalog/test-catalog" : null);

  const [tab, setTabState] = useState<TabId>(TAB_OF[use?.draft ?? initialDraft]);
  const [createSub, setCreateSub] = useState<"create" | "extend">((use?.draft ?? initialDraft) === "extend" ? "extend" : "create");
  const dk: DraftKey = tab === "create" ? createSub : tab;

  // Drafts restored from this browser; a "Use as …" link drops its file into the requested slot (checked below).
  const [drafts, setDrafts] = useState<Record<DraftKey, Draft>>(() => {
    const saved = loadDrafts(userId);
    const all = Object.fromEntries(DRAFT_KEYS.map((k) => [k, saved[k] ?? emptyDraft()])) as Record<DraftKey, Draft>;
    if (use) {
      const d = all[use.draft];
      const item: DraftInput = { key: `use-${use.assetId}`, status: "uploading", progress: 0, name: "Your saved result", mime: "", kind: "image", assetId: use.assetId };
      all[use.draft] = { ...d, modeId: use.mode ?? d.modeId, slots: { ...d.slots, [use.slot]: [item] } };
    }
    return all;
  });
  useEffect(() => {
    const t = window.setTimeout(() => saveDrafts(userId, drafts), 400);
    return () => window.clearTimeout(t);
  }, [drafts, userId]);

  const [jobId, setJobId] = useState<string | null>(isUuid(initialJobId) ? initialJobId : null);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [confirmTest, setConfirmTest] = useState(false);
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  const controllers = useRef(new Map<string, AbortController>());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const recent = useApi<Job[]>("/api/generations?tool=video&limit=12");

  // ------------------------------------------------------------------ models for each mode
  const saleModels = useMemo(() => (catalog.data?.models ?? []).filter((m) => m.tool === "video" && onSale(m)), [catalog.data]);
  const testModels = useMemo<PickerModel[]>(
    () =>
      (testCatalog.data?.models ?? [])
        .filter((m) => m.tool === "video" && m.adapterImplemented !== false)
        .map((m) => ({ ...m, privateTest: !onSale(m) }))
        .sort((a, b) => Number(a.privateTest) - Number(b.privateTest)),
    [testCatalog.data],
  );
  const modelsFor = useCallback(
    (key: DraftKey): PickerModel[] => (testMode ? testModels : saleModels).filter((m) => operationOf(m) === OPERATION_OF[key]),
    [testMode, testModels, saleModels],
  );
  const models = modelsFor(dk);
  const draft = drafts[dk];
  const model: PickerModel | null = models.find((m) => m.id === draft.modelId) ?? models[0] ?? null;
  const familyOf = useCallback(
    (modelId: string) => [...(catalog.data?.models ?? []), ...(testCatalog.data?.models ?? [])].find((m) => m.id === modelId)?.family ?? null,
    [catalog.data, testCatalog.data],
  );

  // ------------------------------------------------------------------ draft updates
  const update = useCallback((key: DraftKey, fn: (d: Draft) => Draft) => setDrafts((all) => ({ ...all, [key]: fn(all[key]) })), []);
  const patchItem = useCallback(
    (key: DraftKey, slot: string, itemKey: string, patch: Partial<DraftInput>) =>
      update(key, (d) => (d.slots[slot]?.some((i) => i.key === itemKey) ? { ...d, slots: { ...d.slots, [slot]: d.slots[slot].map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) } } : d)),
    [update],
  );
  const removeItem = useCallback(
    (key: DraftKey, slot: string, itemKey: string) => {
      controllers.current.get(itemKey)?.abort();
      controllers.current.delete(itemKey);
      update(key, (d) => ({ ...d, slots: { ...d.slots, [slot]: (d.slots[slot] ?? []).filter((i) => i.key !== itemKey) } }));
    },
    [update],
  );
  useEffect(() => {
    const live = controllers.current;
    return () => live.forEach((c) => c.abort());
  }, []);
  const allItems = useMemo(() => DRAFT_KEYS.flatMap((k) => Object.values(drafts[k].slots).flat()), [drafts]);
  useRevokeUrls(allItems);

  /** Upload one file into a slot: local checks, private upload with progress, then server verification. */
  const upload = useCallback(
    async (key: DraftKey, m: CatalogModel, slot: string, spec: InputSlotSpec, file: File) => {
      const check = precheck(file, spec.mime, spec.maxBytes);
      const mime = "mime" in check ? check.mime : file.type || "application/octet-stream";
      const kind = kindOf(mime);
      const itemKey = newIdempotencyKey();
      const previewUrl = "mime" in check && (kind === "image" || kind === "video") ? URL.createObjectURL(file) : undefined;
      const item: DraftInput = { key: itemKey, status: "error" in check ? "error" : "uploading", progress: 0, name: file.name, mime, kind, previewUrl, error: "error" in check ? check.error : undefined };
      update(key, (d) => {
        const kept = spec.max === 1 ? [] : (d.slots[slot] ?? []);
        if (spec.max === 1) for (const old of d.slots[slot] ?? []) controllers.current.get(old.key)?.abort();
        return { ...d, slots: { ...d.slots, [slot]: [...kept, item] } };
      });
      if ("error" in check) return;
      const facts = await localMediaFacts(file, kind);
      // Conditional limits (for example the orientation rule) are not applied here: changing the setting fixes them.
      const problem = factsProblem(m, slot, spec, facts);
      patchItem(key, slot, itemKey, { ...facts, ...(problem ? { status: "error" as const, error: problem } : {}) });
      if (problem) return;
      const ac = new AbortController();
      controllers.current.set(itemKey, ac);
      try {
        const asset = await uploadReference(file, mime, (f) => patchItem(key, slot, itemKey, { progress: f }), ac.signal);
        patchItem(key, slot, itemKey, { status: "ready", assetId: asset.assetId, progress: 1 });
      } catch (e) {
        if (e instanceof UploadAborted || ac.signal.aborted) return;
        patchItem(key, slot, itemKey, { status: "error", error: errorMessage(e) });
      } finally {
        controllers.current.delete(itemKey);
      }
    },
    [update, patchItem],
  );

  /** Reads the facts of one of the customer's own saved files (once) and marks it ready to use as an input. */
  const probeInto = useCallback(
    async (key: DraftKey, slot: string, itemKey: string, assetId: string) => {
      try {
        const f = await api<{ assetId: string; mime: string; width: number | null; height: number | null; durationMs: number | null }>(`/api/assets/${assetId}/probe`, { method: "POST", body: {} });
        patchItem(key, slot, itemKey, { status: "ready", mime: f.mime, kind: kindOf(f.mime), width: f.width, height: f.height, durationMs: f.durationMs, progress: 1 });
      } catch (e) {
        patchItem(key, slot, itemKey, { status: "error", error: errorMessage(e) });
      }
    },
    [patchItem],
  );

  // The file from a "Use as …" link is checked once; the link parameters are then dropped so a reload does not repeat it.
  const usedOnce = useRef(false);
  useEffect(() => {
    if (!use || usedOnce.current) return;
    usedOnce.current = true;
    void probeInto(use.draft, use.slot, `use-${use.assetId}`, use.assetId);
    const u = new URL(window.location.href);
    for (const p of ["use", "slot", "mode"]) u.searchParams.delete(p);
    window.history.replaceState(null, "", u);
  }, [use, probeInto]);

  const setUrl = useCallback((params: Record<string, string | null>) => {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
    window.history.replaceState(null, "", u);
  }, []);
  const changeTab = useCallback(
    (t: TabId, sub?: "create" | "extend") => {
      setTabState(t);
      if (sub) setCreateSub(sub);
      const s = sub ?? createSub;
      setUrl({ tab: t === "create" ? (s === "extend" ? "extend" : null) : t });
      setNotice(null);
      setSubmitError(null);
    },
    [createSub, setUrl],
  );
  const selectJob = useCallback(
    (id: string | null) => {
      setJobId(id);
      setUrl({ job: id });
    },
    [setUrl],
  );

  // ------------------------------------------------------------------ results
  const refreshWallet = acct.refreshWallet;
  const reloadRecent = recent.reload;
  const onSettled = useCallback(() => {
    void refreshWallet();
    reloadRecent();
  }, [refreshWallet, reloadRecent]);
  const anyRunning = (recent.data ?? []).some((j) => !TERMINAL_STATES.includes(j.state));
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") reloadRecent();
    }, 20_000);
    return () => window.clearInterval(t);
  }, [anyRunning, reloadRecent]);
  useEffect(() => {
    if (recent.data) prefetchOutputs(recent.data);
  }, [recent.data]);

  /** "Edit this video", "Copy this motion", "Extend this video": the saved file becomes an input of another mode. */
  const startUse = useCallback(
    (target: DraftKey, job: Job, output: JobOutput) => {
      const list = modelsFor(target);
      const m = list.find((x) => x.id === drafts[target].modelId) ?? list[0];
      const want = target === "extend" ? "job" : "video";
      const slot = m?.inputs ? Object.entries(m.inputs).find(([, s]) => s.kind === want)?.[0] : undefined;
      if (!m || !slot) return;
      const mode = modesOf(m).find((x) => x.uses.includes(slot));
      const itemKey = newIdempotencyKey();
      const item: DraftInput = {
        key: itemKey,
        status: want === "job" ? "ready" : "uploading",
        progress: 0,
        name: job.title || job.ref,
        mime: output.mime,
        kind: want,
        assetId: output.assetId,
        jobId: want === "job" ? job.id : undefined,
        durationMs: output.durationMs,
        width: output.width,
        height: output.height,
      };
      update(target, (d) => ({ ...d, modelId: d.modelId ?? m.id, modeId: mode?.id ?? d.modeId, slots: { ...d.slots, [slot]: [item] } }));
      changeTab(TAB_OF[target], target === "extend" ? "extend" : target === "create" ? "create" : undefined);
      if (want !== "job") void probeInto(target, slot, itemKey, output.assetId);
      reveal("video-composer");
    },
    [modelsFor, drafts, update, changeTab, probeInto],
  );

  const extendable = useCallback(
    (job: Job) => {
      const spec = modelsFor("extend")[0]?.inputs?.source_job;
      if (!spec) return false;
      const fam = familyOf(job.modelId);
      return Boolean(fam && (spec.families ?? []).includes(fam)) && ageDays(job.completedAt ?? job.createdAt) <= (spec.maxAgeDays ?? 13);
    },
    [modelsFor, familyOf],
  );
  const uses: UseAction[] = useMemo(
    () => [
      { id: "edit", label: "Edit this video", applies: (_j, o) => o.mime.startsWith("video/") && modelsFor("edit").length > 0, run: (j, o) => startUse("edit", j, o) },
      { id: "motion", label: "Copy this motion", applies: (_j, o) => o.mime.startsWith("video/") && modelsFor("motion").length > 0, run: (j, o) => startUse("motion", j, o) },
      { id: "extend", label: "Extend this video", applies: (j, o) => o.mime.startsWith("video/") && j.purpose !== "staff_test" && extendable(j), run: (j, o) => startUse("extend", j, o) },
    ],
    [modelsFor, startUse, extendable],
  );

  // ------------------------------------------------------------------ price and submission
  const missing = missingReason(model, draft);
  const request = model ? quoteRequest(model, draft) : null;
  const { state: quoteState, quote, renew } = useQuote(testMode ? null : request, { onUnavailable: () => catalog.reload() });
  const quoting = quoteState.status === "loading";
  const quoteError = quoteState.status === "error" ? quoteState.error : null;
  const cost = quote ? units(quote.creditUnits) : null;
  const available = units(acct.wallet?.availableUnits);
  const reserved = units(acct.wallet?.reservedUnits);
  const insufficient = cost !== null && cost > available;
  const options = model ? effectiveOptions(model, draft) : {};
  const seconds = quote?.options?.seconds !== undefined ? Number(quote.options.seconds) : derivedSeconds(model, draft);
  const estimate = testMode && model ? estimateSupplierCredits(model, { ...options, ...(seconds ? { seconds } : {}) }, seconds) : null;
  const paused = Boolean(catalog.data?.generationPaused);

  const generate = async () => {
    if (!quote || lock.current) return;
    if (isPast(quote.expiresAt)) return renew();
    lock.current = true;
    const key = keys.current.get(quote.quoteId) ?? newIdempotencyKey();
    keys.current.set(quote.quoteId, key);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<{ job: Job }>("/api/generations", { body: { quoteId: quote.quoteId }, idempotencyKey: key });
      selectJob(r.job.id);
      renew();
      void acct.refreshWallet();
      recent.reload();
      reveal("video-result");
    } catch (e) {
      setSubmitError(e instanceof ApiClientError ? e : null);
      if (e instanceof ApiClientError && ["MODEL_UNAVAILABLE", "QUOTE_STALE"].includes(e.code)) catalog.reload();
      if (e instanceof ApiClientError && ["QUOTE_STALE", "QUOTE_EXPIRED", "QUOTE_ALREADY_USED", "QUOTE_NOT_FOUND"].includes(e.code)) renew();
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };

  /** Private staff test of any model through the normal durable pipeline; the KIE account pays, no customer wallet. */
  const runTest = async () => {
    if (!model || !request || lock.current) return;
    lock.current = true;
    const body = { prompt: request.prompt, options: request.options, inputs: request.inputs, confirmSpend: true };
    const signature = JSON.stringify([model.id, body]);
    const key = keys.current.get(signature) ?? newIdempotencyKey();
    keys.current.set(signature, key);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api<{ job: Job }>(`/api/admin/catalog/models/${encodeURIComponent(model.id)}/tests`, { body, idempotencyKey: key });
      keys.current.delete(signature);
      setConfirmTest(false);
      selectJob(r.job.id);
      reveal("video-result");
    } catch (e) {
      setConfirmTest(false);
      setSubmitError(e instanceof ApiClientError ? e : null);
      if (e instanceof ApiClientError && e.code !== "NETWORK") keys.current.delete(signature);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ rendering
  if (catalog.loading && !catalog.data) return <StudioSkeleton />;
  if (catalog.error && !catalog.data) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center sm:p-10">
        <div className="console-frame p-8">
          <h1 className="font-display text-2xl font-extrabold">The studio could not load</h1>
          <p className="mt-2 text-muted">{catalog.error.message}</p>
          <div className="mt-6 flex justify-center">
            <Button onClick={catalog.reload}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  const banner = BANNER[dk];
  const loadingTests = testMode && testCatalog.loading && !testCatalog.data;
  const setOption = (k: string, v: string | number) => update(dk, (d) => ({ ...d, options: { ...d.options, [k]: v } }));
  const shown = model ? visibleOptions(model, draft) : [];
  const chipKeys = ["duration", "aspect_ratio", "resolution"];
  const chips = shown.filter(([k]) => chipKeys.includes(k));
  const rows = shown.filter(([k]) => k === "mode" || k === "tier");
  const audio = shown.find(([k]) => k === "audio")?.[1] ?? null;
  const orientation = shown.find(([k]) => k === "orientation")?.[1] ?? null;
  const advanced = shown.filter(([k, o]) => !chipKeys.includes(k) && !["mode", "tier", "audio", "orientation"].includes(k) && o.values.length > 1);
  const mode = activeMode(model, draft.modeId);
  const modes = modesOf(model);
  const promptOptional = Boolean(model?.prompt?.optional);
  const mentions = Object.entries(model?.inputs ?? {}).filter(([name, s]) => s.mention && visibleSlots(model, draft.modeId).some(([v]) => v === name));

  const insertMention = (m: string) => {
    const el = promptRef.current;
    const p = draft.prompt;
    const at = el ? el.selectionStart : p.length;
    const before = p.slice(0, at);
    const text = `${before}${before && !before.endsWith(" ") ? " " : ""}${m} ${p.slice(at)}`;
    update(dk, (d) => ({ ...d, prompt: text.slice(0, model?.prompt?.max ?? 4000) }));
    window.setTimeout(() => el?.focus(), 0);
  };

  const promptBox = model ? (
    <div className="rounded-2xl bg-raised ring-1 ring-white/[0.06] focus-within:ring-brand-blue-bright/70">
      <label htmlFor="video-prompt" className="block px-3.5 pt-3 text-[11px] font-semibold text-muted">
        {promptOptional ? "Scene description (optional)" : "Prompt"}
      </label>
      <textarea
        ref={promptRef}
        id="video-prompt"
        value={draft.prompt}
        rows={4}
        maxLength={model.prompt?.max ?? 4000}
        onChange={(e) => update(dk, (d) => ({ ...d, prompt: e.target.value }))}
        placeholder={PLACEHOLDER[dk] + (mentions.length ? " Mention elements with @element1." : "")}
        className="block max-h-64 min-h-[104px] w-full resize-y bg-transparent px-3.5 py-2 text-[15px] leading-relaxed text-ink placeholder:text-subtle focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
        {mentions.map(([name, s]) => (
          <button
            key={name}
            type="button"
            onClick={() => insertMention(s.mention!)}
            className="h-8 rounded-full bg-white/[0.06] px-2.5 text-xs font-semibold text-ink hover:bg-white/[0.12]"
            title={`Insert ${s.mention} into the prompt`}
          >
            {s.mention}
          </button>
        ))}
        {audio ? (
          <button
            type="button"
            aria-pressed={options.audio === "on"}
            onClick={() => setOption("audio", options.audio === "on" ? "off" : "on")}
            className={cn("flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", options.audio === "on" ? "bg-[rgb(37_63_246/0.22)] text-ink" : "bg-white/[0.06] text-muted")}
            title={audio.label}
          >
            {options.audio === "on" ? <Volume2 aria-hidden className="size-3.5" /> : <VolumeX aria-hidden className="size-3.5" />}
            {audio.labels?.[String(options.audio)] ?? (options.audio === "on" ? "Sound on" : "Sound off")}
          </button>
        ) : null}
        <span className="ml-auto pr-1 text-[11px] text-subtle tabular">
          {draft.prompt.length}/{model.prompt?.max ?? 4000}
        </span>
      </div>
    </div>
  ) : null;

  const settings = model ? (
    <div className="space-y-2.5">
      <ModelPicker models={models} value={model} onChange={(id) => update(dk, (d) => ({ ...d, modelId: id }))} />
      {rows.map(([k, o]) => (
        <OptionRow key={k} optionKey={k} spec={o} value={options[k]} onChange={(v) => setOption(k, v)} label={k === "mode" ? "Quality" : undefined} />
      ))}
      {chips.length ? (
        <div className="flex gap-2">
          {chips.map(([k, o]) => (
            <OptionChip
              key={k}
              optionKey={k}
              spec={o}
              value={options[k]}
              onChange={(v) => setOption(k, v)}
              icon={k === "duration" ? <Clock3 aria-hidden className="size-4" /> : k === "aspect_ratio" ? <RectangleHorizontal aria-hidden className="size-4" /> : <Gem aria-hidden className="size-4" />}
            />
          ))}
        </div>
      ) : null}
      {mode.allowedMessage && mode.allowed ? <p className="px-1 text-xs text-muted">{mode.allowedMessage}</p> : null}
      {seconds && model.derived ? (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
          <Clock3 aria-hidden className="size-3.5" /> Billed length: {seconds} s, taken from your clip (rounded up).
        </p>
      ) : null}
    </div>
  ) : null;

  const slotsNow = visibleSlots(model, draft.modeId);
  const singles = slotsNow.filter(([, s]) => s.max === 1 && s.kind !== "job");
  // Images first, then video, then audio (the catalog stores slots in key order).
  const KIND_ORDER = ["image", "video", "audio"];
  const multis = slotsNow.filter(([, s]) => s.max > 1 && !s.group).sort(([, a], [, b]) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const elements = slotsNow.filter(([, s]) => s.group === "elements");
  const jobSlot = slotsNow.find(([, s]) => s.kind === "job") ?? null;

  const singleTile = ([name, spec]: [string, InputSlotSpec], compact: boolean) => {
    const item = draft.slots[name]?.[0];
    const blockedBy = (spec.needs ?? []).find((n) => !readyItems(draft.slots[n]).length);
    const titles: Record<string, string> = { "End frame": "End frame · optional", "Last frame": "Last frame · optional", "Motion to copy": "Add motion to copy", "Your character": "Add your character", "Video to edit": "Add a video to edit" };
    return (
      <SingleSlot
        key={name}
        spec={spec}
        item={item}
        compact={compact}
        title={titles[spec.label] ?? spec.label}
        icon={spec.kind === "video" ? "video" : spec.label === "Your character" ? "plus" : "image"}
        hint={blockedBy ? `Add a ${model?.inputs?.[blockedBy]?.label.toLowerCase() ?? "start frame"} first` : spec.hint ?? slotHint(spec)}
        disabled={Boolean(blockedBy) || !model}
        onFiles={(files) => model && files[0] && void upload(dk, model, name, spec, files[0])}
        onRemove={() => item && removeItem(dk, name, item.key)}
      />
    );
  };

  const multiItems = multis.flatMap(([name]) => (draft.slots[name] ?? []).map((i) => ({ slot: name, item: i })));
  const multiKinds = [...new Set(multis.map(([, s]) => s.kind))].filter((k): k is "image" | "video" | "audio" => k !== "job");
  const multiSubtitle = multis.map(([, s]) => `${s.kind === "image" ? "images" : s.kind === "audio" ? "audio" : "videos"} up to ${s.max}${s.totalMaxSeconds ? ` (${s.totalMaxSeconds} s total)` : ""}`).join(" · ");

  function addFiles(files: File[], only: string[]) {
    if (!model) return;
    const typed = files.map((file) => ({ file, mime: canonicalMime(file) ?? "" }));
    const { placed, rejected } = routeFiles(model, draft, typed, only);
    for (const p of placed) void upload(dk, model, p.slot, model.inputs![p.slot], p.file.file);
    setNotice(rejected.length ? `${rejected.length === 1 ? rejected[0].file.name : `${rejected.length} files`} could not be added: check the file type and how many files this model takes.` : null);
  }

  // Plain JSX (not nested components), so thumbnails and players are not re-created on every update.
  const shownEls = elements.filter((_, i) => i === 0 || (draft.slots[elements[i - 1][0]] ?? []).length > 0);
  const elementList = elements.length ? (
    <div className="space-y-2">
      <p className="flex items-baseline justify-between px-1 text-xs font-semibold text-muted">
        Elements <span className="font-normal">Optional · 2–4 images of one subject each</span>
      </p>
      {shownEls.map(([name, spec]) => {
        const items = draft.slots[name] ?? [];
        const room = spec.max - items.filter((i) => i.status !== "error").length;
        return (
          <div key={name} className="rounded-2xl bg-raised p-2.5 ring-1 ring-white/[0.06]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{spec.label}</span>
              {spec.mention ? (
                <button type="button" onClick={() => insertMention(spec.mention!)} className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-link hover:bg-white/[0.12]">
                  Insert {spec.mention}
                </button>
              ) : null}
            </div>
            <ul className="grid grid-cols-4 gap-2">
              {items.map((it) => (
                <li key={it.key}>
                  <InputThumb item={it} onRemove={() => removeItem(dk, name, it.key)} />
                </li>
              ))}
              {room > 0 ? (
                <li>
                  <AddTile accept={spec.mime ?? []} label={`Add images to ${spec.label}`} onFiles={(files) => addFiles(files, [name])} />
                </li>
              ) : null}
            </ul>
          </div>
        );
      })}
    </div>
  ) : null;

  const chosenSource = jobSlot ? draft.slots[jobSlot[0]]?.[0] : undefined;
  const eligibleSources = jobSlot ? (recent.data ?? []).filter((j) => j.state === "succeeded" && j.outputs.length > 0 && extendable(j)) : [];
  const extendSource = jobSlot ? (
    <div className="space-y-2">
      {chosenSource ? <InputThumb item={chosenSource} label={jobSlot[1].label} large onRemove={() => removeItem(dk, jobSlot[0], chosenSource.key)} /> : null}
      <p className="px-1 text-xs text-muted">{jobSlot[1].hint ?? "Choose one of your videos."}</p>
      {eligibleSources.length ? (
        <ul className="flex gap-2 overflow-x-auto pb-1 scroll-thin" aria-label="Your videos that can be extended">
          {eligibleSources.map((j) => (
            <li key={j.id}>
              <HistoryTile job={j} selected={chosenSource?.jobId === j.id} onSelect={() => startUse("extend", j, j.outputs[0])} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-muted">No compatible videos yet. Create one first, then extend it here.</p>
      )}
    </div>
  ) : null;

  const inputs = !model ? null : (
    <div className="space-y-3">
      {dk === "create" && modes.length > 1 ? (
        <div className="space-y-1.5">
          <ChoiceBar
            label="Start from"
            size="sm"
            value={mode.id}
            options={modes.map((m) => ({ id: m.id, label: MODE_SHORT[m.id] ?? m.label ?? m.id, title: m.label, icon: m.id === "text" ? <Type aria-hidden className="size-3.5" /> : undefined }))}
            onChange={(id) => update(dk, (d) => ({ ...d, modeId: id }))}
          />
          <p className="px-1 text-xs text-muted">{MODE_HELP[mode.id] ?? mode.label}</p>
        </div>
      ) : null}

      {dk === "edit"
        ? singles.map((s) => <div key={s[0]}>{singleTile(s, false)}</div>)
        : singles.length ? (
            <div className={cn("grid gap-2.5", singles.length > 1 ? "grid-cols-2" : "grid-cols-1")}>{singles.map((s) => singleTile(s, singles.length > 1))}</div>
          ) : null}

      {multis.length ? (
        <div className="space-y-2">
          <DropArea
            title={dk === "edit" ? "Add references (optional)" : "Add references"}
            subtitle={multiSubtitle.charAt(0).toUpperCase() + multiSubtitle.slice(1)}
            kinds={multiKinds}
            accept={[...new Set(multis.flatMap(([, s]) => s.mime ?? []))]}
            onFiles={(files) => addFiles(files, multis.map(([n]) => n))}
          />
          {multiItems.length ? (
            <ul className="grid grid-cols-4 gap-2">
              {multiItems.map(({ slot, item }) => (
                <li key={item.key}>
                  <InputThumb item={item} onRemove={() => removeItem(dk, slot, item.key)} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {elementList}

      {extendSource}

      {notice ? (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-[rgb(255_181_71/0.08)] px-3 py-2 text-xs text-orange-on-dark">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" /> <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            OK
          </button>
        </p>
      ) : null}
    </div>
  );

  const unavailable = !model && !loadingTests;

  return (
    <div className="lg:flex lg:items-start lg:gap-6 lg:pr-6 lg:pb-3">
      <section
        id="video-composer"
        aria-label="Video composer"
        className="scroll-thin scroll-mt-16 border-y border-white/[0.07] bg-surface lg:sticky lg:top-[68px] lg:flex lg:h-[calc(100dvh-80px)] lg:w-[400px] lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:rounded-[24px] lg:border"
      >
        <div className="z-10 bg-surface lg:sticky lg:top-0">
          <Tabs value={tab} onChange={(t) => changeTab(t)} />
          {canTest ? (
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2">
              <span className="flex items-center gap-2 text-xs text-muted">
                <FlaskConical aria-hidden className="size-4 text-orange-on-dark" /> Private test · staff only
              </span>
              <Switch checked={testMode} onChange={setTestMode} label="Private test mode" />
            </div>
          ) : null}
        </div>

        <div role="tabpanel" id="video-panel" aria-labelledby={`video-tab-${tab}`} key={`${dk}-${testMode}`} className="animate-fade-up space-y-3 p-3 sm:p-4">
          <ModeBanner title={banner.title} subtitle={banner.subtitle} poster={banner.poster} onHelp={() => setHelp(true)} />
          {tab === "create" ? (
            <ChoiceBar
              label="Create from"
              value={createSub}
              options={[
                { id: "create", label: "References" },
                { id: "extend", label: "Extend video" },
              ]}
              onChange={(v) => changeTab("create", v)}
            />
          ) : null}
          {paused ? (
            <p role="status" className="flex gap-2 rounded-2xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] p-3 text-sm text-orange-on-dark">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" /> New generations are paused for maintenance. Running jobs continue.
            </p>
          ) : null}

          {loadingTests ? <div className="h-40 animate-pulse-soft rounded-2xl bg-raised" role="status" aria-label="Loading test models" /> : null}

          {unavailable ? (
            <div className="rounded-2xl border border-white/[0.08] bg-raised p-4">
              <p className="font-semibold text-ink">{MODE_NAME[dk]} is not available yet</p>
              <p className="mt-1 text-sm text-muted">
                {testMode
                  ? "No model for this mode has an integration in this release."
                  : "It opens as soon as a model for it has passed our checks and its price is published. Nothing is charged until then."}
              </p>
              {canTest && !testMode ? (
                <Button size="sm" variant="secondary" className="mt-3" icon={<FlaskConical aria-hidden className="size-4" />} onClick={() => setTestMode(true)}>
                  Try it as a private test
                </Button>
              ) : null}
            </div>
          ) : null}

          {model ? (
            <>
              {model.note ? <p className="px-1 text-sm text-orange-on-dark">{model.note}</p> : null}
              {inputs}
              {dk === "motion" ? null : promptBox}
              {settings}
              {orientation ? (
                <fieldset className="space-y-2 rounded-2xl bg-raised p-3 ring-1 ring-white/[0.06]">
                  <legend className="sr-only">{orientation.label}</legend>
                  <p className="text-sm font-semibold text-ink" aria-hidden>
                    {orientation.label}
                  </p>
                  <ChoiceBar
                    label={orientation.label}
                    size="sm"
                    value={String(options.orientation)}
                    options={orientation.values.map((v) => ({ id: String(v), label: orientation.labels?.[String(v)] ?? String(v) }))}
                    onChange={(v) => setOption("orientation", v)}
                  />
                  <p className="text-xs text-muted">
                    {options.orientation === "image"
                      ? "Your character keeps the direction it faces in the image. Motion clips up to 10 s."
                      : "Your character faces and turns like the person in the video. Motion clips up to 30 s."}{" "}
                    This does not choose the background.
                  </p>
                </fieldset>
              ) : null}
              {dk === "motion" || advanced.length ? (
                <Disclosure title="Advanced settings">
                  {dk === "motion" ? promptBox : null}
                  {advanced.map(([k, o]) => (
                    <OptionRow key={k} optionKey={k} spec={o} value={options[k]} onChange={(v) => setOption(k, v)} />
                  ))}
                </Disclosure>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="gen-bar sticky bottom-0 mt-auto border-t border-white/[0.07] bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {testMode ? (
            <p className="mb-2 flex items-start gap-2 text-xs text-muted">
              <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-orange-on-dark" /> Private test: paid from the KIE account, no customer credits. The result is visible to staff only.
            </p>
          ) : (
            <p className="mb-2 flex items-center justify-between gap-2 text-xs text-muted tabular">
              <span>
                Balance <span className="font-semibold text-ink">{fmtNum(available)}</span>
                {reserved ? ` · ${fmtNum(reserved)} reserved` : ""}
              </span>
              <Link href="/studio/credits" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
                <Coins aria-hidden className="size-3.5" /> Get credits
              </Link>
            </p>
          )}

          {!testMode && (quoteError || quoteState.status === "timeout") ? (
            <div role="alert" className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm">
              <span className="text-orange-on-dark">{quoteError ? quoteError.message : "The price check is taking longer than usual."}</span>
              <Button variant="secondary" size="sm" onClick={renew}>
                Try again
              </Button>
            </div>
          ) : !testMode && insufficient ? (
            <p className="mb-2 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm text-orange-on-dark">
              You need {fmtCredits((cost ?? 0) - available)} more for this video.
            </p>
          ) : null}
          {submitError ? (
            <div role="alert" className="mb-2 rounded-xl border border-[rgb(239_68_68/0.4)] bg-[rgb(239_68_68/0.12)] px-3 py-2 text-sm text-error-on-dark">
              {submitError.message}
              {submitError.code === "NETWORK" ? " Pressing the button again resumes the same request — it is never charged twice." : null}
              {submitError.code === "TEST_IN_PROGRESS" && typeof submitError.details?.jobId === "string" ? (
                <button type="button" className="ml-1 font-semibold underline" onClick={() => selectJob(String(submitError.details?.jobId))}>
                  Open it
                </button>
              ) : null}
            </div>
          ) : null}

          {testMode ? (
            <Button size="lg" className="w-full" disabled={!request || paused || submitting} busy={submitting} onClick={() => setConfirmTest(true)} icon={<FlaskConical aria-hidden className="size-4" />}>
              {request ? `Run private test${estimate !== null ? ` · ≈ ${fmtNum(estimate)} KIE credits` : ""}` : (missing ?? "Run private test")}
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={generate} busy={submitting} disabled={!quote || quoting || insufficient || paused || !model}>
              {quote && cost !== null ? `Generate · ${fmtCredits(cost)}` : quoting ? "Checking the price…" : request ? "Price unavailable" : model ? (missing ?? "Generate") : "Not available yet"}
            </Button>
          )}
          {!testMode && model ? <p className="mt-2 text-center text-[11px] text-muted">Credits are reserved now and charged only when the video is saved. Failed jobs return them.</p> : null}
        </div>
      </section>

      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:px-0 lg:pt-1">
        <h1 className="sr-only">Video studio</h1>
        <div className="mb-3 flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" icon={<History aria-hidden className="size-4" />} onClick={() => document.getElementById("video-history")?.scrollIntoView({ block: "start" })}>
            History
          </Button>
          <Button variant="ghost" size="sm" icon={<BookOpen aria-hidden className="size-4" />} onClick={() => setHelp(true)}>
            How it works
          </Button>
        </div>
        <div id="video-result" className="scroll-mt-20">
          {jobId ? <LiveJobCard jobId={jobId} uses={uses} onSettled={onSettled} onGone={() => selectJob(null)} /> : <EmptyPreview kind="video" hint={EMPTY_HINT[dk]} />}
        </div>
        <section id="video-history" aria-labelledby="video-history-h" className="mt-8 scroll-mt-20 border-t border-white/[0.07] pt-6">
          <div className="flex items-center justify-between">
            <h2 id="video-history-h" className="text-sm font-semibold text-ink">
              Recent videos
            </h2>
            <ButtonLink href="/studio/library" variant="ghost" size="sm">
              Open library
            </ButtonLink>
          </div>
          {recent.data && recent.data.length ? (
            <ul className="mt-3 flex flex-wrap gap-3">
              {recent.data.map((h) => (
                <li key={h.id}>
                  <HistoryTile job={h} selected={jobId === h.id} onSelect={() => selectJob(h.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">{recent.loading ? "Loading…" : "Your videos appear here."}</p>
          )}
        </section>
      </div>

      <Dialog open={help} onClose={() => setHelp(false)} title={`How it works · ${banner.title}`} description={banner.subtitle}>
        <Steps steps={HOW[dk]} />
      </Dialog>
      <Dialog
        open={confirmTest}
        onClose={() => setConfirmTest(false)}
        title="Run a private test?"
        description={model ? `${model.name}${estimate !== null ? ` · about ${fmtNum(estimate)} KIE credits` : ""}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmTest(false)}>
              Cancel
            </Button>
            <Button onClick={runTest} busy={submitting} icon={<FlaskConical aria-hidden className="size-4" />}>
              Run test
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This sends a real request to KIE and spends credits from the KIE account. No customer credits are reserved or charged, and the result is visible
          to staff only. The estimate comes from the documented cost; KIE&apos;s own charge is recorded with the result.
        </p>
      </Dialog>
    </div>
  );
}

function Tabs({ value, onChange }: { value: TabId; onChange: (t: TabId) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(TABS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Video mode" className="flex gap-1 overflow-x-auto border-b border-white/[0.07] px-2 sm:px-3">
      {TABS.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`video-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="video-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn("relative h-12 shrink-0 px-2.5 text-sm font-semibold whitespace-nowrap transition-colors", on ? "text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
            <span aria-hidden className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-blue-bright transition-opacity duration-200", on ? "opacity-100" : "opacity-0")} />
          </button>
        );
      })}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-10 shrink-0 rounded-full border transition-colors", checked ? "border-brand-blue bg-brand-blue" : "border-line-strong bg-raised")}
    >
      <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white transition-transform", checked && "translate-x-4")} />
    </button>
  );
}

function AddTile({ accept, label, onFiles }: { accept: string[]; label: string; onFiles: (files: File[]) => void }) {
  return (
    <label className="grid aspect-square cursor-pointer place-items-center rounded-2xl border border-dashed border-white/15 text-muted hover:border-white/35 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]">
      <Plus aria-hidden className="size-5" />
      <span className="sr-only">{label}</span>
      <input
        type="file"
        multiple
        accept={accept.join(",")}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

const EMPTY_HINT: Record<DraftKey, string> = {
  create: "Write a prompt, add frames or references if you like, and press Generate.",
  extend: "Choose one of your videos and describe what happens next.",
  edit: "Add the video you want to change, describe the edit and press Generate.",
  motion: "Add a motion video and your character, then press Generate.",
};

function StudioSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:flex lg:gap-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="h-[560px] animate-pulse-soft rounded-[24px] bg-surface lg:w-[400px]" />
      <div className="mt-4 aspect-video flex-1 animate-pulse-soft rounded-[24px] bg-surface lg:mt-0" />
    </div>
  );
}
