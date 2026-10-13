import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "secondary-light" | "ghost-light";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "btn-primary bg-brand-blue text-white hover:bg-brand-blue-hover disabled:bg-[#33405a] disabled:text-[#c3ccdb] aria-disabled:bg-[#33405a] aria-disabled:text-[#c3ccdb]",
  secondary:
    "border border-line-strong bg-raised text-ink hover:border-[#8f9db5] hover:bg-[#222d40] disabled:text-muted disabled:opacity-70",
  ghost: "text-ink hover:bg-raised disabled:text-muted",
  danger: "bg-error text-white hover:bg-[#b92a44] disabled:opacity-60",
  "secondary-light":
    "border border-rule bg-sheet text-ink-dark hover:border-[#b9c4d6] hover:bg-paper disabled:text-muted-dark disabled:opacity-70",
  "ghost-light": "text-ink-dark hover:bg-neutral-tint disabled:text-muted-dark",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-[15px]",
  lg: "h-12 px-5 text-base",
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
