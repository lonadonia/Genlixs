import { input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Marks own notifications read (all when `ids` is omitted). */
export const POST = withUser(async (req, { supabase, requestId }) => {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100).map((v: unknown, i: number) => input.uuid(v, `Notification ${i + 1}`)) : null;
  const updated = await rpc<number>(supabase, "mark_notifications_read", { p_ids: ids });
  return ok({ updated }, 200, requestId);
});
