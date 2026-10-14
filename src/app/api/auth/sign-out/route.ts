import { ok, withRequest } from "@/lib/server/http";
import { serverClient } from "@/lib/supabase/server";

/** Ends the session on this device (clears the session cookies). */
export const POST = withRequest(async (_req, { requestId }) => {
  const supabase = await serverClient();
  await supabase.auth.signOut({ scope: "local" });
  return ok({ signedOut: true }, 200, requestId);
});
