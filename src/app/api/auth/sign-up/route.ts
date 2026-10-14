import { ApiError, input, ok, readJson, withRequest } from "@/lib/server/http";
import { serverClient } from "@/lib/supabase/server";
import { env } from "@/lib/server/env";
import { referralClickId } from "@/lib/auth/referral";
import { safeNext } from "@/lib/auth/redirect";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email/password sign-up through Supabase Auth (§7.1). The only metadata passed is a display name and the
 * verified referral click id; roles never come from metadata. The answer does not reveal whether the email exists.
 */
export const POST = withRequest(async (req, { requestId }) => {
  const body = await readJson(req);
  const email = input.str(body.email, "Email", { min: 3, max: 254 })!.toLowerCase();
  if (!EMAIL.test(email)) throw new ApiError("INVALID_INPUT", "Enter an email address like name@example.com.", 422);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 72) throw new ApiError("INVALID_INPUT", "Use 8 to 72 characters for your password.", 422);
  const next = safeNext(body.next) ?? "/studio";

  const supabase = await serverClient();
  const base = env.appBaseUrl() ?? req.nextUrl.origin;
  const clickId = await referralClickId();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${base}/auth/callback?next=${encodeURIComponent(next)}`,
      data: { ...(clickId ? { referral_click_id: clickId } : {}) },
    },
  });
  if (error) {
    if (error.status === 429) throw new ApiError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", 429);
    if (/password/i.test(error.message)) throw new ApiError("WEAK_PASSWORD", "Choose a stronger password.", 422);
    // Includes "already registered": answer generically so the form cannot be used to probe accounts.
    if (error.status && error.status < 500 && !/registered|exists/i.test(error.message)) {
      throw new ApiError("SIGN_UP_FAILED", "We could not create the account. Check the details and try again.", 422);
    }
  }
  const signedIn = Boolean(data?.session);
  return ok({ signedIn, next: signedIn ? next : null, checkEmail: !signedIn }, 200, requestId);
});
