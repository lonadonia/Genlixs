"use client";

import { defaultSettings, exampleById, type Settings, type ToolId } from "@/lib/catalog";
import { saveDraft } from "@/lib/demo-store";

/** Focus the public composer after loading a prompt into it. */
export function focusComposer() {
  const target = document.getElementById("create");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  window.setTimeout(() => document.getElementById("composer-prompt")?.focus({ preventScroll: true }), reduce ? 0 : 450);
}

/** Example → draft: preserves the example's prompt and exact settings (guide §02). */
export function applyExamplePrompt(exampleId: string) {
  const ex = exampleById(exampleId);
  if (!ex) return;
  saveDraft({ tool: ex.tool, prompt: ex.prompt, settings: { ...ex.settings }, source: "example", exampleId: ex.id });
  focusComposer();
}

export function applyStarterPrompt(tool: ToolId, prompt: string, settings?: Partial<Settings>) {
  saveDraft({ tool, prompt, settings: { ...defaultSettings(tool), ...settings }, source: "composer" });
  focusComposer();
}
