import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side download of provider result files (guide §16.4): HTTPS only, reviewed host allowlist,
 * public-address check on every hop, manual redirects, byte cap and deadline. No credentials are sent.
 */
export class FetchRejected extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FetchRejected";
  }
}

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

function ipv6Private(ip: string) {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return ipv4Private(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
}

export function isPrivateAddress(ip: string) {
  const fam = isIP(ip);
  if (fam === 4) return ipv4Private(ip);
  if (fam === 6) return ipv6Private(ip);
  return true;
}

export function checkUrl(raw: string, allowedHosts: string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchRejected("invalid url", false);
  }
  if (u.protocol !== "https:") throw new FetchRejected("non-https url", false);
  if (u.username || u.password) throw new FetchRejected("credentials in url", false);
  if (u.port && u.port !== "443") throw new FetchRejected("non-standard port", false);
  const host = u.hostname.toLowerCase();
  if (isIP(host)) throw new FetchRejected("ip literal host", false);
  if (!allowedHosts.includes(host)) throw new FetchRejected(`host not allowlisted: ${host}`, false);
  return u;
}

async function assertPublicDns(host: string) {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchRejected("dns lookup failed", true);
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new FetchRejected("host resolves to a non-public address", false);
}

export async function safeDownload(
  rawUrl: string,
  opts: { allowedHosts: string[]; maxBytes: number; timeoutMs: number; maxRedirects?: number },
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  let url = checkUrl(rawUrl, opts.allowedHosts);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    await assertPublicDns(url.hostname);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: deadline, cache: "no-store", headers: { Accept: "image/*,video/*" } });
    } catch {
      throw new FetchRejected("download failed or timed out", true);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new FetchRejected("redirect without location", false);
      url = checkUrl(new URL(loc, url).toString(), opts.allowedHosts);
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new FetchRejected(`result file missing (${res.status})`, false);
    if (!res.ok) throw new FetchRejected(`download HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > opts.maxBytes) {
      await res.body?.cancel();
      throw new FetchRejected("file larger than allowed", false);
    }
    if (!res.body) throw new FetchRejected("empty body", true);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel();
          throw new FetchRejected("file larger than allowed", false);
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof FetchRejected) throw e;
      throw new FetchRejected("download interrupted", true);
    }
    if (total === 0) throw new FetchRejected("empty file", true);
    return { bytes: new Uint8Array(Buffer.concat(chunks)), contentType: res.headers.get("content-type") };
  }
  throw new FetchRejected("too many redirects", false);
}
