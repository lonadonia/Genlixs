import "server-only";
import { after } from "next/server";
import { adminConfigured } from "@/lib/supabase/admin";
import { runWorker, type QueueKind } from "./worker";

/**
 * Runs a short worker pass after the response is sent, so fresh work starts without waiting for the
 * scheduled wake-up. Durability never depends on this: the cron wake-up and watchdog cover any miss.
 */
export function kickWorker(kind: QueueKind, budgetMs = 20_000) {
  if (!adminConfigured()) return;
  after(async () => {
    try {
      await runWorker(kind, { budgetMs, workerName: `after-${kind}` });
    } catch (e) {
      console.error(`[kick:${kind}]`, e instanceof Error ? e.message : e);
    }
  });
}

type JobLike = { id: string; state: string; nextActionAt?: string | null; lastCheckedAt?: string | null };
const lastNudge = new Map<string, number>();

/**
 * While a customer watches a running job, its due status check or import starts right away instead of at the next
 * one-minute wake-up. At most one nudge per job every 15 s per server instance; the work itself is fenced, so a
 * duplicate nudge only finds the item busy. Closing the page changes nothing: the scheduled wake-ups continue.
 */
export function nudgeForJob(job: JobLike, now = Date.now()) {
  const due = !job.nextActionAt || Date.parse(job.nextActionAt) <= now;
  const kind: QueueKind | null =
    job.state === "importing" ? "media" : ["queued", "provider_pending", "processing_delayed", "submission_unknown"].includes(job.state) && due ? "control" : null;
  if (!kind) return false;
  const last = lastNudge.get(job.id) ?? 0;
  if (now - last < 15_000) return false;
  lastNudge.set(job.id, now);
  if (lastNudge.size > 500) for (const [k, t] of lastNudge) if (now - t > 60_000) lastNudge.delete(k);
  kickWorker(kind, kind === "media" ? 45_000 : 10_000);
  return true;
}
