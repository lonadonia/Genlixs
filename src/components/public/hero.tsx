import Image from "next/image";
import { ArrowUpRight, Download, PenLine, Play, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { AutoplayVideo } from "@/components/ui/autoplay-video";
import { MotionRegion } from "@/components/motion-region";
import { MEDIA, stillOf, type MediaKey } from "@/lib/media";
import { cn } from "@/lib/format";

type Tile = { media: MediaKey; video?: boolean };

/*
 * Three staggered columns of client media (reference hero), each looping vertically in alternate
 * directions. Every tile keeps the aspect ratio of the file it shows, so nothing is cropped.
 */
const COLUMNS: { items: Tile[]; dir: "up" | "down"; duration: string; offset: string }[] = [
  { dir: "up", duration: "60s", offset: "mt-10", items: [{ media: "forestFlare" }, { media: "earring" }, { media: "garden" }, { media: "summitBag" }] },
  {
    dir: "down",
    duration: "68s",
    offset: "-mt-24",
    items: [{ media: "knightClip", video: true }, { media: "seaGown" }, { media: "driveThru" }, { media: "horned" }, { media: "library" }],
  },
  { dir: "up", duration: "54s", offset: "mt-24", items: [{ media: "boardwalk" }, { media: "warriorSheet" }, { media: "stoneHall" }, { media: "milkyTent" }, { media: "trench" }] },
];

/** Strip tiles (below lg) share one height, so their width follows the media's ratio. */
const STRIP_H = 176;

function MediaTile({ t, size = "lg" }: { t: Tile; size?: "lg" | "sm" }) {
  const m = MEDIA[t.media];
  const ratio = m.width / m.height;
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-white/10 bg-raised shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)]",
        size === "lg" ? "mb-4 w-full rounded-[18px]" : "mr-3 rounded-2xl",
      )}
      style={size === "lg" ? { aspectRatio: `${m.width} / ${m.height}` } : { height: STRIP_H, width: Math.round(STRIP_H * ratio) }}
    >
      {t.video && m.kind === "video" ? (
        <AutoplayVideo media={t.media} decorative className="absolute inset-0" />
      ) : (
        <Image src={stillOf(t.media)} alt="" fill sizes={size === "lg" ? "(min-width: 1024px) 15vw, 30vw" : `${Math.ceil(STRIP_H * ratio)}px`} className="object-cover" />
      )}
      <span aria-hidden className={cn("pointer-events-none absolute inset-0 ring-1 ring-white/10 ring-inset", size === "lg" ? "rounded-[18px]" : "rounded-2xl")} />
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
          <MotionRegion className="fade-x -mx-4 mt-10 overflow-hidden sm:-mx-6 lg:hidden" label="hero gallery" controlClassName="right-4 -bottom-1 sm:right-6">
            <div aria-hidden className="marquee-left flex w-max items-start pb-10" style={{ ["--marquee-duration" as string]: "56s" }}>
              {[...COLUMNS.flatMap((c) => c.items), ...COLUMNS.flatMap((c) => c.items)].map((t, i) => (
                <MediaTile key={i} t={{ ...t, video: false }} size="sm" />
              ))}
            </div>
          </MotionRegion>

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
        <MotionRegion className="relative hidden lg:col-span-5 lg:block" label="hero gallery" controlClassName="right-2 bottom-6">
          <div aria-hidden className="fade-y absolute inset-y-0 -right-10 left-0 grid grid-cols-3 gap-4 overflow-hidden xl:-right-16">
            {COLUMNS.map((col, ci) => (
              <div key={ci} className={col.offset}>
                <div className={cn("flex flex-col", col.dir === "up" ? "marquee-up" : "marquee-down")} style={{ ["--marquee-duration" as string]: col.duration }}>
                  {[...col.items, ...col.items].map((t, i) => (
                    <MediaTile key={i} t={i < col.items.length ? t : { ...t, video: false }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </MotionRegion>
      </div>
    </section>
  );
}
