"use client";

import { useEffect, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import type { JobOutput } from "@/lib/live/types";

/** Private output preview: a fresh short-lived signed URL per view, never a public object URL (§16.3). */
export function OutputPreview({ output, alt }: { output: JobOutput; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ url: string }>(`/api/assets/${output.assetId}/download?inline=1`, { method: "POST", body: {} })
      .then((d) => !cancelled && setUrl(d.url))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [output.assetId]);
  const ratio = output.width && output.height ? `${output.width} / ${output.height}` : "3 / 2";
  if (error) return <p className="rounded-2xl border border-white/10 bg-surface p-4 text-sm text-muted">{error}</p>;
  if (!url)
    return (
      <div className="grid w-full place-items-center rounded-[var(--radius-media)] bg-surface" style={{ aspectRatio: ratio, maxHeight: "60vh" }}>
        <LoaderCircle aria-hidden className="size-6 animate-spin-slow text-muted" />
        <span className="sr-only">Loading preview</span>
      </div>
    );
  return output.mime.startsWith("video/") ? (
    // Customer output: controls, no autoplay with sound.
    <video src={url} controls playsInline className="max-h-[70vh] w-full rounded-[var(--radius-media)] bg-black" aria-label={alt} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL; not optimizable
    <img src={url} alt={alt} className="max-h-[70vh] w-full rounded-[var(--radius-media)] object-contain" style={{ aspectRatio: ratio }} />
  );
}

export function DownloadButton({ assetId, label = "Download" }: { assetId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        variant="secondary"
        busy={busy}
        icon={<Download aria-hidden className="size-4" />}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const d = await api<{ url: string }>(`/api/assets/${assetId}/download`, { method: "POST", body: {} });
            window.location.assign(d.url);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {error ? <span className="mt-1 text-xs text-error-on-dark">{error}</span> : null}
    </span>
  );
}
