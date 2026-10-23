/** Makers that have a vetted mark (src/components/live/studio/model-logo.tsx draws them). */
export type MarkKey = "openai" | "google" | "bytedance" | "kuaishou" | "alibabacloud";
export type Provider = { key: MarkKey | "monogram"; name: string; monogram?: string };

/** Makers without a vetted mark in Simple Icons: a restrained monogram instead of an invented logo. */
const MONOGRAMS: [RegExp, string, string][] = [
  [/flux/, "Black Forest Labs", "BFL"],
  [/grok/, "xAI", "xAI"],
  [/hailuo|minimax/, "MiniMax", "MM"],
  [/pixverse/, "PixVerse", "PV"],
  [/runway/, "Runway", "RW"],
  [/ideogram/, "Ideogram", "ID"],
  [/recraft/, "Recraft", "RC"],
  [/topaz/, "Topaz Labs", "TL"],
  [/vidu/, "Shengshu (Vidu)", "VD"],
];

/** Who makes a catalog model, from its family and name (catalog data, never a guess from a file name). */
export function providerOf(model: { id: string; name: string; family?: string | null }): Provider {
  const s = `${model.family ?? ""} ${model.name} ${model.id}`.toLowerCase();
  if (s.includes("gpt")) return { key: "openai", name: "OpenAI" };
  if (/nano banana|veo|imagen|gemini/.test(s)) return { key: "google", name: "Google" };
  if (/seedream|seedance|omnihuman/.test(s)) return { key: "bytedance", name: "ByteDance" };
  if (s.includes("kling")) return { key: "kuaishou", name: "Kuaishou (Kling)" };
  if (/\bwan\b|qwen|happyhorse|z-image/.test(s)) return { key: "alibabacloud", name: "Alibaba" };
  for (const [re, name, monogram] of MONOGRAMS) if (re.test(s)) return { key: "monogram", name, monogram };
  const initials = model.name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { key: "monogram", name: model.name, monogram: initials };
}
