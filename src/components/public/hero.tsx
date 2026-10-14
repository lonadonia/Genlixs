import Image from "next/image";
import { ArrowUpRight, Download, PenLine, Play, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ShowcaseVideo } from "@/components/ui/showcase-video";
import { MEDIA, stillOf, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

type Tile = { media: MediaKey };

/*
 * Four staggered columns of client media (reference hero), each looping vertically in alternate
 * directions. Every tile keeps the aspect ratio of the file it shows, so nothing is cropped.
 * Clips play muted in place; a click on one turns its sound on.
 */
const COLUMNS: { items: Tile[]; dir: "up" | "down"; duration: string; offset: string }[] = [
  {
    dir: "up",
    duration: "64s",
    offset: "mt-10",
    items: [{ media: "forestFlare" }, { media: "teeDance" }, { media: "earring" }, { media: "garden" }, { media: "goldenHourWalk" }, { media: "summitBag" }],
  },
  {
    dir: "down",
    duration: "72s",
    offset: "-mt-24",
    items: [{ media: "knightClip" }, { media: "seaGown" }, { media: "catPhotoshoot" }, { media: "driveThru" }, { media: "horned" }, { media: "leatherCoat" }],
  },
  {
    dir: "up",
    duration: "58s",
    offset: "mt-24",
    items: [{ media: "boardwalk" }, { media: "giantAstronaut" }, { media: "warriorSheet" }, { media: "stoneHall" }, { media: "hairRollers" }, { media: "milkyTent" }],
  },
  {
    dir: "down",
    duration: "68s",
    offset: "-mt-6",
    items: [{ media: "poodleDance" }, { media: "cosmicSphere" }, { media: "trench" }, { media: "alleyCats" }, { media: "jellyfishBed" }, { media: "library" }],
  },
];

/** Phones and tablets: one horizontal strip interleaving the columns, so clips stay spread out. */
const STRIP: Tile[] = COLUMNS[0].items.flatMap((_, i) => COLUMNS.map((c) => c.items[i]).filter(Boolean));

/** Strip tiles (below lg) share one height, so their width follows the media's ratio. */
const STRIP_H = 176;

/**
 * `copy` marks the second half of a marquee loop: hidden from assistive technology and skipped
 * by the keyboard, but still clickable so a pointer never lands on a dead tile.
 */
function MediaTile({ t, size = "lg", copy }: { t: Tile; size?: "lg" | "sm"; copy?: boolean }) {
  const m = MEDIA[t.media];
  const ratio = m.width / m.height;
  return (
    <div
      aria-hidden={copy || undefined}
      className={cn(
        "relative shrink-0 overflow-hidden border border-white/10 bg-raised shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)]",
        size === "lg" ? "mb-3 w-full rounded-[18px]" : "mr-3 rounded-2xl",
      )}
      style={size === "lg" ? { aspectRatio: `${m.width} / ${m.height}` } : { height: STRIP_H, width: Math.round(STRIP_H * ratio) }}
    >
      {m.kind === "video" ? (
        <ShowcaseVideo media={t.media} compact focusable={!copy} className="absolute inset-0" controlClassName="right-2 bottom-2" />
      ) : (
        <Image src={stillOf(t.media)} alt="" fill sizes={size === "lg" ? "(min-width: 1440px) 14vw, (min-width: 1024px) 12vw, 30vw" : `${Math.ceil(STRIP_H * ratio)}px`} className="object-cover" />
      )}
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 z-[2] ring-1 ring-white/10 ring-inset", size === "lg" ? "rounded-[18px]" : "rounded-2xl")} />
    </div>
  );
}

function Squiggle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 520 44"
      fill="none"
      preserveAspectRatio="none"
      className={cn("squiggle pointer-events-none absolute -bottom-[0.22em] left-0 h-[0.36em] w-full text-brand-lime", className)}
    >
      <path
        pathLength={1}
        d="M6 30 C 90 16, 190 10, 300 14 L 268 30 C 330 22, 420 18, 514 20"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FEATURES = [
  { icon: PenLine, title: "Describe it", body: "Write a prompt or drop in a reference image." },
  { icon: Sparkles, title: "Generate", body: "Images, edits and short clips in one workspace." },
  { icon: Download, title: "Keep the original", body: "Download the file with its prompt and settings." },
];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* ambient light: electric field behind the media columns, faint dots across the stage */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="dot-field absolute inset-0 opacity-60" />
        <div className="absolute top-[-10%] right-[-10%] h-[80%] w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(37_63_246/0.38),transparent)] blur-2xl" />
        <div className="absolute bottom-[-20%] left-[-10%] h-[50%] w-[40%] rounded-full bg-[radial-gradient(closest-side,rgb(225_255_1/0.07),transparent)] blur-2xl" />
      </div>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:min-h-[calc(100dvh-112px)] lg:grid-cols-12 lg:gap-6 lg:px-10 lg:pt-0 lg:pb-0">
        {/* Copy column */}
        <div className="flex min-w-0 flex-col justify-center lg:col-span-7 lg:py-16">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" />
            AI image, edit &amp; short-video studio
          </p>
          {/* Sizes keep "Turn your ideas into" on one line from 640 px up, with the accent phrase on its own line. */}
          <h1
            id="hero-title"
            className="font-display mt-6 text-[2.5rem] leading-[1.04] font-extrabold text-ink sm:text-[3.25rem] md:text-[3.75rem] lg:text-[3rem] xl:text-[3.75rem] min-[1400px]:text-[4.25rem]"
          >
            Turn your ideas into{" "}
            <span className="relative text-brand-blue-bright sm:inline-block sm:whitespace-nowrap">
              images and{" "}
              <span className="relative inline-block whitespace-nowrap">
                videos.
                <Squiggle className="sm:hidden" />
              </span>
              <Squiggle className="hidden sm:block" />
            </span>
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
            Create images, edit a reference, or generate a short video in one workspace. You see the exact credit cost before anything runs.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href="/#create" size="xl" icon={<ArrowUpRight aria-hidden className="order-last size-5" />}>
              Start creating
            </ButtonLink>
            <ButtonLink href="/#examples" variant="secondary" size="xl" icon={<Play aria-hidden className="order-last size-4" />}>
              See examples
            </ButtonLink>
          </div>

          {/* Mobile / tablet: a single horizontal strip instead of columns (margins, not gaps, keep the -50% loop seamless) */}
          <div className="marquee-pause fade-x -mx-4 mt-10 overflow-hidden sm:-mx-6 lg:hidden">
            <div className="marquee-left flex w-max items-start" style={{ ["--marquee-duration" as string]: "80s" }}>
              {[...STRIP, ...STRIP].map((t, i) => (
                <MediaTile key={i} t={t} size="sm" copy={i >= STRIP.length} />
              ))}
            </div>
          </div>

          <ul className="mt-10 grid gap-6 border-t border-white/10 pt-8 sm:grid-cols-3 lg:mt-14">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/15 text-ink">
                  <f.icon aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block text-[17px] font-semibold text-ink">{f.title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Media columns (desktop) */}
        {/* No pause button here (client request); hover or focus still holds the columns still.
            The columns run to the viewport's right edge at every width. */}
        <div className="marquee-pause relative hidden lg:col-span-5 lg:block">
          <div className="fade-y absolute inset-y-0 -right-10 left-0 grid grid-cols-4 gap-3 overflow-hidden min-[90rem]:-right-[calc(50vw_-_720px_+_2.5rem)]">
            {COLUMNS.map((col, ci) => (
              <div key={ci} className={col.offset}>
                <div className={cn("flex flex-col", col.dir === "up" ? "marquee-up" : "marquee-down")} style={{ ["--marquee-duration" as string]: col.duration }}>
                  {[...col.items, ...col.items].map((t, i) => (
                    <MediaTile key={i} t={t} copy={i >= col.items.length} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
