import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/format";

/**
 * Genlixs logo v2 (supplied 13 Oct 2026), exported without redrawing (brand/export_logo.py):
 * - "header": white tile mark + white wordmark — the supplied website-header logo, for dark surfaces
 * - "color":  electric-blue mark + white wordmark, for dark surfaces
 * - "dark":   electric-blue mark + night wordmark, for light surfaces
 * - "mono":   all-white mark + wordmark, for photos and colour fields
 * Trimmed ratio ≈ 4.87 : 1.
 */
const RATIO = 960 / 197;
const SRC = {
  header: "/brand/genlixs-header-white-960.png",
  color: "/brand/genlixs-logo-color-960.png",
  dark: "/brand/genlixs-logo-dark-960.png",
  mono: "/brand/genlixs-logo-mono-white-960.png",
} as const;

export type LogoVariant = keyof typeof SRC;

export function Logo({
  variant = "header",
  width = 150,
  href = "/",
  className,
  priority,
  label = "Genlixs home",
}: {
  variant?: LogoVariant;
  width?: number;
  href?: string | null;
  className?: string;
  priority?: boolean;
  label?: string;
}) {
  const height = Math.round(width / RATIO);
  const img = (
    <Image
      src={SRC[variant]}
      alt="Genlixs"
      width={width}
      height={height}
      loading={priority ? "eager" : undefined}
      sizes={`${width}px`}
      className="block max-w-none"
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
  if (!href) return <span className={cn("inline-flex p-1.5", className)}>{img}</span>;
  return (
    <Link href={href} aria-label={label} className={cn("inline-flex rounded-lg p-1.5", className)}>
      {img}
    </Link>
  );
}

/** Mark only, extracted from the supplied files (not a redraw). "tile" = header logo mark, "color" = blue mark. */
export function BrandSymbol({ size = 32, variant = "tile", className }: { size?: number; variant?: "tile" | "color"; className?: string }) {
  return (
    <Image
      src={variant === "tile" ? "/brand/genlixs-symbol-tile-64.png" : "/brand/genlixs-symbol-color-64.png"}
      alt=""
      width={size}
      height={size}
      className={cn("block", className)}
      aria-hidden
    />
  );
}
