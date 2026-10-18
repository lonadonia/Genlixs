import "server-only";
import { env } from "@/lib/server/env";
import { adminClient } from "@/lib/supabase/admin";
import type { AttemptRoute } from "./types";

/**
 * Supplier keys for server code only. A key saved in Admin lives in Supabase Vault and is read with the service role
 * (worker_provider_credential); each version is immutable, so a short in-memory cache per instance needs no
 * invalidation. KIE without an Admin key keeps reading KIE_API_KEY. Keys are never logged or returned to a browser.
 */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { key: string; until: number }>();

type Source = Pick<AttemptRoute, "provider" | "accountId" | "credentialVersion" | "credentialSource" | "secretRef">;

export async function credentialFor(route: Source): Promise<string> {
  if (env.fakeProvider()) return "fake";
  if (route.credentialSource === "environment" || route.credentialVersion === 0) {
    // Only the documented KIE environment secret can be read this way; an Admin field can never name another one.
    if (route.provider !== "kie" || route.secretRef !== "KIE_API_KEY") throw new CredentialError("no key saved for this provider");
    const k = env.kieApiKey();
    if (!k) throw new CredentialError("KIE_API_KEY is not set on this deployment");
    return k;
  }
  const id = `${route.accountId}:${route.credentialVersion}`;
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.key;
  const { data, error } = await adminClient().rpc("worker_provider_credential", { p_account_id: route.accountId, p_version: route.credentialVersion });
  const secret = !error && data && typeof (data as { secret?: unknown }).secret === "string" ? (data as { secret: string }).secret : null;
  if (!secret) throw new CredentialError("the key version for this provider is not available");
  cache.set(id, { key: secret, until: Date.now() + TTL_MS });
  return secret;
}

/** Masked form for messages: never more than the last four characters. */
export const maskKey = (key: string) => (key.length <= 8 ? "••••" : `••••${key.slice(-4)}`);
