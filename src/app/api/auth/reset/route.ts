import { input, ok, readJson, withRequest } from "@/lib/server/http";
import { serverClient } from "@/lib/supabase/server";
import { env } from "@/lib/server/env";

/** Password reset request. Always answers the same way, whether or not the email has an account. */
export const POST = withRequest(async (req, { requestId }) => {
  const body = await readJson(req);
  const email = input.str(body.email, "Email", { min: 3, max: 254 })!.toLowerCase();
  const supabase = await serverClient();
  const base = env.appBaseUrl() ?? req.nextUrl.origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/callback?next=/account/reset` });
  if (error && error.status !== 429) console.warn("[auth-reset] provider error", error.status);
  return ok({ sent: true }, 200, requestId);
});
