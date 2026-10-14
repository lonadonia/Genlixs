import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/server/env";
import { signValue, verifySignedValue } from "@/lib/server/crypto";

/** First-party referral cookie (§18.2): click id + HMAC, set only with consent, read at sign-up. */
export const REFERRAL_COOKIE = "gx_ref";
export const REFERRAL_MAX_AGE = 30 * 24 * 60 * 60;

export function signedReferral(clickId: string): string | null {
  const key = env.referralSigningKey();
  return key ? signValue(key, clickId) : null;
}

/** The verified click id from the cookie, or null when absent, tampered or signing is not configured. */
export async function referralClickId(): Promise<string | null> {
  const key = env.referralSigningKey();
  if (!key) return null;
  const store = await cookies();
  const v = verifySignedValue(key, store.get(REFERRAL_COOKIE)?.value);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
