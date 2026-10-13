"use client";

import Image from "next/image";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { EXAMPLES, TOOLS, modelById, type Example } from "@/lib/catalog";
import { MEDIA } from "@/lib/media";
import { cn } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { ConceptTag } from "@/components/ui/badge";
import { MediaFrame } from "@/components/ui/media-frame";
import { UsePromptButton } from "./prompt-buttons";

const STORY_IDS = ["ex-dunes", "ex-edit-dusk", "ex-aurora-clip"];

function settingRows(ex: Example): [string, string][] {
  const m = modelById(ex.settings.modelId);
  const rows: [string, string][] = [
    ["Tool", TOOLS[ex.tool].label],
    ["Model", m?.name ?? "—"],
    ["Ratio", ex.settings.ratio === "Original" ? "Keeps reference ratio" : ex.settings.ratio],
  ];
  if (ex.settings.quality) rows.push(["Quality", ex.settings.quality]);
  if (ex.settings.duration) rows.push(["Length", `${ex.settings.duration} seconds`]);
  if (ex.settings.resolution) rows.push(["Resolution", ex.settings.resolution]);
  return rows;
}

export function StoryTabs() {
  const stories = STORY_IDS.map((id) => EXAMPLES.find((e) => e.id === id)!);
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ex = stories[active];

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    let n: number | null = null;
    if (e.key === "ArrowRight") n = (active + 1) % stories.length;
    if (e.key === "ArrowLeft") n = (active - 1 + stories.length) % stories.length;
    if (n !== null) {
      e.preventDefault();
      setActive(n);
      refs.current[n]?.focus();
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="Prompt-to-result examples" className="flex gap-1.5 overflow-x-auto pb-1">
        {stories.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-t${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-p`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKey}
            className={cn(
              "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
              i === active ? "border-brand-blue bg-[rgb(28_93_255/0.16)] text-link" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {TOOLS[s.tool].label}
          </button>
        ))}
      </div>

      <div id={`${base}-p`} role="tabpanel" aria-labelledby={`${base}-t${active}`} className="mt-6 grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <div className="rounded-[var(--radius-media)] border border-line bg-surface p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Input</p>
            {ex.reference ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="relative aspect-[3/2] w-28 shrink-0 overflow-hidden rounded-[10px] border border-line">
                  <Image src={MEDIA[ex.reference].src} alt={MEDIA[ex.reference].alt} fill sizes="112px" className="object-cover" />
                </div>
                <p className="text-sm text-muted">Reference image, kept as the original version.</p>
              </div>
            ) : null}
            <blockquote className="mt-3 border-l-2 border-brand-lime pl-4 text-[17px] leading-relaxed text-ink">“{ex.prompt}”</blockquote>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-5 text-sm">
              {settingRows(ex).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <UsePromptButton exampleId={ex.id} look="solid" context={ex.title} />
              <CopyButton value={ex.prompt} label="Copy prompt" />
            </div>
          </div>
        </div>
        <div className="lg:col-span-7">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Output · {ex.title}</p>
          {ex.tool === "video" ? (
            <div className="relative overflow-hidden rounded-[var(--radius-media)] border border-line bg-black">
              <video
                controls
                playsInline
                preload="none"
                poster={MEDIA.auroraClip.poster}
                className="block aspect-video w-full"
                aria-label={MEDIA.auroraClip.alt}
              >
                <source src={MEDIA.auroraClip.src} type="video/mp4" />
              </video>
              <ConceptTag className="pointer-events-none absolute top-3 left-3" />
            </div>
          ) : (
            <MediaFrame media={ex.media} ratio="3:2" sizes="(min-width: 1024px) 55vw, 100vw" />
          )}
        </div>
      </div>
    </div>
  );
}
