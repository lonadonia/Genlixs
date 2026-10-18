"use client";

import { useRef } from "react";
import { Aperture, BookOpen, FolderClosed } from "lucide-react";
import { cn } from "@/lib/format";
import type { CanvasView } from "@/lib/studio-routes";

export type { CanvasView };

export const CANVAS_VIEWS: { id: CanvasView; label: string; icon: typeof FolderClosed }[] = [
  { id: "history", label: "History", icon: FolderClosed },
  { id: "library", label: "Motion Library", icon: Aperture },
  { id: "how", label: "How it works", icon: BookOpen },
];

/** History / Motion Library / How it works above the video canvas. Arrow keys, Home and End move between them. */
export function CanvasTabs({ value, onChange }: { value: CanvasView; onChange: (v: CanvasView) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = CANVAS_VIEWS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(CANVAS_VIEWS[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Studio views" className="scroll-none -mx-1 flex items-center gap-1 overflow-x-auto px-1 py-0.5">
      {CANVAS_VIEWS.map((v, i) => {
        const on = v.id === value;
        const Icon = v.icon;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`canvas-tab-${v.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`canvas-panel-${v.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(v.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold whitespace-nowrap transition-colors",
              on ? "control-raised bg-elevated text-ink ring-1 ring-white/[0.08] ring-inset" : "text-muted hover:bg-white/[0.04] hover:text-ink",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
