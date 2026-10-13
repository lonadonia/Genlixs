import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/format";

/**
 * The supplied Genlixs wordmark, exported from the 21,627 × 4,487 px masters
 * without redrawing (brand/export_logo.py). Trimmed ratio ≈ 6.54 : 1.
 * White variant on dark surfaces, dark variant on light data surfaces.
 */
const RATIO = 960 / 147;

export function Logo({
  variant = "white",
  width = 168,
  href = "/",
  className,
  priority,
  label = "Genlixs home",
}: {
  variant?: "white" | "dark";
  width?: number;
  href?: string | null;
  className?: string;
  priority?: boolean;
  label?: string;
}) {
  const img = (
    <Image
      src={variant === "white" ? "/brand/genlixs-logo-white-960.png" : "/brand/genlixs-logo-dark-960.png"}
      alt="Genlixs"
      width={width}
      height={Math.round(width / RATIO)}
      priority={priority}
      sizes={`${width}px`}
      className="block max-w-none"
      style={{ width: `${width}px`, height: `${Math.round(width / RATIO)}px` }}
    />
  );
  if (!href) return <span className={cn("inline-flex p-2", className)}>{img}</span>;
  return (
    <Link href={href} aria-label={label} className={cn("inline-flex rounded-[var(--radius-control)] p-2", className)}>
      {img}
    </Link>
  );
}

/** Extracted supplied symbol for the collapsed rail (not a redraw). */
export function BrandSymbol({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/genlixs-symbol-64.png"
      alt=""
      width={size}
      height={size}
      className={cn("block", className)}
      aria-hidden
    />
  );
}
