import { input, ok, rpc, withUser } from "@/lib/server/http";

/** Own cursor-paginated credit statement (`before` = createdAt cursor). */
export const GET = withUser(async (req, { supabase, requestId }) => {
  const q = req.nextUrl.searchParams;
  const before = q.get("before");
  if (before && Number.isNaN(Date.parse(before))) return ok([], 200, requestId);
  const data = await rpc(supabase, "get_credit_statement", {
    p_before: before || null,
    p_limit: input.int(q.get("limit") ?? undefined, "limit", { min: 1, max: 100, optional: true }) ?? 50,
  });
  return ok(data, 200, requestId);
});
