import "server-only";
import { adminClient } from "@/lib/supabase/admin";
import { credentialFor } from "./credentials";
import { providerClient } from "./registry";
import type { ProviderName } from "./types";

/**
 * Balance and usage reads for every configured provider account. Each read is a documented read-only call (never a
 * generation); the result — success or a short error code — is recorded by the database, which keeps unknown as NULL
 * and never replaces a real value with a failed read.
 */
export type CheckTarget = {
  accountId: string;
  provider: ProviderName;
  credentialVersion: number;
  credentialSource: "vault" | "environment" | "none";
  secretRef: string | null;
};

export async function checkProvider(t: CheckTarget, source: "admin" | "auto" | "worker", connection: boolean) {
  const db = adminClient();
  let result: Record<string, unknown>;
  try {
    const key = await credentialFor({ ...t });
    const client = providerClient(t.provider);
    const b = client.balanceSupport === "none" ? { ok: false as const, error: "NO_BALANCE_ENDPOINT", state: "unsupported" as const } : await client.readBalance(key);
    result = b.ok
      ? { ok: true, total: b.total, available: b.available, held: b.held, unit: b.unit, scope: b.scope, unlimited: b.unlimited ?? false, note: b.note ?? null }
      : { ok: false, error: b.error, state: b.state };
  } catch (e) {
    result = { ok: false, error: e instanceof Error && e.name === "CredentialError" ? "CREDENTIAL_UNAVAILABLE" : "CONFIGURATION", state: "failed" };
  }
  const { data, error } = await db.rpc("record_provider_check", { p_account_id: t.accountId, p_result: { ...result, source, connection } });
  if (error) console.error("[providers] record failed", error.code);
  return { ...(data as Record<string, unknown> | null), result: { ok: result.ok, state: result.state ?? (result.ok ? "ok" : "failed"), error: result.error ?? null } };
}

/** Month-to-date account usage where the provider documents a usage endpoint (shown apart from Genlixs spending). */
export async function refreshUsage(t: CheckTarget) {
  const client = providerClient(t.provider);
  if (!client.readUsage) return null;
  try {
    const key = await credentialFor({ ...t });
    const now = new Date();
    const report = await client.readUsage(key, { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now });
    if (!report) return null;
    const { error } = await adminClient().rpc("record_provider_usage", { p_account_id: t.accountId, p_report: report });
    if (error) console.error("[providers] usage record failed", error.code);
    return report;
  } catch {
    return null;
  }
}

/** Periodic refresh by the worker: a few due accounts per run, one after another. */
export async function syncProviderBalances(limit = 6) {
  const { data, error } = await adminClient().rpc("worker_balance_targets", { p_limit: limit });
  if (error || !Array.isArray(data)) return 0;
  let n = 0;
  for (const t of data as CheckTarget[]) {
    await checkProvider(t, "worker", false);
    n++;
  }
  return n;
}
