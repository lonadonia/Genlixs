import "server-only";
import { mediaAllowedHosts } from "@/lib/media/hosts";

/**
 * Server configuration (guide §6). Values are read lazily and validated at the feature boundary: a missing
 * secret disables that feature with an explicit operational error instead of silently faking it.
 * Never log values returned from here.
 */
export class ConfigError extends Error {
  constructor(
    public readonly feature: string,
    public readonly missing: string[],
  ) {
    super(`${feature} is not configured (missing ${missing.join(", ")})`);
    this.name = "ConfigError";
  }
}

const read = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export function requireEnv(feature: string, ...keys: string[]): string[] {
  const values = keys.map(read);
  const missing = keys.filter((_, i) => !values[i]);
  if (missing.length) throw new ConfigError(feature, missing);
  return values as string[];
}

export const env = {
  supabaseUrl: () => read("SUPABASE_URL") ?? read("NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey: () => read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  secretKey: () => read("SUPABASE_SECRET_KEY"),
  appBaseUrl: () => (read("APP_BASE_URL") ?? (read("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${read("VERCEL_PROJECT_PRODUCTION_URL")}` : undefined))?.replace(/\/+$/, ""),
  kieBaseUrl: () => read("KIE_API_BASE_URL") ?? "https://api.kie.ai",
  kieApiKey: () => read("KIE_API_KEY"),
  kieHmacKey: () => read("KIE_WEBHOOK_HMAC_KEY"),
  kieCallbackBaseUrl: () => read("KIE_CALLBACK_BASE_URL")?.replace(/\/+$/, ""),
  workerToken: () => read("INTERNAL_WORKER_TOKEN"),
  referralSigningKey: () => read("REFERRAL_COOKIE_SIGNING_KEY"),
  /** Reviewed KIE delivery hosts plus valid additions from MEDIA_FETCH_ALLOWED_HOSTS (see lib/media/hosts). */
  mediaAllowedHosts: () => mediaAllowedHosts(read("MEDIA_FETCH_ALLOWED_HOSTS")),
  billingProvider: () => read("BILLING_PROVIDER"),
  billingWebhookSecret: () => read("BILLING_WEBHOOK_SECRET"),
  generationPaused: () => read("GENERATION_PAUSED") === "true",
  allowPaidProviderTests: () => read("ALLOW_PAID_PROVIDER_TESTS") === "true",
  /** Deterministic fake provider: only with an explicit flag and never on a production deployment. */
  fakeProvider: () => read("GENLIXS_FAKE_PROVIDER") === "1" && !isProductionDeployment(),
};

/** Production = the Vercel production environment (local `next start` is not production for this purpose). */
export function isProductionDeployment() {
  return read("VERCEL_ENV") === "production";
}
