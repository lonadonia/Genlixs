import type { Settings, ToolId } from "@/lib/catalog";
import type { MediaKey } from "@/lib/media";

/**
 * Preview only: choose the sample file closest to the prompt so reviewers see a plausible result.
 * Production shows the delivered file; nothing here inspects or generates media.
 */
export const pickMedia = (tool: ToolId, s: Settings, prompt: string): MediaKey => {
  const p = prompt.toLowerCase();
  if (tool === "video") {
    if (/torus|ring|orbit|loop|sphere|capsule|abstract/.test(p)) return "loop";
    if (/aurora|northern|lake/.test(p)) return "auroraClip";
    return "knightClip";
  }
  if (tool === "edit") return "dunesDusk";
  if (/warrior|turnaround|character sheet|armou?r/.test(p)) return "warriorSheet";
  if (/horn|demon|creature|character/.test(p)) return "horned";
  if (/forest|flare|hood/.test(p)) return "forestFlare";
  if (/gown|sequin/.test(p)) return "seaGown";
  if (/tent|milky way|camp|stars/.test(p)) return "milkyTent";
  if (/sleeping bag|summit|outdoor gear/.test(p)) return "summitBag";
  if (/library|study|wallpaper|armchair/.test(p)) return "library";
  if (/boardwalk|sunglasses/.test(p)) return "boardwalk";
  if (/garden|rose/.test(p)) return "garden";
  if (/earring|jewel/.test(p)) return "earring";
  if (/trench|coat|wind/.test(p)) return "trench";
  if (/neon|drive-thru|diner/.test(p)) return "driveThru";
  if (/phone|sofa|creator|selfie/.test(p)) return "sofa";
  if (/torus|ring|donut/.test(p)) return "torus";
  if (/capsule|pill/.test(p)) return "pills";
  if (/pale floor|pastel|grey studio|gray studio/.test(p)) return "spheres";
  if (/sphere|orb|ball|abstract|still life/.test(p)) return "orbs";
  if (/bottle|product|pedestal|packshot/.test(p)) return "product";
  if (/aurora|northern/.test(p)) return "auroraVertical";
  if (/noon|midday|blue sky/.test(p)) return "dunesNoon";
  if (/dune|desert|dusk|sunset/.test(p)) return "dunesDusk";
  if (s.ratio === "9:16") return "garden";
  if (s.ratio === "2:3") return "stoneHall";
  if (s.ratio === "4:5") return "boardwalk";
  if (s.ratio === "1:1") return "earring";
  if (s.ratio === "16:9") return "driveThru";
  return "earring";
};

export const titleFrom = (prompt: string) => {
  const t = prompt.trim().split(/[,.;\n]/)[0].trim();
  return t.length > 48 ? `${t.slice(0, 46)}…` : t || "Untitled";
};
