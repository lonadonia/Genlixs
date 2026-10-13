"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { cn } from "@/lib/format";
import { ConceptTag } from "./ui/badge";

/**
 * Before/after comparison: direct drag via a native range input (keyboard
 * accessible) plus discrete buttons for touch and keyboard users (guide §08, §12).
 */
export function CompareSlider({
  before,
  after,
  beforeAlt,
  afterAlt,
  beforeLabel = "Original",
  afterLabel = "Edited",
  aspect = "aspect-[3/2]",
  concept = true,
  sizes = "(min-width: 1024px) 60vw, 100vw",
  className,
}: {
  before: string;
  after: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel?: string;
  afterLabel?: string;
  aspect?: string;
  concept?: boolean;
  sizes?: string;
  className?: string;
}) {
  const [pos, setPos] = useState(50);
  const id = useId();

  return (
    <div className={className}>
      <div className={cn("compare-wrap relative overflow-hidden rounded-[var(--radius-media)] border border-white/[0.08] bg-raised select-none", aspect)}>
        <Image src={after} alt={afterAlt} fill sizes={sizes} className="object-cover" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <Image src={before} alt={beforeAlt} fill sizes={sizes} className="object-cover" />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgb(15_18_18/0.35)]" style={{ left: `calc(${pos}% - 1px)` }}>
          <span className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand-blue text-white shadow-[0_8px_24px_-6px_rgb(0_0_0/0.6)]">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 5-3 4 3 4M12 5l3 4-3 4" />
            </svg>
          </span>
        </div>
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[rgb(15_18_18/0.78)] px-2.5 py-1 text-xs font-semibold text-ink backdrop-blur-md">{beforeLabel}</span>
        <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[rgb(15_18_18/0.78)] px-2.5 py-1 text-xs font-semibold text-ink backdrop-blur-md">{afterLabel}</span>
        {concept ? <ConceptTag className="pointer-events-none absolute top-3 left-3" /> : null}
        <label htmlFor={id} className="sr-only">
          Comparison position: drag or use arrow keys to reveal {beforeLabel.toLowerCase()} or {afterLabel.toLowerCase()}
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-valuetext={`${pos}% ${beforeLabel.toLowerCase()} visible`}
          className="compare-range absolute inset-0 h-full w-full opacity-0"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Comparison view">
        {[
          { v: 100, label: `Show ${beforeLabel.toLowerCase()}` },
          { v: 50, label: "Split view" },
          { v: 0, label: `Show ${afterLabel.toLowerCase()}` },
        ].map((b) => (
          <button
            key={b.v}
            type="button"
            aria-pressed={pos === b.v}
            onClick={() => setPos(b.v)}
            className={cn(
              "h-10 rounded-full border px-4 text-sm font-semibold transition-colors",
              pos === b.v ? "border-brand-blue bg-brand-blue text-white" : "border-white/20 bg-white/[0.04] text-ink hover:border-white/45",
            )}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
