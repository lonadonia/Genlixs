import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Persistent honesty notice styled as the site's announcement bar (white on electric blue, 6.7:1):
 * this deployment is a design preview, not the platform.
 */
export function PreviewBanner({ surface = "dark" }: { surface?: "dark" | "light" }) {
  return (
    <div
      role="note"
      className={cn(
        "relative z-50 flex min-h-9 items-center justify-center px-4 py-1.5 text-center text-[13px] leading-snug",
        surface === "dark" ? "bg-brand-blue text-white" : "border-b border-rule bg-sheet text-muted-dark",
      )}
    >
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase", surface === "dark" ? "bg-white text-brand-blue" : "bg-neutral-tint text-ink-dark")}>
          Design preview
        </span>
        <span className="font-medium">Sample media and simulated data — nothing is generated, charged or paid out.</span>
        <Link href="/help#about-preview" className="inline-flex items-center gap-1 font-bold underline underline-offset-2">
          About this preview <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </p>
    </div>
  );
}

/** Compact honesty marker for app shells (studio, admin, partner) where a full-width bar would break the rail layout. */
export function PreviewPill({ surface = "dark" }: { surface?: "dark" | "light" }) {
  return (
    <Link
      href="/help#about-preview"
      title="Design preview: sample media and simulated data. Nothing real is generated, charged or paid out."
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        surface === "dark" ? "border-[rgb(37_63_246/0.6)] bg-[rgb(37_63_246/0.18)] text-link" : "border-[#c7cefd] bg-info-tint text-info-text",
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Preview<span className="hidden sm:inline">&nbsp;· sample data</span>
      <span className="sr-only"> — design preview with sample data. Learn more.</span>
    </Link>
  );
}
