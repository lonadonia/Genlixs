"use client";

import { ArrowUpRight } from "lucide-react";
import type { Settings, ToolId } from "@/lib/catalog";
import { cn } from "@/lib/format";
import { applyExamplePrompt, applyStarterPrompt } from "./prompt-actions";

const styles = {
  solid: "h-11 bg-brand-blue px-5 text-white hover:bg-brand-blue-hover",
  outline: "h-10 border border-white/20 bg-white/[0.04] px-4 text-ink hover:border-white/45 hover:bg-white/[0.08]",
  /** Over media: frosted pill that turns electric blue on hover. */
  glass: "h-9 border border-white/25 bg-[rgb(15_18_18/0.72)] px-3.5 text-white backdrop-blur-md hover:border-brand-blue hover:bg-brand-blue hover:text-white",
  link: "h-10 px-0 text-link hover:underline underline-offset-4",
  /** Icon-only round button for narrow cards; the label stays available to assistive technology. */
  icon: "size-10 justify-center border border-white/20 bg-white/[0.05] text-ink hover:border-brand-blue hover:bg-brand-blue hover:text-white",
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
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors", styles[look], className)}
    >
      {look === "icon" ? <span className="sr-only">{label}</span> : label}
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
        "inline-flex h-10 items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.04] px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-blue hover:bg-brand-blue hover:text-white",
        className,
      )}
    >
      {label}
      <ArrowUpRight aria-hidden className="size-4" />
    </button>
  );
}
