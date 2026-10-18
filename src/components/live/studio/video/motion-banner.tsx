import { Aperture, BookOpen } from "lucide-react";
import { motionItem } from "@/lib/motion-library";
import { cn } from "@/lib/format";

/** Posters of three library clips (left, front, right). */
const CARDS = ["pajama-dance", "studio-session-solo", "doorway-dance"];

/**
 * Motion Control introduction: the message on the left, three overlapping portrait cards from the Motion Library on the
 * right. Compact, so the reference-video and character inputs stay right below it; the two links open the library and
 * the walkthrough in the canvas.
 */
export function MotionBanner({ onLibrary, onHelp }: { onLibrary: () => void; onHelp: () => void }) {
  const cards = CARDS.map(motionItem).filter((m): m is NonNullable<typeof m> => Boolean(m));
  return (
    <div className="relative isolate overflow-hidden rounded-[14px] bg-raised ring-1 ring-white/[0.07]">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_100%_40%,rgb(37_63_246/0.32),transparent_62%)]" />
      <div className="flex items-start gap-1.5 px-3.5 pt-3.5">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm leading-[1.1] min-[380px]:text-[15px] font-extrabold tracking-tight text-white uppercase">
            Copy any <span className="text-link">move</span>
            <br />
            onto your character
          </p>
          <p className="mt-1.5 text-xs leading-snug text-muted">A reference video&apos;s movement guides the character in your image — closely, not frame for frame.</p>
        </div>
        <div aria-hidden className="relative h-[86px] w-[92px] shrink-0">
          <div className="absolute inset-x-1 bottom-0 h-8 rounded-full bg-[radial-gradient(closest-side,rgb(81_101_248/0.5),transparent)] blur-md" />
          {cards.map((c, i) => (
            <div
              key={c.id}
              className={cn(
                "absolute aspect-[9/16] overflow-hidden rounded-[9px] ring-1 ring-white/25 shadow-[0_10px_22px_-10px_rgb(0_0_0/0.9)]",
                i === 0 && "top-3 left-0 z-10 w-[37px] -rotate-[9deg]",
                i === 1 && "top-0 left-1/2 z-20 w-[44px] -translate-x-1/2",
                i === 2 && "top-3 right-0 z-10 w-[37px] rotate-[9deg]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- decorative local poster */}
              <img src={c.poster} alt="" className="size-full object-cover" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3.5 pt-2 pb-3">
        <button type="button" onClick={onLibrary} className="flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.08] px-2 text-xs font-semibold text-ink hover:bg-white/[0.13]">
          <Aperture aria-hidden className="size-3.5" /> Motion Library
        </button>
        <button type="button" onClick={onHelp} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-white/[0.06] hover:text-ink">
          <BookOpen aria-hidden className="size-3.5" /> How it works
        </button>
      </div>
    </div>
  );
}
