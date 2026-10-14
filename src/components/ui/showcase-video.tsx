"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useMotionPaused } from "@/components/motion-region";
import { MEDIA, type MediaItem, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

/** Fired when a clip turns its sound on, so every other clip mutes (one voice at a time). */
const SOUND_EVENT = "genlixs:clip-sound";

const motionAllowed = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduce && !saveData;
};

/**
 * Site-wide clip: plays muted and looping while it is on screen, so the page always shows motion.
 * One click or tap anywhere on the clip turns its sound on; a second one mutes it again. Only one
 * clip is audible at a time, and a clip that leaves the screen pauses and goes back to muted.
 * Clips without a sound track toggle play/pause instead. With reduced motion or Save-Data the
 * clip waits on its poster until pressed (guide §07, §12).
 */
export function ShowcaseVideo({
  media,
  label,
  className,
  controlClassName = "right-3 bottom-3",
  compact,
  focusable = true,
}: {
  media: MediaKey;
  /** Short name used in the button label; defaults to the manifest title. */
  label?: string;
  className?: string;
  controlClassName?: string;
  /** Smaller control for narrow tiles (hero columns, strips). */
  compact?: boolean;
  /** False for visual duplicates (marquee loop copies): mouse still works, keyboard skips it. */
  focusable?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useRef(false);
  const id = useId();
  const regionPaused = useMotionPaused();
  const pausedRef = useRef(regionPaused);
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(false);
  const m: MediaItem = MEDIA[media];
  const hasAudio = m.kind === "video" && !!m.audio;
  const name = label ?? m.title ?? m.alt;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const mute = () => {
      v.muted = true;
      setSound(false);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        inView.current = e.isIntersecting;
        if (e.isIntersecting) {
          if (motionAllowed() && !pausedRef.current) v.play().catch(() => undefined);
        } else {
          v.pause();
          mute();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    const onVis = () => {
      if (document.hidden) v.pause();
      else if (inView.current && motionAllowed() && !pausedRef.current) v.play().catch(() => undefined);
    };
    const onSound = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) mute();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(SOUND_EVENT, onSound);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(SOUND_EVENT, onSound);
    };
  }, [id]);

  useEffect(() => {
    pausedRef.current = regionPaused;
    const v = ref.current;
    if (!v) return;
    if (regionPaused) v.pause();
    else if (inView.current && motionAllowed()) v.play().catch(() => undefined);
  }, [regionPaused]);

  const onPress = () => {
    const v = ref.current;
    if (!v) return;
    if (!hasAudio) {
      if (v.paused) v.play().catch(() => undefined);
      else v.pause();
      return;
    }
    if (sound && !v.paused) {
      v.muted = true;
      setSound(false);
      return;
    }
    window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: id }));
    v.muted = false;
    setSound(true);
    if (v.paused)
      v.play().catch(() => {
        v.muted = true;
        setSound(false);
      });
  };

  const Icon = hasAudio ? (sound && playing ? Volume2 : playing ? VolumeX : Play) : playing ? Pause : Play;
  const action = hasAudio ? (sound && playing ? "Mute" : playing ? "Turn sound on" : "Play with sound") : playing ? "Pause" : "Play";

  return (
    <>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={m.kind === "video" ? m.poster : m.src}
        aria-hidden
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={cn("block h-full w-full object-cover", className)}
      >
        {m.kind === "video" ? <source src={m.src} type="video/mp4" /> : null}
      </video>
      <button
        type="button"
        onClick={onPress}
        tabIndex={focusable ? undefined : -1}
        className="group/clip absolute inset-0 z-[1] cursor-pointer focus-visible:outline-offset-[-4px]"
      >
        <span className="sr-only">
          {action}: {name}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[rgb(15_18_18/0.62)] font-semibold text-white backdrop-blur-md transition-colors group-hover/clip:bg-brand-blue",
            compact ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-xs",
            sound && playing && "border-brand-blue bg-brand-blue",
            controlClassName,
          )}
        >
          {sound && playing ? (
            <span className="eq-bars flex h-3 items-end gap-[2px]">
              <span />
              <span />
              <span />
            </span>
          ) : null}
          <Icon className={compact ? "size-3.5" : "size-4"} />
          {compact ? null : <span className="max-sm:hidden">{!playing ? "Play" : hasAudio ? (sound ? "Sound on" : "Tap for sound") : "Pause"}</span>}
        </span>
      </button>
    </>
  );
}
