import { ApiError, ok, readJson, withUser } from "@/lib/server/http";

/** Sets a new password for the signed-in user (after the reset link or from settings). */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 72) throw new ApiError("INVALID_INPUT", "Use 8 to 72 characters for your password.", 422);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (/reauth|recent/i.test(error.message)) throw new ApiError("REAUTH_REQUIRED", "Sign in again, then change your password.", 403);
    throw new ApiError("PASSWORD_UPDATE_FAILED", "The password could not be changed. Choose a different password.", 422);
  }
  return ok({ updated: true }, 200, requestId);
});
