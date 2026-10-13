"use client";

import Image from "next/image";
import { useId, useRef, useState, type DragEvent } from "react";
import { CircleX, ImagePlus, LoaderCircle, RefreshCw, Trash } from "lucide-react";
import { MEDIA } from "@/lib/media";
import { cn } from "@/lib/format";

export type Reference =
  | { status: "empty" }
  | { status: "validating"; name: string }
  | { status: "failed"; name: string; error: string }
  | { status: "accepted"; name: string; type: string; size: number; url: string; sample?: boolean };

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX = 10 * 1024 * 1024;

const sizeLabel = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Reference uploader (guide §08 "Image editing", §11 "Uploader"):
 * drop or click, requirements, validation, preview, Replace and Remove.
 * Preview build: the file stays in this browser tab and is never uploaded.
 */
export function ReferenceUploader({ value, onChange, invalid }: { value: Reference; onChange: (r: Reference) => void; invalid?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const reqId = `${id}-req`;
  const errId = `${id}-err`;

  const accept = (file: File) => {
    if (value.status === "accepted" && !value.sample) URL.revokeObjectURL(value.url);
    onChange({ status: "validating", name: file.name });
    window.setTimeout(() => {
      if (!ACCEPT.includes(file.type)) {
        onChange({ status: "failed", name: file.name, error: "Use a PNG, JPEG or WebP image." });
        return;
      }
      if (file.size > MAX) {
        onChange({ status: "failed", name: file.name, error: `This file is ${sizeLabel(file.size)}. The limit is 10 MB.` });
        return;
      }
      onChange({ status: "accepted", name: file.name, type: file.type.replace("image/", "").toUpperCase(), size: file.size, url: URL.createObjectURL(file) });
    }, 500);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) accept(f);
  };

  const useSample = () =>
    onChange({ status: "accepted", name: "dunes-midday.jpg", type: "JPEG", size: 177_509, url: MEDIA.dunesNoon.src, sample: true });

  const fileInput = (
    <input
      ref={input}
      id={id}
      type="file"
      accept={ACCEPT.join(",")}
      className="sr-only"
      aria-describedby={cn(reqId, invalid && errId) || undefined}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) accept(f);
        e.target.value = "";
      }}
    />
  );

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink">
        Reference image <span className="font-normal text-muted">(required)</span>
      </p>

      {value.status === "accepted" ? (
        <div className="flex gap-3 rounded-[var(--radius-control)] border border-line-strong bg-raised p-3">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-[8px] border border-line bg-canvas">
            <Image src={value.url} alt={`Reference: ${value.name}`} fill sizes="80px" className="object-cover" unoptimized={!value.sample} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p className="text-xs text-muted">
              {value.type} · {sizeLabel(value.size)} · {value.sample ? "Sample reference" : "Kept in this browser"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <label
                htmlFor={id}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 text-xs font-semibold text-ink hover:bg-surface has-[:focus-visible]:outline-2"
              >
                <RefreshCw aria-hidden className="size-3.5" /> Replace
                {fileInput}
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!value.sample) URL.revokeObjectURL(value.url);
                  onChange({ status: "empty" });
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 text-xs font-semibold text-ink hover:bg-surface"
              >
                <Trash aria-hidden className="size-3.5" /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-[var(--radius-control)] border border-dashed p-4 text-center transition-colors",
            over ? "border-link bg-[rgb(28_93_255/0.1)]" : invalid || value.status === "failed" ? "border-error-on-dark" : "border-line-strong bg-raised/50",
          )}
        >
          {value.status === "validating" ? (
            <p role="status" className="flex items-center justify-center gap-2 py-4 text-sm text-muted">
              <LoaderCircle aria-hidden className="size-4 animate-spin-slow" /> Checking {value.name}…
            </p>
          ) : (
            <>
              <ImagePlus aria-hidden className="mx-auto size-6 text-link" />
              <p className="mt-2 text-sm text-ink">
                <label htmlFor={id} className="cursor-pointer font-semibold text-link underline-offset-2 hover:underline has-[:focus-visible]:outline-2">
                  Choose a file
                  {fileInput}
                </label>{" "}
                or drop it here
              </p>
              <p id={reqId} className="mt-1 text-xs text-muted">
                PNG, JPEG or WebP · up to 10 MB · preview keeps it in this browser
              </p>
              <button type="button" onClick={useSample} className="mt-3 text-xs font-semibold text-link underline underline-offset-2">
                Use the sample reference instead
              </button>
            </>
          )}
        </div>
      )}

      {value.status === "failed" ? (
        <p id={errId} className="mt-2 flex items-start gap-1.5 text-sm text-error-on-dark">
          <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {value.name}: {value.error}
          </span>
        </p>
      ) : invalid ? (
        <p id={errId} className="mt-2 flex items-start gap-1.5 text-sm text-error-on-dark">
          <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
          {invalid}
        </p>
      ) : null}
    </div>
  );
}
