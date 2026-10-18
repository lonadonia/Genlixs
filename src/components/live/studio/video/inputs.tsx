"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AudioLines, Film, ImagePlus, LoaderCircle, Music, Plus, RefreshCw, X } from "lucide-react";
import type { InputKind, InputSlotSpec } from "@/lib/live/types";
import type { DraftInput } from "@/lib/live/video-studio";
import { cn } from "@/lib/format";
import { useSignedUrl } from "../preview/signed-media";

/** One input in a slot: being uploaded, ready (verified asset or own saved result / own job) or refused. */
export type SlotItem = DraftInput;

export const ACCEPT_ICON: Record<string, typeof ImagePlus> = { image: ImagePlus, video: Film, audio: Music };

const fmtSecs = (ms?: number | null) => (ms ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : null);
const fmtSize = (w?: number | null, h?: number | null) => (w && h ? `${w}×${h}` : null);

/** Human limits for a slot from the model's spec (types, count, length, size) — shown, and also enforced on the server. */
export function slotHint(spec: InputSlotSpec): string {
  if (spec.hint) return spec.hint;
  const types = (spec.mime ?? []).map((m) => m.split("/")[1].replace("quicktime", "MOV").replace("mpeg", "MP3").replace("jpeg", "JPG").replace(/^mp4$/, m.startsWith("audio") ? "M4A" : "MP4").toUpperCase());
  const parts = [types.join(", ")];
  if (spec.max > 1) parts.push(`up to ${spec.max}`);
  if (spec.minSeconds || spec.maxSeconds) parts.push(`${spec.minSeconds ?? 0}–${spec.maxSeconds ?? "∞"} s`);
  if (spec.maxBytes) parts.push(`${Math.round(spec.maxBytes / 1024 / 1024)} MB each`);
  return parts.filter(Boolean).join(" · ");
}

/** Reads length and picture size in the browser for an immediate preview; the server re-reads the real file. */
export async function localMediaFacts(file: File, kind: InputKind): Promise<{ durationMs?: number; width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (kind === "image") {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.src = url;
    await new Promise<void>((res, rej) => {
      el.onloadedmetadata = () => res();
      el.onerror = () => rej(new Error("metadata"));
      window.setTimeout(() => res(), 8000);
    });
    const v = el as HTMLVideoElement;
    return { durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Thumbnail of one input with status, facts and remove/replace. */
export function InputThumb({
  item,
  onRemove,
  onReplace,
  large,
  label,
}: {
  item: SlotItem;
  onRemove: () => void;
  onReplace?: (file: File) => void;
  large?: boolean;
  label?: string;
}) {
  const { url: signed, renew } = useSignedUrl(item.previewUrl ? null : (item.assetId ?? null));
  const url = item.previewUrl ?? signed;
  const replaceId = useId();
  const facts = [fmtSecs(item.durationMs), fmtSize(item.width, item.height)].filter(Boolean).join(" · ");
  // A chosen job (video to extend) is shown through its saved file.
  const moving = item.kind === "video" || (item.kind === "job" && item.mime.startsWith("video/"));
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-canvas", item.status === "error" ? "border-error-on-dark/60" : "border-white/10", large ? "" : "aspect-square")}>
      <div className={cn("relative bg-black/40", large ? "aspect-video" : "absolute inset-0")}>
        {url && item.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL or short-lived signed URL
          <img src={url} alt={label ?? item.name} onError={item.previewUrl ? undefined : renew} className="absolute inset-0 size-full object-cover" />
        ) : null}
        {url && moving ? (
          large ? (
            <video src={url} controls playsInline preload="metadata" className="absolute inset-0 size-full object-contain" aria-label={label ?? item.name} />
          ) : (
            <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" aria-hidden />
          )
        ) : null}
        {item.kind === "audio" ? (
          <span className="absolute inset-0 grid place-items-center text-muted">
            <AudioLines aria-hidden className="size-7" />
          </span>
        ) : null}
        {item.kind === "job" && !url ? (
          <span className="absolute inset-0 grid place-items-center text-muted">
            <Film aria-hidden className="size-7" />
          </span>
        ) : null}
        {item.status === "uploading" ? (
          <span className="absolute inset-0 grid place-items-center bg-black/55">
            <span className="flex flex-col items-center gap-2 text-xs font-semibold text-ink">
              <LoaderCircle aria-hidden className="size-5 animate-spin-slow" />
              {item.progress > 0 && item.progress < 1 ? `${Math.round(item.progress * 100)}%` : "Checking…"}
            </span>
          </span>
        ) : null}
      </div>
      <div className={cn("flex items-center gap-2 bg-surface/90 px-2.5 py-1.5", large ? "" : "absolute inset-x-0 bottom-0")}>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={item.name}>
          {item.status === "error" ? <span className="text-error-on-dark">{item.error}</span> : label ? `${label}${facts ? ` · ${facts}` : ""}` : facts || item.name}
        </span>
        {onReplace && item.status !== "uploading" ? (
          <>
            <label htmlFor={replaceId} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus-ring)]" title="Replace">
              <RefreshCw aria-hidden className="size-3.5" />
              <span className="sr-only">Replace {label ?? item.name}</span>
            </label>
            <input
              id={replaceId}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReplace(f);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
        <button type="button" onClick={onRemove} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink" title="Remove">
          <X aria-hidden className="size-3.5" />
          <span className="sr-only">Remove {label ?? item.name}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Drop area for one or more slots. Files go to the first slot that accepts their type and still has room; the
 * accepted types and limits come from the selected model.
 */
export function DropArea({
  title,
  subtitle,
  kinds,
  accept,
  disabled,
  onFiles,
  size = "md",
  invalid,
}: {
  title: string;
  subtitle: string;
  kinds: ("image" | "video" | "audio")[];
  accept: string[];
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  size?: "md" | "lg";
  invalid?: boolean;
}) {
  const id = useId();
  const [drag, setDrag] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled && e.dataTransfer.files?.length) onFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
        size === "lg" ? "min-h-36 py-5" : "min-h-24 py-3.5",
        drag ? "border-brand-blue-bright bg-[rgb(37_63_246/0.12)]" : invalid ? "border-error-on-dark" : "border-white/15 bg-white/[0.02] hover:border-white/35",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span className="flex -space-x-1.5" aria-hidden>
        {kinds.map((k) => {
          const Icon = ACCEPT_ICON[k];
          return (
            <span key={k} className="grid size-8 place-items-center rounded-lg border border-white/12 bg-raised text-muted">
              <Icon className="size-4" />
            </span>
          );
        })}
      </span>
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="text-[11px] text-muted">{subtitle}</span>
      <input
        id={id}
        type="file"
        multiple
        disabled={disabled}
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

/** A single-input tile (start frame, motion video, character…): empty → drop target; filled → preview. */
export function SingleSlot({
  spec,
  item,
  onFiles,
  onRemove,
  title,
  icon = "plus",
  disabled,
  compact,
  hint,
}: {
  spec: InputSlotSpec;
  item: SlotItem | undefined;
  onFiles: (files: File[]) => void;
  onRemove: () => void;
  title: string;
  icon?: "plus" | "image" | "video";
  disabled?: boolean;
  /** Square tile even for a video (two tiles side by side). */
  compact?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [drag, setDrag] = useState(false);
  if (item) return <InputThumb item={item} label={spec.label} onRemove={onRemove} onReplace={(f) => onFiles([f])} large={spec.kind === "video" && !compact} />;
  const Icon = icon === "video" ? Film : icon === "image" ? ImagePlus : Plus;
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files?.length) onFiles([e.dataTransfer.files[0]]);
      }}
      className={cn(
        "flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-3 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)] sm:aspect-auto sm:min-h-40",
        drag ? "border-brand-blue-bright bg-[rgb(37_63_246/0.12)]" : "border-white/15 bg-white/[0.02] hover:border-white/35",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span className="grid size-9 place-items-center rounded-lg border border-white/12 bg-raised text-muted">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="text-[11px] text-muted">{hint ?? slotHint(spec)}</span>
      <input
        id={id}
        type="file"
        disabled={disabled}
        accept={(spec.mime ?? []).join(",")}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFiles([f]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Revokes local object URLs of items that disappear (keeps memory flat while people swap files). */
export function useRevokeUrls(items: SlotItem[]) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(items.map((i) => i.previewUrl).filter((u): u is string => Boolean(u)));
    for (const u of seen.current) if (!now.has(u)) URL.revokeObjectURL(u);
    seen.current = now;
  }, [items]);
}
