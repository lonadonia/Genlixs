import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { kickWorker } from "@/lib/jobs/kick";
import { env } from "@/lib/server/env";

export const maxDuration = 60;

/**
 * One idempotent generation intent (§10.2, §20.1): quote + Idempotency-Key → atomic reserve/job/queue → 202.
 * A retry with the same key returns the same job and never reserves twice.
 */
export const POST = withUser(async (req, { supabase, requestId }) => {
  if (env.generationPaused()) throw new ApiError("GENERATION_PAUSED", "New generations are paused for maintenance. Please try again later.", 503);
  const key = input.idempotencyKey(req);
  const body = await readJson(req);
  const data = await rpc<{ replayed: boolean }>(supabase, "create_generation", {
    p_quote_id: input.uuid(body.quoteId, "Quote"),
    p_idempotency_key: key,
  });
  if (!data.replayed) kickWorker("control");
  return ok(data, 202, requestId);
});

/** Own filtered history with a createdAt cursor. */
export const GET = withUser(async (req, { supabase, requestId }) => {
  const q = req.nextUrl.searchParams;
  const before = q.get("before");
  const data = await rpc(supabase, "list_generations", {
    p_before: before && !Number.isNaN(Date.parse(before)) ? before : null,
    p_limit: input.int(q.get("limit") ?? undefined, "limit", { min: 1, max: 60, optional: true }) ?? 24,
    p_tool: input.oneOf(q.get("tool") ?? undefined, "tool", ["image", "edit", "video"] as const, true) ?? null,
    p_state: input.str(q.get("state") ?? undefined, "state", { max: 30, optional: true }) ?? null,
    p_favorites: q.get("favorites") === "1",
  });
  return ok(data, 200, requestId);
});
