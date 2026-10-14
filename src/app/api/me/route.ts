import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Verified identity + allowed capability projection (§20.1). Never trusts user metadata for roles. */
export const GET = withUser(async (_req, { supabase, user, requestId }) => {
  const [{ data: profile }, capabilities] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, locale, account_status, marketing_opt_in, email_notifications, goal, created_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    rpc<string[]>(supabase, "my_capabilities"),
  ]);
  const caps = capabilities ?? [];
  return ok(
    {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.email_confirmed_at),
      displayName: profile?.display_name ?? null,
      locale: profile?.locale ?? "en",
      accountStatus: profile?.account_status ?? "active",
      marketingOptIn: profile?.marketing_opt_in ?? false,
      emailNotifications: profile?.email_notifications ?? true,
      goal: profile?.goal ?? null,
      createdAt: profile?.created_at ?? null,
      capabilities: caps,
      isStaff: caps.includes("admin.access"),
    },
    200,
    requestId,
  );
});

/** Allowlisted own profile/preferences only. */
export const PATCH = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const patch: Record<string, unknown> = {};
  if ("displayName" in body) patch.displayName = input.str(body.displayName, "Display name", { max: 80, optional: true }) ?? "";
  if ("locale" in body) patch.locale = input.oneOf(body.locale, "Language", ["en", "ar", "fr"] as const);
  if ("marketingOptIn" in body) patch.marketingOptIn = input.bool(body.marketingOptIn, "Marketing preference");
  if ("emailNotifications" in body) patch.emailNotifications = input.bool(body.emailNotifications, "Email notifications");
  if ("goal" in body) patch.goal = input.oneOf(body.goal, "Goal", ["social", "product", "concepts", "other"] as const);
  return ok(await rpc(supabase, "update_my_profile", { p_patch: patch }), 200, requestId);
});
