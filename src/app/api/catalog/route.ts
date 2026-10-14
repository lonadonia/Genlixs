import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/server/env";
import { fail, newRequestId, rpc, toResponse } from "@/lib/server/http";

/**
 * Published tools/models/capabilities (safe public projection, §19.1). Cached at the edge for a few seconds only,
 * so enabling or disabling a model reaches customers almost at once; quotes and submissions re-check availability
 * in the database regardless of what a cached catalog shows.
 */
export async function GET() {
  const requestId = newRequestId();
  try {
    const url = env.supabaseUrl();
    const key = env.publishableKey();
    if (!url || !key) return fail("NOT_CONFIGURED", "The catalog is not available yet on this deployment.", 503, undefined, requestId);
    const anon = createClient(url, key, { auth: { persistSession: false } });
    const data = await rpc<{ generationPaused: boolean }>(anon, "get_catalog");
    data.generationPaused = data.generationPaused || env.generationPaused();
    return NextResponse.json({ data, requestId }, { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } });
  } catch (e) {
    return toResponse(e, requestId);
  }
}
