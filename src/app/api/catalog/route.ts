import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/server/env";
import { fail, newRequestId, rpc, toResponse } from "@/lib/server/http";

/** Published tools/models/capabilities (safe public projection, §19.1). Briefly cached at the edge. */
export async function GET() {
  const requestId = newRequestId();
  try {
    const url = env.supabaseUrl();
    const key = env.publishableKey();
    if (!url || !key) return fail("NOT_CONFIGURED", "The catalog is not available yet on this deployment.", 503, undefined, requestId);
    const anon = createClient(url, key, { auth: { persistSession: false } });
    const data = await rpc<{ generationPaused: boolean }>(anon, "get_catalog");
    data.generationPaused = data.generationPaused || env.generationPaused();
    return NextResponse.json({ data, requestId }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    return toResponse(e, requestId);
  }
}
