import { input, ok, withUser } from "@/lib/server/http";

/** Own verified library (saved outputs), newest first, createdAt cursor. RLS limits rows to the owner. */
export const GET = withUser(async (req, { supabase, requestId }) => {
  const q = req.nextUrl.searchParams;
  const before = q.get("before");
  let query = supabase
    .from("assets")
    .select("id, job_id, mime, bytes, width, height, duration_ms, created_at, retention_until")
    .eq("kind", "output")
    .eq("state", "ready")
    .order("created_at", { ascending: false })
    .limit(input.int(q.get("limit") ?? undefined, "limit", { min: 1, max: 60, optional: true }) ?? 24);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return ok(data ?? [], 200, requestId);
});
