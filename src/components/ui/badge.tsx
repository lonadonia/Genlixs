import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDot, CircleX, Clock, Hourglass, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/format";

export type Tone = "success" | "info" | "violet" | "attention" | "warning" | "error" | "neutral";

const dark: Record<Tone, string> = {
  success: "bg-[rgb(225_255_1/0.1)] text-brand-lime border-[rgb(225_255_1/0.3)]",
  info: "bg-[rgb(37_63_246/0.2)] text-link border-[rgb(37_63_246/0.5)]",
  violet: "bg-[rgb(37_63_246/0.2)] text-link border-[rgb(37_63_246/0.5)]",
  attention: "bg-[rgb(255_181_71/0.1)] text-orange-on-dark border-[rgb(255_181_71/0.35)]",
  warning: "bg-[rgb(255_181_71/0.1)] text-orange-on-dark border-[rgb(255_181_71/0.35)]",
  error: "bg-[rgb(239_68_68/0.12)] text-error-on-dark border-[rgb(239_68_68/0.4)]",
  neutral: "bg-raised text-muted border-line",
};

const light: Record<Tone, string> = {
  success: "bg-success-tint text-success-text border-[#dceb8f]",
  info: "bg-info-tint text-info-text border-[#c7cefd]",
  violet: "bg-violet-tint text-violet-text border-[#c7cefd]",
  attention: "bg-orange-tint text-orange-text border-[#f3d9a8]",
  warning: "bg-warning-tint text-warning border-[#f3d9a8]",
  error: "bg-error-tint text-error-text border-[#f6c4c4]",
  neutral: "bg-neutral-tint text-muted-dark border-rule",
};

const icons = {
  success: CircleCheck,
  info: Info,
  violet: CircleDot,
  attention: CircleAlert,
  warning: TriangleAlert,
  error: CircleX,
  neutral: Clock,
  busy: LoaderCircle,
  pending: Hourglass,
};

/** Status badge: always text + icon, never color alone (guide §04, §11). */
export function Badge({
  tone = "neutral",
  surface = "dark",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  surface?: "dark" | "light";
  icon?: keyof typeof icons | "none";
  children: ReactNode;
  className?: string;
}) {
  const Icon = icon === "none" ? null : icons[icon ?? tone];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        surface === "dark" ? dark[tone] : light[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className={cn("size-3.5", icon === "busy" && "animate-spin-slow")} /> : null}
      {children}
    </span>
  );
}

export function ConceptTag({ className, label = "Placeholder" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-[rgb(15_18_18/0.72)] px-2.5 text-[11px] font-semibold tracking-wide text-ink uppercase backdrop-blur-md",
        className,
      )}
      title={
        label === "Placeholder"
          ? "Temporary placeholder media — replace with approved Genlixs examples before launch"
          : "Sample file supplied by Genlixs — stands in for a real result in this preview"
      }
    >
      <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" />
      {label}
    </span>
  );
}
