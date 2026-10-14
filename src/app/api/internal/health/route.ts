import { NextResponse, type NextRequest } from "next/server";
import { env, isProductionDeployment } from "@/lib/server/env";
import { bearerMatches } from "@/lib/server/crypto";
import { adminClient, adminConfigured } from "@/lib/supabase/admin";
import { billingGateway } from "@/lib/billing";

/**
 * Operational health for the internal token holder: queue/job counts and which features are configured.
 * Reports presence only — never values, keys or customer data (§23.1).
 */
export async function GET(req: NextRequest) {
  const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const token = env.workerToken();
  if (!token) return reply(503, { error: "not_configured" });
  if (!bearerMatches(req.headers.get("authorization"), token)) return reply(401, { error: "unauthorized" });

  let billing: string = "not_configured";
  try {
    billing = billingGateway()?.name ?? "not_configured";
  } catch {
    billing = "misconfigured";
  }
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const config = {
    production: isProductionDeployment(),
    supabasePublic: Boolean(publicUrl && env.publishableKey()),
    supabaseSecret: adminConfigured(),
    supabaseProjectsMatch: !process.env.SUPABASE_URL || !publicUrl || process.env.SUPABASE_URL === publicUrl,
    provider: env.fakeProvider() ? "fake" : env.kieApiKey() ? "kie" : "not_configured",
    providerCallbackHmac: Boolean(env.kieHmacKey()),
    callbackBase: Boolean(env.kieCallbackBaseUrl() ?? env.appBaseUrl()),
    referralSigning: Boolean(env.referralSigningKey()),
    billing,
  };
  let db: unknown = null;
  if (adminConfigured()) {
    const { data, error } = await adminClient().rpc("system_health");
    db = error ? { error: "unavailable" } : data;
  }
  return reply(200, { config, db });
}
