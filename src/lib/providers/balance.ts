import "server-only";
import { env } from "@/lib/server/env";
import { adminClient } from "@/lib/supabase/admin";
import { FakeProvider } from "./fake";
import { KieProvider } from "./kie/client";
import type { BalanceRead } from "./types";

/** A live KIE balance read needs only the server key (reading spends nothing). The key never leaves the server. */
export const balanceReadable = () => env.fakeProvider() || Boolean(env.kieApiKey());

let inflight: Promise<BalanceRead> | null = null;

/**
 * One live balance read per instance at a time: concurrent callers share the same request and the same recorded
 * snapshot. Cross-instance and cross-tab deduplication is done in the database (admin_begin_balance_refresh).
 * A failure is recorded with its error code and never replaces the last real value.
 */
export function readAndRecordBalance(source: "admin" | "auto" | "worker"): Promise<BalanceRead> {
  if (inflight) return inflight;
  inflight = (async (): Promise<BalanceRead> => {
    let read: BalanceRead;
    if (!balanceReadable()) {
      read = { ok: false, error: "NOT_CONFIGURED" };
    } else {
      try {
        read = await (env.fakeProvider() ? new FakeProvider() : new KieProvider()).readBalance();
      } catch {
        read = { ok: false, error: "CONFIGURATION" };
      }
    }
    const { error } = await adminClient().rpc("record_provider_balance_result", {
      p_ok: read.ok,
      p_credits: read.ok ? read.credits : null,
      p_error: read.ok ? null : read.error,
      p_source: source,
    });
    if (error) console.error("[balance] record failed", error.code);
    return read;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
