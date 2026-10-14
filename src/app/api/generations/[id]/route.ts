import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/** Own job with public events and saved deliverables. Another customer's id is indistinguishable from missing. */
export const GET = withUser<{ id: string }>(async (_req, { supabase, params, requestId }) => {
  const job = await rpc(supabase, "get_generation", { p_job_id: input.uuid(params.id, "Job") });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found.", 404);
  return ok(job, 200, requestId);
});

export const PATCH = withUser<{ id: string }>(async (req, { supabase, params, requestId }) => {
  const body = await readJson(req);
  const data = await rpc(supabase, "set_generation_flags", {
    p_job_id: input.uuid(params.id, "Job"),
    p_favorite: input.bool(body.favorite, "Favorite", true) ?? null,
    p_hidden: input.bool(body.hidden, "Hidden", true) ?? null,
  });
  return ok(data, 200, requestId);
});
