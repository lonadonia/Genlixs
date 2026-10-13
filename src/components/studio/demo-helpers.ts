import type { Settings, ToolId } from "@/lib/catalog";
import type { MediaKey } from "@/lib/media";

/**
 * Preview only: choose the placeholder closest to the prompt so reviewers see a plausible result.
 * Production shows the delivered file; nothing here inspects or generates media.
 */
export const pickMedia = (tool: ToolId, s: Settings, prompt: string): MediaKey => {
  const p = prompt.toLowerCase();
  if (tool === "video") return /torus|ring|orbit|loop|sphere|capsule|abstract/.test(p) ? "loop" : "auroraClip";
  if (tool === "edit") return "dunesDusk";
  if (/torus|ring|donut/.test(p)) return "torus";
  if (/capsule|pill/.test(p)) return "pills";
  if (/pale floor|pastel|grey studio|gray studio/.test(p)) return "spheres";
  if (/sphere|orb|ball|abstract|still life/.test(p)) return "orbs";
  if (/bottle|product|pedestal|packshot/.test(p)) return "product";
  if (/aurora|northern/.test(p)) return "auroraVertical";
  if (/noon|midday|blue sky/.test(p)) return "dunesNoon";
  if (/dune|desert|dusk|sunset/.test(p)) return "dunesDusk";
  if (s.ratio === "9:16" || s.ratio === "2:3") return "pills";
  if (s.ratio === "4:5") return "torus";
  if (s.ratio === "1:1") return "product";
  if (s.ratio === "16:9") return "orbs";
  return "dunesDusk";
};

export const titleFrom = (prompt: string) => {
  const t = prompt.trim().split(/[,.;\n]/)[0].trim();
  return t.length > 48 ? `${t.slice(0, 46)}…` : t || "Untitled";
};
