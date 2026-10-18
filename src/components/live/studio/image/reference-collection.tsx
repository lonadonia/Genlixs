"use client";

import { useId, useState } from "react";
import { ImagePlus, LoaderCircle, Plus, RotateCcw, X } from "lucide-react";
import { countedRefs, type RefItem, type RefLimit } from "@/lib/live/references";
import { cn } from "@/lib/format";
import { useSignedUrl } from "../preview/signed-media";

const typeList = (mime: string[]) => mime.map((m) => m.split("/")[1]?.replace("jpeg", "JPG").toUpperCase()).join(", ");

/**
 * Reference images for Image Edit: several files at once, later selections append, order is kept (the numbers are
 * the order sent to the model), and each image can be removed or retried. The limit shown is the selected model's.
 */
export function ReferenceCollection({
  limit,
  items,
  onAdd,
  onRemove,
  onRetry,
  notice,
  disabled,
}: {
  limit: RefLimit;
  items: RefItem[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  onRetry?: (key: string) => void;
  notice?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [drag, setDrag] = useState(false);
  const counted = countedRefs(items).length;
  const room = limit.max - counted;
  const multiple = limit.max > 1;
  const pick = (files: FileList | null | undefined) => {
    if (files?.length) onAdd([...files]);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <p id={`${id}-l`} className="text-[13px] font-semibold text-ink">
          {multiple ? "Images to edit" : "Image to edit"}
        </p>
        <p className={cn("text-[11px] tabular", counted > limit.max ? "font-semibold text-orange-on-dark" : "text-muted")} aria-live="polite">
          {counted} / {limit.max}
        </p>
      </div>

      {items.length === 0 ? (
        <label
          htmlFor={`${id}-f`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!disabled) pick(e.dataTransfer.files);
          }}
          className={cn(
            "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-4 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
            drag ? "border-brand-blue-bright bg-[rgb(37_63_246/0.12)]" : "border-white/15 bg-white/[0.02] hover:border-white/35",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          <span className="grid size-9 place-items-center rounded-lg border border-white/12 bg-raised text-muted">
            <ImagePlus aria-hidden className="size-4" />
          </span>
          <span className="text-[13px] font-semibold text-ink">{multiple ? "Add images" : "Add an image"}</span>
          <span className="text-[11px] text-muted">
            {typeList(limit.mime)} · up to {Math.round(limit.maxBytes / 1048576)} MB each{multiple ? ` · up to ${limit.max} images` : ""}
          </span>
        </label>
      ) : (
        <ul aria-labelledby={`${id}-l`} className="grid grid-cols-4 gap-1.5">
          {items.map((it, i) => (
            <li key={it.key}>
              <Thumb item={it} index={i} total={items.length} onRemove={() => onRemove(it.key)} onRetry={onRetry ? () => onRetry(it.key) : undefined} />
            </li>
          ))}
          {room > 0 ? (
            <li>
              <label
                htmlFor={`${id}-f`}
                className={cn(
                  "grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-white/15 text-muted transition-colors hover:border-white/35 hover:text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                  disabled && "pointer-events-none opacity-60",
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!disabled) pick(e.dataTransfer.files);
                }}
              >
                <Plus aria-hidden className="size-5" />
                <span className="sr-only">Add more images ({room} left)</span>
              </label>
            </li>
          ) : null}
        </ul>
      )}
      <input
        id={`${id}-f`}
        type="file"
        multiple={multiple}
        disabled={disabled}
        accept={limit.mime.join(",")}
        aria-labelledby={`${id}-l`}
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      {multiple && items.length > 1 ? <p className="px-0.5 text-[11px] text-muted">Images are sent in this order; refer to them as image 1, image 2… in the prompt.</p> : null}
      {notice ? (
        <p role="status" className="rounded-lg bg-[rgb(255_181_71/0.08)] px-2.5 py-1.5 text-xs text-orange-on-dark">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function Thumb({ item, index, total, onRemove, onRetry }: { item: RefItem; index: number; total: number; onRemove: () => void; onRetry?: () => void }) {
  const { url: signed } = useSignedUrl(item.previewUrl ? null : (item.assetId ?? null));
  const url = item.previewUrl ?? signed;
  return (
    <div
      className={cn("group relative aspect-square overflow-hidden rounded-lg border bg-canvas", item.status === "error" ? "border-error-on-dark/70" : "border-white/10")}
      title={item.status === "error" ? item.error : item.name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or short-lived signed URL
        <img src={url} alt={`Image ${index + 1} of ${total}: ${item.name}`} className="absolute inset-0 size-full object-cover" />
      ) : null}
      <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-md bg-black/65 text-[10px] font-bold text-white tabular">{index + 1}</span>
      {item.status === "uploading" ? (
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-[10px] font-semibold text-ink">
          <span className="flex flex-col items-center gap-1">
            <LoaderCircle aria-hidden className="size-4 animate-spin-slow" />
            {item.progress > 0 && item.progress < 1 ? `${Math.round(item.progress * 100)}%` : "Checking"}
          </span>
        </span>
      ) : null}
      {item.status === "error" ? (
        <span className="absolute inset-x-0 bottom-0 bg-[rgb(40_10_12/0.85)] px-1 py-0.5 text-center text-[9px] leading-tight text-error-on-dark">Not added</span>
      ) : null}
      <span className="absolute top-1 right-1 flex gap-0.5">
        {item.status === "error" && onRetry ? (
          <button type="button" onClick={onRetry} className="grid size-6 place-items-center rounded-md bg-black/70 text-white hover:bg-black">
            <RotateCcw aria-hidden className="size-3" />
            <span className="sr-only">Retry image {index + 1}</span>
          </button>
        ) : null}
        <button type="button" onClick={onRemove} className="grid size-6 place-items-center rounded-md bg-black/70 text-white hover:bg-black">
          <X aria-hidden className="size-3.5" />
          <span className="sr-only">
            Remove image {index + 1} ({item.name})
          </span>
        </button>
      </span>
    </div>
  );
}
