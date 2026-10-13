"use client";

import { useEffect, useRef } from "react";
import { useMotionPaused } from "@/components/motion-region";
import { MEDIA, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

const motionAllowed = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduce && !saveData;
};

/**
 * Muted, looping preview that only plays while visible, while its region isn't paused,
 * and only when the visitor allows motion and isn't saving data (guide §07, §12).
 * Never has audio. Without JS, or with reduced motion, it shows its poster.
 */
export function AutoplayVideo({
  media,
  className,
  label,
  decorative,
}: {
  media: MediaKey;
  className?: string;
  label?: string;
  /** Ambient background loop: hidden from assistive technology. */
  decorative?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useRef(false);
  const paused = useMotionPaused();
  const m = MEDIA[media];

  useEffect(() => {
    const v = ref.current;
    if (!v || !motionAllowed()) return;
    const io = new IntersectionObserver(
      ([e]) => {
        inView.current = e.isIntersecting;
        if (e.isIntersecting && !v.closest(".marquee-paused")) v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(v);
    const onVis = () => document.hidden && v.pause();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (paused) v.pause();
    else if (inView.current && motionAllowed()) v.play().catch(() => undefined);
  }, [paused]);

  return (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      poster={m.kind === "video" ? m.poster : m.src}
      aria-label={decorative ? undefined : (label ?? m.alt)}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      className={cn("block h-full w-full object-cover", className)}
    >
      {m.kind === "video" ? <source src={m.src} type="video/mp4" /> : null}
    </video>
  );
}
