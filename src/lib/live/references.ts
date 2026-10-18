/**
 * Reference images for Image Edit (contract-tested). The selected model's capability decides how many images it
 * takes, which types and how large; uploads keep the customer's order, a later selection appends, and switching to a
 * model that takes fewer images never discards files silently — the request is blocked with an explanation until the
 * customer removes images or picks a model that takes them all.
 */
import type { CatalogModel } from "./types";

export type RefItem = {
  key: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  name: string;
  mime: string;
  previewUrl?: string;
  assetId?: string;
  error?: string;
};

export type RefLimit = { min: number; max: number; mime: string[]; maxBytes: number };

const DEFAULT_MIME = ["image/png", "image/jpeg", "image/webp"];

export function referenceLimit(model: Pick<CatalogModel, "references"> | null): RefLimit {
  const r = model?.references;
  return { min: r?.min ?? 0, max: r?.max ?? 0, mime: r?.mime?.length ? r.mime : DEFAULT_MIME, maxBytes: r?.maxBytes ?? 10 * 1024 * 1024 };
}

/** Items that count against the limit: everything except refused files (those are shown so they can be removed). */
export const countedRefs = (items: RefItem[]) => items.filter((i) => i.status !== "error");
export const readyRefIds = (items: RefItem[]) => items.filter((i) => i.status === "ready" && i.assetId).map((i) => i.assetId as string);

const typeLabel = (m: string) => m.split("/")[1]?.replace("jpeg", "JPG").toUpperCase() ?? m;

/** Splits a new selection into files to upload (in order, within the remaining room) and refused files with reasons. */
export function planAdd<F extends { name: string; size: number; mime: string | null }>(limit: RefLimit, items: RefItem[], files: F[]) {
  let room = Math.max(0, limit.max - countedRefs(items).length);
  const accepted: F[] = [];
  const rejected: { file: F; reason: string }[] = [];
  for (const f of files) {
    if (!f.mime || !limit.mime.includes(f.mime)) rejected.push({ file: f, reason: `${f.name}: use ${limit.mime.map(typeLabel).join(", ")}.` });
    else if (f.size > limit.maxBytes) rejected.push({ file: f, reason: `${f.name} is larger than ${Math.round(limit.maxBytes / 1048576)} MB.` });
    else if (f.size === 0) rejected.push({ file: f, reason: `${f.name} is empty.` });
    else if (room <= 0) rejected.push({ file: f, reason: `${f.name} was not added: this model takes up to ${limit.max} image${limit.max === 1 ? "" : "s"}.` });
    else {
      accepted.push(f);
      room -= 1;
    }
  }
  return { accepted, rejected };
}

/** Why the references cannot be priced yet (null = fine). */
export function referenceProblem(limit: RefLimit, items: RefItem[]): string | null {
  if (items.some((i) => i.status === "uploading")) return "Waiting for the upload to finish";
  if (items.some((i) => i.status === "error")) return "Remove the image that could not be used";
  const n = readyRefIds(items).length;
  if (n < limit.min) return limit.min === 1 ? "Add the image to edit" : `Add at least ${limit.min} images`;
  if (n > limit.max) {
    const extra = n - limit.max;
    return `This model takes up to ${limit.max} image${limit.max === 1 ? "" : "s"} — remove ${extra} or choose a model that takes ${n}`;
  }
  return null;
}

/** Usable models that accept every current reference, for the "choose a model that takes them all" shortcut. */
export function modelsTaking<M extends Pick<CatalogModel, "id" | "references">>(models: M[], count: number): M[] {
  return models.filter((m) => referenceLimit(m).max >= count);
}
