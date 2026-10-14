import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { env } from "@/lib/server/env";

/** Server-validated, frozen quote (§11.2). Price comes only from the published price version. */
export const POST = withUser(async (req, { supabase, requestId }) => {
  if (env.generationPaused()) throw new ApiError("GENERATION_PAUSED", "New generations are paused for maintenance. Please try again later.", 503);
  const body = await readJson(req);
  const options = body.options ?? {};
  if (typeof options !== "object" || Array.isArray(options)) throw new ApiError("INVALID_INPUT", "Options must be an object.", 422);
  const refs = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];
  if (refs.length > 16) throw new ApiError("TOO_MANY_REFERENCES", "Too many reference images.", 422);
  const data = await rpc(supabase, "create_generation_quote", {
    p_model_id: input.str(body.modelId, "Model", { min: 1, max: 60 }),
    p_prompt: input.str(body.prompt, "Prompt", { min: 1, max: 20000 }),
    p_options: options,
    p_reference_asset_ids: refs.map((r: unknown, i: number) => input.uuid(r, `Reference ${i + 1}`)),
  });
  return ok(data, 201, requestId);
});
