import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/server/env";
import { fail, newRequestId, rpc, toResponse } from "@/lib/server/http";

/** Published products and their server-side amounts. Empty until the owner publishes approved prices. */
export async function GET() {
  const requestId = newRequestId();
  try {
    const url = env.supabaseUrl();
    const key = env.publishableKey();
    if (!url || !key) return fail("NOT_CONFIGURED", "Plans are not available yet on this deployment.", 503, undefined, requestId);
    const anon = createClient(url, key, { auth: { persistSession: false } });
    const data = await rpc(anon, "get_products");
    return NextResponse.json({ data, requestId }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    return toResponse(e, requestId);
  }
}
