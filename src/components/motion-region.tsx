"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/format";

const MotionContext = createContext(false);

/** True when the visitor paused moving content in the surrounding region. */
export const useMotionPaused = () => useContext(MotionContext);

/**
 * Wraps auto-moving content (marquees, looping previews) with a visible pause control —
 * WCAG 2.2.2 requires a way to stop motion that lasts longer than five seconds.
 * Hover and focus also pause via CSS (.marquee-pause).
 */
export function MotionRegion({
  children,
  className,
  label = "showcase animation",
  controlClassName,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  controlClassName?: string;
}) {
  const [paused, setPaused] = useState(false);
  return (
    <MotionContext.Provider value={paused}>
      <div className={cn("marquee-pause relative", paused && "marquee-paused", className)}>
        {children}
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className={cn(
            "absolute z-20 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-[rgb(15_18_18/0.7)] px-3 text-xs font-semibold text-ink backdrop-blur-md hover:bg-[rgb(15_18_18/0.9)]",
            controlClassName ?? "right-3 bottom-3",
          )}
        >
          {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
          {paused ? "Play" : "Pause"}
          <span className="sr-only"> {label}</span>
        </button>
      </div>
    </MotionContext.Provider>
  );
}
