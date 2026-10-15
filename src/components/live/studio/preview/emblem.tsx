import Image from "next/image";
import { cn } from "@/lib/format";

/**
 * The Genlixs emblem in white on a transparent background (the supplied symbol with its colour set to white, not a
 * redraw). While work is running it breathes softly and a light band passes across it; with reduced motion it stays
 * still. Purely decorative: the surrounding status text carries the meaning.
 */
export function GenlixsEmblem({ size = 72, animated = true, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block", className)} style={{ width: size, height: size }}>
      <span
        className="absolute inset-[-35%] rounded-full opacity-60 blur-2xl"
        style={{ background: "radial-gradient(circle, rgb(37 63 246 / 0.32) 0%, rgb(37 63 246 / 0.08) 45%, transparent 70%)" }}
      />
      <span className={cn("absolute inset-0", animated && "gx-emblem")}>
        <Image src="/brand/genlixs-symbol-white-256.png" alt="" width={size} height={size} className="block size-full opacity-80" />
      </span>
      {animated ? <span className="gx-emblem-sweep absolute inset-0" /> : null}
    </span>
  );
}
