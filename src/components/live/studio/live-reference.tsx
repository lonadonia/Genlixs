"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImageUp, LoaderCircle, X } from "lucide-react";
import { api, errorMessage } from "@/lib/live/api";
import { browserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/format";

export type LiveReference =
  | { status: "empty" }
  | { status: "uploading"; name: string; preview: string }
  | { status: "ready"; name: string; preview: string; assetId: string }
  | { status: "error"; message: string };

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX = 10 * 1024 * 1024;

/**
 * Direct-to-Storage reference upload (§16.2): intent → upload to the one authorized path with the customer's
 * session → server verification from bytes. Only a verified asset id can be used in a quote.
 */
export function LiveReferenceUploader({ value, onChange, invalid }: { value: LiveReference; onChange: (r: LiveReference) => void; invalid?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const preview = value.status === "uploading" || value.status === "ready" ? value.preview : null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const upload = async (file: File) => {
    if (!TYPES.includes(file.type)) return onChange({ status: "error", message: "Upload a PNG, JPEG or WebP image." });
    if (file.size > MAX) return onChange({ status: "error", message: "Images can be up to 10 MB." });
    const url = URL.createObjectURL(file);
    onChange({ status: "uploading", name: file.name, preview: url });
    try {
      const intent = await api<{ intentId: string; bucket: string; path: string }>("/api/uploads/intents", {
        body: { purpose: "reference", mime: file.type, bytes: file.size, name: file.name.slice(0, 200) },
      });
      const { error } = await browserClient().storage.from(intent.bucket).upload(intent.path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error("upload");
      const done = await api<{ assetId: string; state: string }>(`/api/uploads/${intent.intentId}/finalize`, { method: "POST", body: {} });
      onChange({ status: "ready", name: file.name, preview: url, assetId: done.assetId });
    } catch (e) {
      onChange({ status: "error", message: e instanceof Error && e.message === "upload" ? "The upload did not finish. Try again." : errorMessage(e) });
    }
  };

  return (
    <div>
      <p id={`${id}-l`} className="mb-2 text-sm font-semibold text-ink">
        Reference image
      </p>
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-raised">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt={`Reference: ${value.status !== "empty" && "name" in value ? value.name : ""}`} className="max-h-56 w-full object-contain" />
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs text-muted">
            <span className="min-w-0 truncate">
              {value.status === "uploading" ? (
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin-slow" /> Uploading and checking…
                </span>
              ) : (
                "Checked and ready"
              )}
            </span>
            <button type="button" onClick={() => onChange({ status: "empty" })} className="inline-flex h-8 items-center gap-1 rounded-full px-2 font-semibold text-ink hover:bg-white/[0.06]">
              <X aria-hidden className="size-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={`${id}-f`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          className={cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-center text-sm",
            drag ? "border-brand-blue-bright bg-[rgb(37_63_246/0.12)]" : invalid ? "border-error-on-dark" : "border-line-strong bg-raised hover:border-white/40",
          )}
        >
          <ImageUp aria-hidden className="size-6 text-muted" />
          <span className="font-semibold text-ink">Choose or drop an image</span>
          <span className="text-xs text-muted">PNG, JPEG or WebP · up to 10 MB · kept privately for 7 days</span>
        </label>
      )}
      <input
        ref={input}
        id={`${id}-f`}
        type="file"
        accept={TYPES.join(",")}
        aria-labelledby={`${id}-l`}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {value.status === "error" ? (
        <p role="alert" className="mt-1.5 text-sm text-error-on-dark">
          {value.message}
        </p>
      ) : invalid ? (
        <p className="mt-1.5 text-sm text-error-on-dark">{invalid}</p>
      ) : null}
    </div>
  );
}
