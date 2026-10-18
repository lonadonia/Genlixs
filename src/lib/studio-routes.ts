/**
 * Studio routes that moved (contract-tested). Image editing lives inside the Image studio since Oct 2026: earlier links
 * to /studio/edit open /studio/image with Edit selected and keep every other query parameter, in order.
 */
export const IMAGE_EDIT_HREF = "/studio/image?mode=edit";

export function imageEditRedirect(searchParams: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === "mode") continue;
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, x);
  }
  q.set("mode", "edit");
  return `/studio/image?${q.toString()}`;
}

/** Video studio canvas: History (default), Motion Library or How it works (`?view=library|how`). */
export type CanvasView = "history" | "library" | "how";
export const canvasViewOf = (v: string | null | undefined): CanvasView => (v === "library" || v === "how" ? v : "history");

/** The Image studio's mode from its query (`?mode=edit`); anything else is Generate. */
export const imageModeOf = (mode: string | string[] | undefined): "image" | "edit" => (mode === "edit" ? "edit" : "image");
