"use client";

import Image from "next/image";
import { useState } from "react";
import { ChevronDown, Download, Heart, Link2, RotateCcw, Share2, Trash, ZoomIn } from "lucide-react";
import { CompareSlider } from "@/components/compare-slider";
import { Badge, ConceptTag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { TOOLS, modelById, settingsSummary } from "@/lib/catalog";
import { updateJob, type Job } from "@/lib/demo-store";
import { cn, fmtCredits, fmtDateTime } from "@/lib/format";
import { MEDIA, stillOf, type MediaItem, type MediaKey } from "@/lib/media";

export const outputRatioClass = (job: Job) => {
  if (job.tool === "video") return job.settings.ratio === "9:16" ? "aspect-[9/16]" : job.settings.ratio === "1:1" ? "aspect-square" : "aspect-video";
  return (
    { "1:1": "aspect-square", "2:3": "aspect-[2/3]", "9:16": "aspect-[9/16]", "16:9": "aspect-video", "4:5": "aspect-[4/5]" }[job.settings.ratio] ??
    "aspect-[3/2]"
  );
};

export function ResultMedia({ job, uploadedRef, sizes = "(min-width: 1024px) 60vw, 100vw", maxH = "max-h-[62vh]" }: { job: Job; uploadedRef?: string | null; sizes?: string; maxH?: string }) {
  const [zoom, setZoom] = useState(false);
  const m = MEDIA[job.media];
  const clip: MediaKey = m.kind === "video" ? job.media : "auroraClip";

  if (job.tool === "video") {
    return (
      <div className="relative mx-auto w-full overflow-hidden rounded-[var(--radius-media)] border border-white/[0.08] bg-black">
        <video controls playsInline preload="metadata" poster={stillOf(clip)} className={cn("mx-auto block w-full", maxH)} aria-label={`Your clip: ${job.title}`}>
          <source src={MEDIA[clip].src} type="video/mp4" />
        </video>
        <ConceptTag className="pointer-events-none absolute top-3 left-3" label={MEDIA[clip].placeholder ? undefined : "Sample"} />
      </div>
    );
  }

  if (job.tool === "edit" && job.referenceMedia) {
    const ref = uploadedRef ?? MEDIA[job.referenceMedia].src;
    return (
      <CompareSlider
        before={ref}
        after={m.src}
        beforeAlt={`Original reference for ${job.title}`}
        afterAlt={`Edited result: ${m.alt}`}
        beforeLabel="Original · v0"
        afterLabel="Edit · v1"
        sizes={sizes}
      />
    );
  }

  return (
    <>
      <div className={cn("relative mx-auto overflow-hidden rounded-[var(--radius-media)] border border-white/[0.08] bg-raised", outputRatioClass(job), job.settings.ratio === "9:16" || job.settings.ratio === "2:3" ? "max-w-[min(100%,26rem)]" : "w-full")}>
        <Image src={m.src} alt={`Your result: ${m.alt}`} fill sizes={sizes} className="object-cover" />
        <ConceptTag className="absolute top-3 left-3" label={m.placeholder ? undefined : "Sample"} />
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="absolute right-3 bottom-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-[rgb(15_18_18/0.7)] px-3 text-xs font-semibold text-ink backdrop-blur-md hover:bg-[rgb(15_18_18/0.92)]"
        >
          <ZoomIn aria-hidden className="size-4" /> Zoom
        </button>
      </div>
      <Dialog open={zoom} onClose={() => setZoom(false)} title={job.title} description="Press Escape or Close to return." size="xl">
        <div className="relative">
          <Image src={m.src} alt={`Your result at full size: ${m.alt}`} width={m.width} height={m.height} sizes="90vw" className="h-auto w-full rounded-2xl" />
        </div>
      </Dialog>
    </>
  );
}

export function ResultActions({ job, onReuse, compact }: { job: Job; onReuse?: () => void; compact?: boolean }) {
  const [share, setShare] = useState(false);
  const [del, setDel] = useState(false);
  const m = MEDIA[job.media];
  const ext = m.kind === "video" ? "mp4" : "jpg";

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
        <a
          href={m.src}
          download={`genlixs-${job.id}.${ext}`}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand-blue px-4 text-sm font-semibold text-white hover:bg-brand-blue-hover"
        >
          <Download aria-hidden className="size-4" /> Download original
        </a>
        {onReuse ? (
          <Button variant="secondary" size="sm" className="h-10" onClick={onReuse} icon={<RotateCcw aria-hidden className="size-4" />}>
            Reuse settings
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="h-10"
          aria-pressed={Boolean(job.favorite)}
          onClick={() => updateJob(job.id, { favorite: !job.favorite })}
          icon={<Heart aria-hidden className={cn("size-4", job.favorite && "fill-brand-blue-bright text-brand-blue-bright")} />}
        >
          {job.favorite ? "Favorited" : "Favorite"}
        </Button>
        <Button variant="secondary" size="sm" className="h-10" onClick={() => setShare(true)} icon={<Share2 aria-hidden className="size-4" />}>
          {job.shareUrl ? "Shared" : "Share"}
        </Button>
        <Button variant="ghost" size="sm" className="h-10" onClick={() => setDel(true)} icon={<Trash aria-hidden className="size-4" />}>
          Delete
        </Button>
      </div>

      <Dialog
        open={share}
        onClose={() => setShare(false)}
        title={job.shareUrl ? "Public link is on" : "Create a public link?"}
        description={job.shareUrl ? "Anyone with this link can view the result." : "Results are private by default. A public link lets anyone who has it view this result."}
        footer={
          job.shareUrl ? (
            <>
              <Button variant="secondary" onClick={() => setShare(false)}>
                Done
              </Button>
              <Button variant="danger" onClick={() => updateJob(job.id, { shareUrl: undefined })}>
                Revoke link
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setShare(false)}>
                Keep private
              </Button>
              <Button onClick={() => updateJob(job.id, { shareUrl: `https://genlixs.example/s/${job.id.toLowerCase()}` })} icon={<Link2 aria-hidden className="size-4" />}>
                Create public link
              </Button>
            </>
          )
        }
      >
        {job.shareUrl ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={job.shareUrl} aria-label="Public link" className="h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-raised px-4 text-sm text-ink" />
              <CopyButton value={job.shareUrl} label="Copy link" />
            </div>
            <p className="text-sm text-muted">Revoking stops the link working immediately. The result stays in your library.</p>
            <p className="text-xs text-muted">Preview: links use the reserved example.com domain and do not resolve.</p>
          </div>
        ) : (
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>The link shows the result file and its title.</li>
            <li>Your prompt, settings and account details are not shown.</li>
            <li>You can revoke the link at any time from here or your library.</li>
          </ul>
        )}
      </Dialog>

      <Dialog
        open={del}
        onClose={() => setDel(false)}
        title="Delete this result?"
        description="This removes the file and its versions from your library."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                updateJob(job.id, { removed: true, shareUrl: undefined, favorite: false });
                setDel(false);
              }}
            >
              Delete file
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The job and credit record ({job.id}, {fmtCredits(job.credits)}) stay in your credit history because they are needed for billing. Any public link is
          revoked.
        </p>
      </Dialog>
    </>
  );
}

export function ResultDetails({ job, defaultOpen }: { job: Job; defaultOpen?: boolean }) {
  const model = modelById(job.settings.modelId);
  const clipMeta: MediaItem = MEDIA[MEDIA[job.media].kind === "video" ? job.media : "auroraClip"];
  return (
    <details open={defaultOpen} className="group rounded-[20px] border border-white/[0.08] bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 text-sm font-semibold text-ink">
        Prompt, settings and job record
        <ChevronDown aria-hidden className="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-white/[0.07] px-4 py-4 text-sm">
        <p className="text-muted">Prompt</p>
        <p className="mt-1 text-ink">“{job.prompt}”</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Row k="Tool" v={TOOLS[job.tool].label} />
          <Row k="Model" v={model?.name ?? "—"} />
          <Row k="Settings" v={settingsSummary(job.settings)} />
          <Row k="Created" v={fmtDateTime(job.createdAt)} />
          <Row k="Job ID" v={<span className="font-mono text-xs">{job.id}</span>} />
          <Row
            k="Credits"
            v={
              job.settled === "charged" ? (
                <Badge tone="neutral" icon="none">
                  {fmtCredits(job.credits)} charged
                </Badge>
              ) : job.settled === "returned" ? (
                <Badge tone="success">{fmtCredits(job.credits)} returned</Badge>
              ) : (
                <Badge tone="info" icon="pending">
                  {fmtCredits(job.credits)} reserved
                </Badge>
              )
            }
          />
          <Row k="Visibility" v={job.shareUrl ? <Badge tone="attention" icon="none">Public link on</Badge> : "Private"} />
          <Row
            k="Output"
            v={
              job.tool === "video"
                ? `MP4 · ${clipMeta.width}×${clipMeta.height} · ${clipMeta.duration ?? 5}s · no audio (delivered)`
                : `${MEDIA[job.media].width}×${MEDIA[job.media].height} JPEG (delivered)`
            }
          />
        </dl>
      </div>
    </details>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{k}</dt>
      <dd className="mt-0.5 break-words text-ink">{v}</dd>
    </div>
  );
}
