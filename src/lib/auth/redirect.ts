/** Only same-site relative paths are accepted as post-auth destinations (open-redirect defence). */
export function safeNext(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.length > 300) return null;
  return v;
}
