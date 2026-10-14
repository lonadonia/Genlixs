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
