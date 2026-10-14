import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { bearerMatches } from "@/lib/server/crypto";
import { adminConfigured } from "@/lib/supabase/admin";
import { QUEUE_KINDS, recordProviderBalance, runWorker, type QueueKind } from "@/lib/jobs/worker";

export const maxDuration = 300;

/**
 * Allowlisted bounded worker (§13.3), woken every minute by Supabase Cron + pg_net with the internal token.
 * Never redirects to sign-in; answers 401/404/503 explicitly.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const token = env.workerToken();
  if (!token) return reply(503, { error: "not_configured" });
  if (!bearerMatches(req.headers.get("authorization"), token)) return reply(401, { error: "unauthorized" });
  const { kind } = await params;
  if (!QUEUE_KINDS.includes(kind as QueueKind)) return reply(404, { error: "unknown_queue" });
  if (!adminConfigured()) return reply(503, { error: "not_configured" });
  try {
    const summary = await runWorker(kind as QueueKind);
    // Supplier balance observation roughly every ten minutes from the control worker.
    if (kind === "control" && new Date().getUTCMinutes() % 10 === 0) await recordProviderBalance().catch(() => null);
    return reply(200, summary);
  } catch (e) {
    console.error(`[worker-route:${kind}]`, e instanceof Error ? e.message : e);
    return reply(500, { error: "worker_failed" });
  }
}
