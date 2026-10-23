/**
 * Supplier model ids per input mode. Some suppliers expose one model as several endpoints (text-to-video and
 * image-to-video ids, for example); the catalog row or offer then stores "default;mode=id;mode=id" and the request
 * uses the id of the job's input mode, or the default when the mode has none. A plain id is used for every mode.
 */
export function upstreamFor(id: string, mode?: string | null): string {
  if (!id.includes(";")) return id;
  const [first, ...rest] = id.split(";");
  for (const part of rest) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at) === mode) return part.slice(at + 1);
  }
  return first;
}

/** Every distinct id named by an encoded value (for listings and checks). */
export function upstreamIds(id: string): string[] {
  const [first, ...rest] = id.split(";");
  return [...new Set([first, ...rest.map((p) => p.slice(p.indexOf("=") + 1))].filter(Boolean))];
}
