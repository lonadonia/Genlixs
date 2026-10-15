/**
 * Result-download host allowlist (guide §16.4). The reviewed KIE delivery hosts are always allowed; the
 * MEDIA_FETCH_ALLOWED_HOSTS setting can only add hosts. Parsing is tolerant of how the value was pasted
 * (a leading "NAME=", quotes, spaces or new lines instead of commas, a scheme or path) so a formatting slip
 * cannot silently block every import, yet each entry must still be a plain DNS host name.
 */
export const DEFAULT_MEDIA_HOSTS = ["tempfile.aiquickdraw.com", "file.aiquickdraw.com", "tempfile.redpandaai.co", "file.redpandaai.co"] as const;

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Host names from a configured list; anything that is not a host name is dropped, never widened. */
export function parseHostList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const body = raw.trim().replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, "");
  const out = new Set<string>();
  for (const part of body.split(/[\s,;]+/)) {
    let h = part.trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:443$/, "").replace(/\.$/, "");
    if (HOST.test(h)) out.add(h);
  }
  return [...out];
}

/** Effective allowlist: the reviewed defaults plus any valid configured additions. */
export function mediaAllowedHosts(raw: string | null | undefined): string[] {
  return [...new Set<string>([...DEFAULT_MEDIA_HOSTS, ...parseHostList(raw)])];
}
