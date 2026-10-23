/* Global pricing policy (admin_pricing_policy / admin_preview_pricing_policy / admin_apply_pricing_policy). Every price is
   calculated in the database: customer credits = KIE reference of the whole request × (1 + markup) ÷ USD per Genlixs
   credit, rounded up once. These shapes are for display only; the page never computes a price itself. */

import type { AdminModel } from "./types";

export type Policy = {
  policyId: string;
  version: number;
  markupBps: number;
  markupPercent: number;
  usdPerCredit: number;
  kieUnitsPerUsd: number;
  kieUsdPerCredit: number;
  creditReferenceId: string;
  kieUnitVersionId: string;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};

export type PolicyRead = {
  policy: Policy | null;
  creditReference: { id: string; usdPerCredit: number; amountUsd: number; credits: number; createdAt: string } | null;
  canPreview: boolean;
  canApply: boolean;
  history: Policy[];
};

export type PolicyExample = {
  modelId: string;
  name: string;
  tool: string;
  live: boolean;
  options: Record<string, string | number>;
  kieUsd: number | null;
  before: number | null;
  beforeUsd: number | null;
  after: number | null;
  afterUsd: number | null;
};

export type PolicyPreview = {
  current: Policy | null;
  proposed: { markupPercent: number; markupBps: number; usdPerCredit: number; kieUsdPerCredit: number };
  affectedModels: number;
  unchangedModels: number;
  needsKieReference: { modelId: string; name: string; reason: string }[];
  examples: PolicyExample[];
  note: string;
};

export type PolicyApplyResult = {
  policy: Policy;
  newVersion: boolean;
  unchanged: boolean;
  result: {
    repriced: { modelId: string; name: string; version: number }[];
    unchanged: number;
    needsKieReference: { modelId: string; name: string; reason: string }[];
    unpriced: { modelId: string; name: string; reason: string }[];
    partial: { modelId: string; name: string }[];
  };
};

/** Model types used by the filters: video editing covers editing, upscaling, extending and motion control of a video. */
export type ModelKind = "image" | "edit" | "video" | "video_edit";
export const KIND_ORDER: ModelKind[] = ["image", "edit", "video", "video_edit"];
export const KIND_LABEL: Record<ModelKind, string> = { image: "Images", edit: "Image editing", video: "Videos", video_edit: "Video editing" };
export const KIND_SINGLE: Record<ModelKind, string> = { image: "Image", edit: "Image edit", video: "Video", video_edit: "Video edit" };

export function modelKind(m: Pick<AdminModel, "tool" | "capability">): ModelKind {
  if (m.tool === "image" || m.tool === "edit") return m.tool;
  // Talking avatars make a new video (from a portrait and audio): they count as videos, not edits.
  return m.capability.spec.jobKind === "text_to_video" || m.capability.spec.jobKind === "avatar" ? "video" : "video_edit";
}

/** Inputs of the policy panel: markup up to two decimals (0–2000 %), credit value above $0 with up to six decimals. */
export function parseMarkup(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 2000 ? n : null;
}

export function parseCreditValue(v: string): number | null {
  const t = v.trim().replace(/^\$/, "");
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 100 ? n : null;
}
