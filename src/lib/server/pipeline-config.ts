import "server-only";
import { lookup } from "node:dns/promises";
import { env } from "./env";
import { parseHostList } from "@/lib/media/hosts";

const hostOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

async function resolves(host: string | null): Promise<boolean | null> {
  if (!host) return null;
  try {
    const r = await Promise.race([
      lookup(host, { all: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return Array.isArray(r) ? r.length > 0 : null;
  } catch {
    return false;
  }
}

/**
 * Generation-related configuration of this deployment, for the staff health panel: which public origins are used
 * (host names only, they are not secrets), whether they resolve, and which features are configured. Never values of
 * keys or tokens.
 */
export async function pipelineConfig() {
  const appBase = env.appBaseUrl() ?? null;
  const callbackBase = env.kieCallbackBaseUrl() ?? appBase;
  const appHost = hostOf(appBase);
  const callbackHost = hostOf(callbackBase);
  const rawHosts = process.env.MEDIA_FETCH_ALLOWED_HOSTS ?? "";
  const [appResolves, callbackResolves] = await Promise.all([resolves(appHost), resolves(callbackHost)]);
  return {
    deployment: {
      environment: process.env.VERCEL_ENV ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
    },
    appBase: { host: appHost, resolves: appResolves },
    callbacks: { host: callbackHost, resolves: callbackResolves, signed: Boolean(env.kieHmacKey()) },
    provider: { keyConfigured: Boolean(env.kieApiKey()), fake: env.fakeProvider(), paused: env.generationPaused() },
    resultHosts: {
      effective: env.mediaAllowedHosts(),
      configuredValuePresent: rawHosts.trim().length > 0,
      configuredHostsUnderstood: parseHostList(rawHosts).length,
    },
  };
}
