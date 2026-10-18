"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TUTORIALS, type Tutorial } from "@/lib/tutorials";
import { cn } from "@/lib/format";

const motionAllowed = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  return !reduce && !saveData;
};

/** "How it works" in the video studio: the walkthrough videos, then the steps of the current mode. */
export function HowItWorks({ steps, modeTitle }: { steps: { title: string; body: ReactNode }[]; modeTitle: string }) {
  return (
    <div className="space-y-8 pb-4">
      <TutorialCarousel items={TUTORIALS} />
      <section aria-labelledby="how-steps-h" className="mx-auto max-w-[920px]">
        <h3 id="how-steps-h" className="px-1 text-[13px] font-semibold text-muted">
          Steps for {modeTitle.toLowerCase()}
        </h3>
        <ol className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-[14px] border border-white/[0.07] bg-surface p-3.5">
              <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-[rgb(37_63_246/0.18)] text-xs font-bold text-link">
                {i + 1}
              </span>
              <p className="mt-2.5 text-sm font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Layered walkthrough carousel: the active video sharp in the centre, the previous and next ones as blurred posters
 * behind it (only when there are at least three distinct videos; two show one, one shows none). Only the active video
 * is a player: it starts muted when motion is allowed, pauses when it leaves the screen or the tab is hidden, and is
 * replaced (so it stops) when the slide changes. Arrow keys, the buttons, the thumbnails and a horizontal swipe move.
 */
export function TutorialCarousel({ items }: { items: Tutorial[] }) {
  const [index, setIndex] = useState(0);
  const n = items.length;
  const go = (d: number) => setIndex((i) => (i + d + n) % n);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  if (!n) return null;
  const active = items[index];
  const prev = n >= 3 ? items[(index - 1 + n) % n] : null;
  const next = n >= 2 ? items[(index + 1) % n] : null;
  const slots: { t: Tutorial; pos: "prev" | "active" | "next" }[] = [
    ...(prev ? [{ t: prev, pos: "prev" as const }] : []),
    { t: active, pos: "active" as const },
    ...(next && next.id !== prev?.id ? [{ t: next, pos: "next" as const }] : []),
  ];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="How it works videos"
      onKeyDown={(e) => {
        if (n < 2 || (e.target as HTMLElement).tagName === "VIDEO") return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
      className="mx-auto max-w-[920px]"
    >
      <div
        className="relative mx-auto aspect-[2.12/1] w-full touch-pan-y sm:aspect-[2.34/1]"
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          const r = e.currentTarget.getBoundingClientRect();
          // The bottom of the player belongs to its own controls (seek bar).
          touch.current = (e.clientY - r.top) / r.height < 0.7 ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
        }}
        onPointerUp={(e) => {
          const s = touch.current;
          touch.current = null;
          if (!s || n < 2) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5 && e.timeStamp - s.t < 700) go(dx < 0 ? 1 : -1);
        }}
      >
        {slots.map(({ t, pos }) => (
          <div
            key={t.id}
            role={pos === "active" ? "group" : undefined}
            aria-roledescription={pos === "active" ? "slide" : undefined}
            aria-label={pos === "active" ? `${index + 1} of ${n}: ${t.title}` : undefined}
            aria-hidden={pos === "active" ? undefined : true}
            onClick={pos === "active" ? undefined : () => go(pos === "next" ? 1 : -1)}
            className={cn(
              "absolute top-0 left-1/2 aspect-video w-[84%] overflow-hidden rounded-[18px] bg-canvas ring-1 transition-[translate,scale,opacity,filter] duration-500 ease-out motion-reduce:transition-none sm:w-[76%]",
              pos === "active" && "z-20 -translate-x-1/2 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.9)] ring-white/[0.1]",
              pos === "prev" && "z-10 -translate-x-[62%] scale-[0.86] cursor-pointer opacity-55 blur-[3px] brightness-75 ring-white/[0.05] sm:-translate-x-[72%] sm:scale-[0.82]",
              pos === "next" && "z-10 -translate-x-[38%] scale-[0.86] cursor-pointer opacity-55 blur-[3px] brightness-75 ring-white/[0.05] sm:-translate-x-[28%] sm:scale-[0.82]",
            )}
          >
            {pos === "active" ? (
              <ActivePlayer key={t.id} t={t} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- decorative poster behind the active player
              <img src={t.poster} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            )}
          </div>
        ))}
      </div>

      <div className="mx-auto mt-5 max-w-[620px] text-center" aria-live="polite">
        <p className="text-[11px] font-bold tracking-[0.12em] text-link uppercase">{active.eyebrow}</p>
        <h3 className="mt-1.5 font-display text-xl leading-tight font-extrabold tracking-tight text-white uppercase sm:text-2xl">{active.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted sm:text-[15px]">{active.body}</p>
      </div>

      {n > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => go(-1)}
            className="grid size-10 place-items-center rounded-full border border-white/[0.12] bg-surface text-ink transition-colors hover:border-white/30"
          >
            <ChevronLeft aria-hidden className="size-4" />
            <span className="sr-only">Previous video</span>
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-surface p-1.5">
            {[prev, active, next && next.id !== prev?.id ? next : null].map((t, i) =>
              t ? (
                <button
                  key={`${t.id}-${i}`}
                  type="button"
                  aria-current={i === 1 ? "true" : undefined}
                  onClick={() => (i === 0 ? go(-1) : i === 2 ? go(1) : undefined)}
                  className={cn(
                    "relative overflow-hidden rounded-full transition-[width,height] duration-300 motion-reduce:transition-none",
                    i === 1 ? "h-9 w-16 ring-2 ring-brand-blue-bright" : "h-7 w-10 opacity-70 hover:opacity-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- small local thumbnail */}
                  <img src={t.thumb} alt="" className="size-full object-cover" />
                  <span className="sr-only">{i === 1 ? `Playing: ${t.title}` : `${i === 0 ? "Previous" : "Next"}: ${t.title}`}</span>
                </button>
              ) : null,
            )}
            <span className="px-1.5 text-[11px] font-semibold text-muted tabular">
              {index + 1}/{n}
            </span>
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            className="grid size-10 place-items-center rounded-full border border-white/[0.12] bg-surface text-ink transition-colors hover:border-white/30"
          >
            <ChevronRight aria-hidden className="size-4" />
            <span className="sr-only">Next video</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The one playing walkthrough: muted start, native controls (sound, seek, full screen), paused off-screen. */
function ActivePlayer({ t }: { t: Tutorial }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    if (motionAllowed()) v.play().catch(() => undefined);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) v.pause();
    }, { threshold: 0.35 });
    io.observe(v);
    const onVis = () => document.hidden && v.pause();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      v.pause();
    };
  }, []);
  return (
    <video
      ref={ref}
      src={t.src}
      poster={t.poster}
      controls
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={t.alt}
      className="size-full bg-black object-contain"
    />
  );
}
