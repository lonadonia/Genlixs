"use client";

import Image from "next/image";
import { useState } from "react";
import { Clapperboard } from "lucide-react";
import { ShowcaseVideo } from "@/components/ui/showcase-video";
import { MEDIA, SHOWCASE, type MediaItem, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

type Filter = "all" | "video" | "image";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Videos" },
  { id: "image", label: "Images" },
];

/** First screenful; the rest loads on request so the page stays light. */
const FIRST = 24;

const countOf = (f: Filter) => SHOWCASE.filter((k) => f === "all" || MEDIA[k].kind === f).length;

/**
 * Masonry wall of every client image and clip. Each card keeps its file's own ratio, clips
 * play muted while on screen and turn their sound on with one click.
 */
export function ShowcaseWall() {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const items = SHOWCASE.filter((k) => filter === "all" || MEDIA[k].kind === filter);
  const shown = expanded ? items : items.slice(0, FIRST);

  return (
    <div>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              filter === f.id ? "border-brand-blue bg-brand-blue text-white" : "border-white/15 text-muted hover:border-white/30 hover:text-ink",
            )}
          >
            {f.label}
            <span className="tabular text-xs font-medium">{countOf(f.id)}</span>
          </button>
        ))}
      </div>

      <ul className="mt-8 columns-2 gap-3 sm:gap-4 md:columns-3 xl:columns-4">
        {shown.map((k) => (
          <ShowcaseCard key={k} k={k} />
        ))}
      </ul>

      {items.length > shown.length ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex h-12 items-center rounded-full border border-white/20 bg-white/[0.04] px-6 text-[15px] font-semibold text-ink transition-colors hover:border-brand-blue hover:bg-brand-blue hover:text-white"
          >
            Show all {items.length}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ShowcaseCard({ k }: { k: MediaKey }) {
  const m: MediaItem = MEDIA[k];
  const isClip = m.kind === "video";
  return (
    <li className="mb-3 break-inside-avoid sm:mb-4">
      <div className="group relative overflow-hidden rounded-[18px] border border-white/[0.08] bg-raised" style={{ aspectRatio: `${m.width} / ${m.height}` }}>
        {isClip ? (
          <ShowcaseVideo media={k} className="absolute inset-0" controlClassName="top-3 right-3" />
        ) : (
          <Image src={m.src} alt={m.alt} fill sizes="(min-width: 1280px) 24vw, (min-width: 768px) 32vw, 48vw" className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
        )}
        {isClip ? (
          <span className="pointer-events-none absolute top-3 left-3 z-[2] inline-flex h-7 items-center gap-1.5 rounded-full bg-[rgb(15_18_18/0.62)] px-2.5 text-[11px] font-semibold text-white tabular backdrop-blur-md">
            <Clapperboard aria-hidden className="size-3.5" />
            <span className="sr-only">Clip, </span>0:{String(m.duration ?? 0).padStart(2, "0")}
          </span>
        ) : null}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-[rgb(15_18_18/0.85)] to-transparent px-3.5 pt-12 pb-3 text-[13px] font-semibold text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {m.title}
        </div>
      </div>
    </li>
  );
}
