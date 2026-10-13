import Link from "next/link";
import { cn } from "@/lib/format";

/** Persistent honesty notice: this deployment is a design preview, not the platform. */
export function PreviewBanner({ surface = "dark" }: { surface?: "dark" | "light" }) {
  return (
    <div
      role="note"
      className={cn(
        "flex min-h-8 items-center justify-center gap-x-2 px-4 py-1.5 text-center text-xs leading-snug",
        surface === "dark" ? "border-b border-line bg-surface text-muted" : "border-b border-rule bg-sheet text-muted-dark",
      )}
    >
      <span>
        <strong className={surface === "dark" ? "font-semibold text-ink" : "font-semibold text-ink-dark"}>Design preview.</strong> Sample data and
        concept media — no real generation, payment or payout happens here.{" "}
        <Link href="/help#about-preview" className={cn("font-semibold underline underline-offset-2", surface === "dark" ? "text-link" : "text-info-text")}>
          About this preview
        </Link>
      </span>
    </div>
  );
}

/** Compact honesty marker for app shells (studio, admin, partner) where a full-width banner would break the rail layout. */
export function PreviewPill({ surface = "dark" }: { surface?: "dark" | "light" }) {
  return (
    <Link
      href="/help#about-preview"
      title="Design preview: sample data and concept media. Nothing real is generated, paid or paid out."
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        surface === "dark" ? "border-[rgb(254_85_17/0.4)] bg-[rgb(254_85_17/0.1)] text-orange-on-dark" : "border-[#ffd4bf] bg-orange-tint text-orange-text",
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Preview<span className="hidden sm:inline">&nbsp;· sample data</span>
      <span className="sr-only"> — design preview with sample data. Learn more.</span>
    </Link>
  );
}
