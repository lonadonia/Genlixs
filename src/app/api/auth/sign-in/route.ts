import { ApiError, input, ok, readJson, withRequest } from "@/lib/server/http";
import { serverClient } from "@/lib/supabase/server";

/** Password sign-in; one generic message for wrong email or password (no account enumeration). */
export const POST = withRequest(async (req, { requestId }) => {
  const body = await readJson(req);
  const email = input.str(body.email, "Email", { min: 3, max: 254 })!.toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) throw new ApiError("INVALID_INPUT", "Enter your password.", 422);
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    if (error?.status === 429) throw new ApiError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", 429);
    if (error && /confirm/i.test(error.message)) {
      throw new ApiError("EMAIL_NOT_VERIFIED", "Confirm your email first — open the link we sent you, then sign in.", 403);
    }
    throw new ApiError("INVALID_CREDENTIALS", "The email or password is not correct.", 401);
  }
  return ok({ signedIn: true }, 200, requestId);
});
