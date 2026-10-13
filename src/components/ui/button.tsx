import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "secondary-light" | "ghost-light" | "outline-on-color" | "inverse";
type Size = "sm" | "md" | "lg" | "xl";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  // Electric blue #253FF6 is the brand's primary colour: white label 6.7:1 (8.4:1 on hover), soft blue glow on dark.
  primary:
    "btn-primary bg-brand-blue text-white shadow-[0_10px_30px_-12px_rgb(37_63_246/0.75)] hover:bg-brand-blue-hover disabled:bg-elevated disabled:text-subtle disabled:shadow-none aria-disabled:bg-elevated aria-disabled:text-subtle",
  secondary:
    "border border-white/25 bg-white/[0.04] text-ink hover:border-white/50 hover:bg-white/[0.08] disabled:text-subtle disabled:opacity-70",
  ghost: "text-ink hover:bg-white/[0.07] disabled:text-subtle",
  danger: "bg-error text-white hover:bg-[#b92a44] disabled:opacity-60",
  "secondary-light":
    "border border-[#cfd4cd] bg-sheet text-ink-dark hover:border-[#9aa29f] hover:bg-paper disabled:text-muted-dark disabled:opacity-70",
  "ghost-light": "text-ink-dark hover:bg-neutral-tint disabled:text-muted-dark",
  /** On an electric-blue band: white outline pill (white on #253FF6 is 6.7:1). */
  "outline-on-color": "border border-white/70 text-white hover:border-white hover:bg-white/10",
  /** On an electric-blue band: white pill with blue label (6.7:1). */
  inverse: "bg-white text-brand-blue hover:bg-white/90",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-6 text-base",
  xl: "h-14 px-8 text-[17px]",
};

type Common = { variant?: Variant; size?: Size; busy?: boolean; icon?: ReactNode; children: ReactNode };

export function Button({
  variant = "primary",
  size = "md",
  busy,
  icon,
  className,
  children,
  disabled,
  ...rest
}: Common & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
    >
      {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin-slow" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: Omit<Common, "busy"> & ComponentProps<typeof Link>) {
  return (
    <Link {...rest} className={cn(base, variants[variant], sizes[size], className)}>
      {icon}
      {children}
    </Link>
  );
}
