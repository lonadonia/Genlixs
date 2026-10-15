import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";
import { env } from "@/lib/server/env";

/**
 * Server-validated, frozen quote (§11.2). Price comes only from the published price version. Requests with typed
 * inputs ({"first_frame": [assetId], "source_video": [assetId], …}) are validated per slot by the database; the
 * single-reference form stays for image tools.
 */
export const POST = withUser(async (req, { supabase, requestId }) => {
  if (env.generationPaused()) throw new ApiError("GENERATION_PAUSED", "New generations are paused for maintenance. Please try again later.", 503);
  const body = await readJson(req);
  const options = body.options ?? {};
  if (typeof options !== "object" || Array.isArray(options)) throw new ApiError("INVALID_INPUT", "Options must be an object.", 422);
  const modelId = input.str(body.modelId, "Model", { min: 1, max: 60 });
  // Motion transfer accepts an empty prompt; every other check (length, need) is the model's rule in the database.
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 20000) : "";
  if (body.inputs !== undefined && body.inputs !== null) {
    const data = await rpc(supabase, "create_generation_quote_v2", {
      p_model_id: modelId,
      p_prompt: prompt,
      p_options: options,
      p_inputs: input.slots(body.inputs),
    });
    return ok(data, 201, requestId);
  }
  const refs = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];
  if (refs.length > 16) throw new ApiError("TOO_MANY_REFERENCES", "Too many reference images.", 422);
  const data = await rpc(supabase, "create_generation_quote", {
    p_model_id: modelId,
    p_prompt: input.str(prompt, "Prompt", { min: 1, max: 20000 }),
    p_options: options,
    p_reference_asset_ids: refs.map((r: unknown, i: number) => input.uuid(r, `Reference ${i + 1}`)),
  });
  return ok(data, 201, requestId);
});
