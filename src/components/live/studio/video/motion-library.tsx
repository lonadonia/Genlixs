"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ImagePlus, Info, LoaderCircle, Play, RefreshCw, Repeat2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOTION_LIBRARY, fmtClip, motionSlots, recreatePlan, type MotionItem } from "@/lib/motion-library";
import { precheck } from "@/lib/live/uploads";
import { factsProblem, type Draft } from "@/lib/live/video-studio";
import type { CatalogModel } from "@/lib/live/types";
import { cn } from "@/lib/format";
import { localMediaFacts, slotHint } from "./inputs";
import { ModelLogo } from "../model-logo";

/** Library grid: posters only — no player and no video download until a clip is opened. */
export function MotionLibraryGrid({ onOpen }: { onOpen: (item: MotionItem, from: HTMLElement) => void }) {
  return (
    <section aria-labelledby="motion-lib-h" className="pb-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-0.5">
        <div>
          <h2 id="motion-lib-h" className="text-base font-semibold text-ink">
            Motion Library
          </h2>
          <p className="text-[13px] text-muted">Pick a movement, add your character and recreate it with Motion Control. Opening a clip costs nothing.</p>
        </div>
        <p className="text-xs text-subtle tabular">{MOTION_LIBRARY.length} clips</p>
      </div>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {MOTION_LIBRARY.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={(e) => onOpen(m, e.currentTarget)}
              className="group relative block aspect-[9/16] w-full overflow-hidden rounded-[14px] bg-raised ring-1 ring-white/[0.07] transition-shadow hover:ring-white/25"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local poster, lazy */}
              <img src={m.poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[rgb(8_10_10/0.9)] to-transparent" />
              <span aria-hidden className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular backdrop-blur">
                {fmtClip(m.durationMs)}
              </span>
              <span aria-hidden className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="grid size-11 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur">
                  <Play className="size-4 translate-x-px" />
                </span>
              </span>
              <span className="absolute inset-x-2.5 bottom-2.5 text-left text-[13px] leading-tight font-semibold text-white">
                <span className="sr-only">Preview </span>
                {m.title}
                <span className="sr-only">, {Math.round(m.durationMs / 1000)} seconds</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Preview of one library clip with the recreate step beside it: the customer watches the clip, adds the image of their
 * character and an optional prompt, then Recreate places the clip, the image and the prompt into Motion Control, where
 * the price is shown and nothing runs until Generate. Native modal: Escape and the close button close it, focus returns
 * to the card, and the player is removed (stopped) on close.
 */
export function MotionPreview({
  item,
  model,
  draft,
  onClose,
  onRecreate,
  returnFocus,
}: {
  item: MotionItem | null;
  model: CatalogModel | null;
  draft: Draft;
  onClose: () => void;
  onRecreate: (item: MotionItem, file: File, prompt: string) => string | null;
  returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  // After Recreate the focus goes to the composer instead of back to the card.
  const handedOver = useRef(false);
  const titleId = useId();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState(draft.prompt);
  const [error, setError] = useState<string | null>(null);
  const slots = motionSlots(model);
  const imageSpec = slots?.image[1] ?? null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (item && !d.open) d.showModal();
    if (!item && d.open) d.close();
  }, [item]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const closed = () => {
      onClose();
      if (!handedOver.current) returnFocus?.focus?.();
    };
    d.addEventListener("close", closed);
    return () => d.removeEventListener("close", closed);
  }, [onClose, returnFocus]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    const v = video.current;
    if (!v || !item) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    v.muted = true;
    if (!reduce) v.play().catch(() => undefined);
    const onVis = () => document.hidden && v.pause();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      v.pause();
    };
  }, [item]);

  const plan = useMemo(() => (item ? recreatePlan(model, draft, item, prompt) : null), [item, model, draft, prompt]);
  const planError = plan && "error" in plan ? plan.error : null;
  const notes = plan && !("error" in plan) ? plan.notes : [];

  const pick = async (f: File) => {
    setError(null);
    setImageError(null);
    if (!imageSpec || !slots) return;
    const check = precheck(f, imageSpec.mime, imageSpec.maxBytes);
    if ("error" in check) return setImageError(check.error);
    setChecking(true);
    const facts = await localMediaFacts(f, "image");
    const problem = factsProblem(model, slots.image[0], imageSpec, facts);
    setChecking(false);
    if (problem) return setImageError(problem);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const recreate = () => {
    if (!item || !file) return;
    const e = onRecreate(item, file, prompt);
    if (e) return setError(e);
    handedOver.current = true;
    ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-canvas p-0 text-ink backdrop:bg-[rgb(8_10_10/0.82)] backdrop:backdrop-blur-[3px] sm:m-auto sm:h-[min(820px,calc(100dvh-2rem))] sm:w-[min(1180px,calc(100vw-2rem))] sm:rounded-[20px] sm:border sm:border-white/[0.08] sm:shadow-[var(--shadow-pop)]"
    >
      {item ? (
        <div className="studio-ui flex h-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_368px]">
          <div className="relative h-[46dvh] shrink-0 overflow-hidden bg-black sm:h-[48%] lg:h-auto">
            {/* eslint-disable-next-line @next/next/no-img-element -- blurred backdrop from the local poster */}
            <img src={item.poster} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-35 blur-2xl" />
            <video
              ref={video}
              key={item.id}
              src={item.src}
              poster={item.poster}
              controls
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={item.alt}
              className="relative mx-auto h-full max-w-full object-contain"
            />
          </div>

          <aside className="flex min-h-0 flex-1 flex-col border-t border-white/[0.08] bg-surface lg:border-t-0 lg:border-l">
            <header className="flex items-start gap-3 border-b border-white/[0.07] px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="truncate text-base font-semibold text-ink">
                  {item.title}
                </h2>
                <p className="text-xs text-muted tabular">
                  Motion Library · {fmtClip(item.durationMs)} · {item.width < item.height ? "portrait" : "landscape"}
                </p>
              </div>
              <button type="button" onClick={() => ref.current?.close()} className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.05] text-muted hover:bg-white/[0.1] hover:text-ink">
                <X aria-hidden className="size-4" />
                <span className="sr-only">Close preview</span>
              </button>
            </header>

            <div className="panel-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className="flex items-center gap-2.5 rounded-xl bg-raised px-3 py-2.5 ring-1 ring-white/[0.06]">
                {model ? <ModelLogo model={model} size="sm" /> : null}
                <p className="min-w-0 text-[13px] text-muted">
                  {model ? (
                    <>
                      Recreates with <span className="font-semibold text-ink">{model.name}</span>: the clip&apos;s movement guides your character. The result follows the motion closely, not frame for frame.
                    </>
                  ) : (
                    "Motion Control is not available right now. You can still watch the clip."
                  )}
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-ink" id={`${fileId}-l`}>
                  Your character
                </p>
                {preview ? (
                  <div className="relative flex items-center gap-3 rounded-xl bg-raised p-2 ring-1 ring-white/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen image */}
                    <img src={preview} alt={`Your character: ${file?.name ?? ""}`} className="size-16 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink">{file?.name}</p>
                      <p className="text-xs text-muted">Checked here; uploaded privately when you recreate.</p>
                    </div>
                    <label htmlFor={fileId} className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus-ring)]">
                      <RefreshCw aria-hidden className="size-3.5" />
                      <span className="sr-only">Replace the image</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setPreview(null);
                      }}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink"
                    >
                      <X aria-hidden className="size-3.5" />
                      <span className="sr-only">Remove the image</span>
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor={fileId}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) void pick(f);
                    }}
                    className={cn(
                      "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-4 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                      imageError ? "border-error-on-dark/70" : "border-white/15 bg-white/[0.02] hover:border-white/35",
                      !imageSpec && "pointer-events-none opacity-60",
                    )}
                  >
                    <span className="grid size-9 place-items-center rounded-lg border border-white/12 bg-raised text-muted">
                      {checking ? <LoaderCircle aria-hidden className="size-4 animate-spin-slow" /> : <ImagePlus aria-hidden className="size-4" />}
                    </span>
                    <span className="text-[13px] font-semibold text-ink">{checking ? "Checking the image…" : "Add your character"}</span>
                    <span className="text-[11px] text-muted">{imageSpec ? slotHint(imageSpec) : "JPG or PNG"}</span>
                  </label>
                )}
                <input
                  id={fileId}
                  type="file"
                  disabled={!imageSpec}
                  accept={(imageSpec?.mime ?? []).join(",")}
                  aria-labelledby={`${fileId}-l`}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void pick(f);
                    e.target.value = "";
                  }}
                />
                {imageError ? (
                  <p role="alert" className="mt-1.5 text-xs text-error-on-dark">
                    {imageError}
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl bg-raised ring-1 ring-white/[0.06] focus-within:ring-brand-blue-bright/70">
                <label htmlFor={`${fileId}-p`} className="block px-3 pt-2.5 text-[11px] font-medium text-muted">
                  Scene description (optional)
                </label>
                <textarea
                  id={`${fileId}-p`}
                  value={prompt}
                  rows={3}
                  maxLength={model?.prompt?.max || undefined}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. “in a neon-lit studio”. Leave it empty to keep the clip's look."
                  className="field-bare block max-h-48 min-h-[76px] w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-subtle focus:outline-none"
                />
              </div>

              {notes.map((n) => (
                <p key={n} className="flex gap-2 rounded-lg bg-[rgb(81_101_248/0.1)] px-2.5 py-2 text-xs text-ink">
                  <Info aria-hidden className="mt-px size-3.5 shrink-0 text-link" /> {n}
                </p>
              ))}
              {planError || error ? (
                <p role="alert" className="rounded-lg bg-[rgb(239_68_68/0.12)] px-2.5 py-2 text-xs text-error-on-dark">
                  {error ?? planError}
                </p>
              ) : null}
            </div>

            <footer className="border-t border-white/[0.07] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button size="lg" className="w-full" icon={<Repeat2 aria-hidden className="size-4" />} disabled={!model || !file || checking || Boolean(planError)} onClick={recreate}>
                Recreate
              </Button>
              <p className="mt-1.5 text-center text-[11px] text-muted">
                {file ? "Next: the price for this clip appears in Motion Control. Nothing is charged until you press Generate." : "Add the image of your character to recreate this movement."}
              </p>
            </footer>
          </aside>
        </div>
      ) : null}
    </dialog>
  );
}
