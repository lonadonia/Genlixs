import Link from "next/link";
import { ImagePlus, WandSparkles } from "lucide-react";
import { cn } from "@/lib/format";

/** Generate / Edit switch for the design preview's image workspace (the live studio has its own in-panel switch). */
export function ImageModeSwitch({ mode }: { mode: "image" | "edit" }) {
  const item = (m: "image" | "edit", href: string, label: string, Icon: typeof ImagePlus) => (
    <Link
      href={href}
      aria-current={mode === m ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-colors",
        mode === m ? "control-raised bg-elevated text-ink" : "text-muted hover:text-ink",
      )}
    >
      <Icon aria-hidden className="size-3.5" /> {label}
    </Link>
  );
  return (
    <nav aria-label="Image mode" className="px-3 pt-1 sm:px-5">
      <div className="inline-flex gap-1 rounded-xl bg-canvas/70 p-[3px] ring-1 ring-white/[0.06]">
        {item("image", "/studio/image", "Generate", ImagePlus)}
        {item("edit", "/studio/image?mode=edit", "Edit", WandSparkles)}
      </div>
    </nav>
  );
}
