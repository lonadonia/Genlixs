"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/format";

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  surface = "dark",
  variant = "button",
  className,
  srLabel,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  surface?: "dark" | "light";
  variant?: "button" | "primary" | "inline";
  className?: string;
  srLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const text = state === "copied" ? copiedLabel : state === "failed" ? "Copy failed — select the text" : label;

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors",
        variant === "inline" && "h-8 px-2 text-xs",
        variant === "button" && "h-11 px-4 text-sm",
        variant === "primary" && "btn-primary h-11 bg-brand-blue px-5 text-sm text-white hover:bg-brand-blue-hover",
        variant !== "primary" &&
          (surface === "dark"
            ? "border border-white/25 bg-white/[0.04] text-ink hover:bg-white/[0.08]"
            : "border border-[#cfd4cd] bg-sheet text-ink-dark hover:bg-paper"),
        className,
      )}
    >
      {state === "copied" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{text}</span>
      {srLabel ? <span className="sr-only"> {srLabel}</span> : null}
    </button>
  );
}
