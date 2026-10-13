import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDot, CircleX, Clock, Hourglass, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/format";

export type Tone = "success" | "info" | "violet" | "attention" | "warning" | "error" | "neutral";

const dark: Record<Tone, string> = {
  success: "bg-[rgb(173_219_90/0.12)] text-brand-lime border-[rgb(173_219_90/0.28)]",
  info: "bg-[rgb(28_93_255/0.16)] text-link border-[rgb(28_93_255/0.4)]",
  violet: "bg-[rgb(118_61_255/0.16)] text-violet-on-dark border-[rgb(118_61_255/0.4)]",
  attention: "bg-[rgb(254_85_17/0.12)] text-orange-on-dark border-[rgb(254_85_17/0.35)]",
  warning: "bg-[rgb(254_85_17/0.12)] text-orange-on-dark border-[rgb(254_85_17/0.35)]",
  error: "bg-[rgb(214_54_82/0.14)] text-error-on-dark border-[rgb(214_54_82/0.4)]",
  neutral: "bg-raised text-muted border-line",
};

const light: Record<Tone, string> = {
  success: "bg-success-tint text-success-text border-[#cfe6a8]",
  info: "bg-info-tint text-info-text border-[#c9d8ff]",
  violet: "bg-violet-tint text-violet-text border-[#dccdff]",
  attention: "bg-orange-tint text-orange-text border-[#ffd4bf]",
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

export function ConceptTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full bg-[rgb(11_15_26/0.78)] px-2.5 text-[11px] font-semibold tracking-wide text-ink uppercase backdrop-blur-sm",
        className,
      )}
      title="Temporary concept media — replace with validated Genlixs output before launch"
    >
      Concept media
    </span>
  );
}
