"use client";

import { ArrowUpRight } from "lucide-react";
import type { Settings, ToolId } from "@/lib/catalog";
import { cn } from "@/lib/format";
import { applyExamplePrompt, applyStarterPrompt } from "./prompt-actions";

const styles = {
  solid: "h-11 bg-brand-blue px-4 text-white hover:bg-brand-blue-hover",
  outline: "h-10 border border-line-strong bg-raised px-3.5 text-ink hover:bg-[#222d40]",
  link: "h-10 px-0 text-link hover:underline underline-offset-4",
};

export function UsePromptButton({
  exampleId,
  label = "Use this prompt",
  context,
  look = "outline",
  className,
}: {
  exampleId: string;
  label?: string;
  context?: string;
  look?: keyof typeof styles;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => applyExamplePrompt(exampleId)}
      className={cn("inline-flex items-center gap-1.5 rounded-[var(--radius-control)] text-sm font-semibold transition-colors", styles[look], className)}
    >
      {label}
      {context ? <span className="sr-only">: {context}</span> : null}
      <ArrowUpRight aria-hidden className="size-4" />
    </button>
  );
}

export function StarterButton({
  tool,
  prompt,
  settings,
  label,
  className,
}: {
  tool: ToolId;
  prompt: string;
  settings?: Partial<Settings>;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => applyStarterPrompt(tool, prompt, settings)}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-raised px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-[#222d40]",
        className,
      )}
    >
      {label}
      <ArrowUpRight aria-hidden className="size-4" />
    </button>
  );
}
