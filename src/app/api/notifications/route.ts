import { ok, withUser } from "@/lib/server/http";

/** Own notifications (newest 50) and unread count. RLS limits rows to the owner. */
export const GET = withUser(async (_req, { supabase, requestId }) => {
  const [{ data, error }, { count }] = await Promise.all([
    supabase.from("notifications").select("id, kind, title, body, link, read_at, created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (error) throw error;
  return ok({ items: data ?? [], unread: count ?? 0 }, 200, requestId);
});
