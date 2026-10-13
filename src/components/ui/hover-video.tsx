"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { MEDIA, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

const motionAllowed = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduce && !saveData;
};

/**
 * Gallery clip: shows its poster, plays a muted preview while the card is hovered or focused,
 * and keeps an explicit Play/Pause button for touch and keyboard users (guide §07).
 * The file only loads when playback starts; it never has sound.
 */
export function HoverVideo({
  media,
  className,
  label,
  controlClassName = "top-3 right-3",
}: {
  media: MediaKey;
  className?: string;
  label: string;
  controlClassName?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const m = MEDIA[media];

  useEffect(() => {
    const v = ref.current;
    const card = v?.closest<HTMLElement>("[data-hover-play]");
    if (!v || !card) return;
    const start = () => motionAllowed() && v.play().catch(() => undefined);
    const stop = () => v.pause();
    const onFocusOut = (e: FocusEvent) => {
      if (!card.contains(e.relatedTarget as Node | null)) stop();
    };
    card.addEventListener("pointerenter", start);
    card.addEventListener("pointerleave", stop);
    card.addEventListener("focusin", start);
    card.addEventListener("focusout", onFocusOut);
    const io = new IntersectionObserver(([e]) => !e.isIntersecting && stop());
    io.observe(v);
    const onVis = () => document.hidden && stop();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      card.removeEventListener("pointerenter", start);
      card.removeEventListener("pointerleave", stop);
      card.removeEventListener("focusin", start);
      card.removeEventListener("focusout", onFocusOut);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={m.kind === "video" ? m.poster : m.src}
        aria-label={m.alt}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={cn("block h-full w-full object-cover", className)}
      >
        {m.kind === "video" ? <source src={m.src} type="video/mp4" /> : null}
      </video>
      <button
        type="button"
        onClick={() => {
          const v = ref.current;
          if (!v) return;
          if (v.paused) v.play().catch(() => undefined);
          else v.pause();
        }}
        className={cn("absolute z-10 grid size-10 place-items-center rounded-full border border-white/25 bg-[rgb(15_18_18/0.6)] text-white backdrop-blur-md transition-colors hover:bg-brand-blue hover:text-white", controlClassName)}
      >
        {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="ml-0.5 size-4" />}
        <span className="sr-only">
          {playing ? "Pause" : "Play"} preview: {label}
        </span>
      </button>
    </>
  );
}
