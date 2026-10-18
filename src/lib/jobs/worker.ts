import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/server/env";
import { sha256Hex } from "@/lib/server/crypto";
import { ApiError, fromPostgrest } from "@/lib/server/http";
import { paidSubmissionsAllowed } from "@/lib/providers";
import { balanceReadable, readAndRecordBalance } from "@/lib/providers/balance";
import { credentialFor } from "@/lib/providers/credentials";
import { FAKE_RESULT_PREFIX, FAKE_SAMPLES } from "@/lib/providers/fake";
import { parseCallbackUrl } from "@/lib/providers/kie/webhook";
import { providerClient } from "@/lib/providers/registry";
import { syncProviderBalances } from "@/lib/providers/sync";
import { TransientProviderError, type AttemptRoute, type ClaimContext, type SubmitOutcome, type TaskDetail } from "@/lib/providers/types";
import { FetchRejected, safeDownload } from "@/lib/media/safe-fetch";
import { imageDimensionsOk, sniff } from "@/lib/media/sniff";
import { probeMedia } from "@/lib/media/probe";

/**
 * Short bounded workers (guide §13). Each run dequeues a few messages, claims a fenced lease per work item and
 * calls exactly one state-transition RPC per outcome. Everything durable lives in Postgres; a crashed run is
 * recovered by lease expiry and the watchdog, never by in-memory state.
 */
export type QueueKind = "control" | "media" | "events";
export const QUEUE_KINDS: readonly QueueKind[] = ["control", "media", "events"];

const BUDGET_MS: Record<QueueKind, number> = { control: 45_000, media: 240_000, events: 45_000 };
const REFERENCE_URL_TTL_SECONDS = 2 * 60 * 60;
const MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;

type Claim = {
  status: "claimed";
  workItemId: string;
  leaseToken: string;
  kind: string;
  refId: string;
  attemptCount: number;
  payload: Record<string, unknown>;
  context: ClaimContext;
};

type RunSummary = { queue: string; processed: number; outcomes: Record<string, number>; stoppedBy: "empty" | "budget" };

async function call<T = Record<string, unknown>>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const api = fromPostgrest(error);
    // Business codes (e.g. STALE_LEASE) stay typed; anything else keeps its database detail for the logs.
    throw api.code === "INTERNAL" ? new Error(`${fn}: ${error.code} ${error.message}`) : api;
  }
  return data as T;
}

const lease = (c: Claim) => ({ p_work_item_id: c.workItemId, p_lease_token: c.leaseToken });
const redact = (s: string) => s.replace(/https?:\/\/\S+/g, "<url>").slice(0, 300);
const jitter = (base: number) => base + Math.floor(Math.random() * Math.max(5, base / 3));

// ------------------------------------------------------------------ handlers

/** Secrets present in this deployment's environment (names only), so the router skips a KIE route without its key. */
const runtime = () => ({ envSecrets: env.kieApiKey() || env.fakeProvider() ? ["KIE_API_KEY"] : [] });

async function handleSubmit(db: SupabaseClient, c: Claim): Promise<string> {
  if (!paidSubmissionsAllowed() || env.generationPaused()) {
    // Fail closed before any attempt exists: the job stays queued until configuration, un-pause or its deadline.
    const why = env.generationPaused() ? "generation paused by environment" : "paid provider calls are disabled on this deployment";
    await call(db, "worker_defer", { ...lease(c), p_seconds: 300, p_error: why });
    return "deferred:not_configured";
  }
  // The database chooses the cheapest eligible offer for the job's frozen settings and pins it to the attempt.
  const begin = await call<{ action: string; attemptId?: string; correlationToken?: string; route?: AttemptRoute }>(db, "worker_begin_submission_v2", {
    ...lease(c), p_runtime: runtime(),
  });
  if (begin.action !== "submit") return `submit:${begin.action}`;
  const route = begin.route!;

  const record = (outcome: SubmitOutcome) => call<{ action: string }>(db, "worker_record_submission", { ...lease(c), p_attempt_id: begin.attemptId, p_outcome: outcome });
  let key: string;
  try {
    key = await credentialFor(route);
  } catch (e) {
    // Nothing was sent: a missing or unreadable key is a refusal of this account (circuit breaker, then rerouting).
    await record({ kind: "rejected_account", code: "CREDENTIAL_UNAVAILABLE", message: redact(e instanceof Error ? e.message : "credential unavailable") });
    return "submit:credential_unavailable";
  }
  const provider = providerClient(route.provider);
  // Adapter and provider model come from the route (for the original KIE route they equal the job's own).
  const context = {
    ...c.context,
    model: { ...c.context.model, adapter: route.adapter, providerModelId: route.upstreamModelId, providerAccountId: route.accountId },
    attempt: { id: begin.attemptId!, ordinal: 0, state: "submitting", taskId: null },
  };
  let referenceUrls: string[] = [];
  const inputUrls: Record<string, string[]> = {};
  const sourceTasks: Record<string, string[]> = {};
  try {
    referenceUrls = await Promise.all(
      context.references.map(async (r) => {
        const { data, error } = await db.storage.from(r.bucket).createSignedUrl(r.path, REFERENCE_URL_TTL_SECONDS);
        if (error || !data) throw new Error("reference url failed");
        return data.signedUrl;
      }),
    );
    // Typed inputs keep the customer's order per slot. Video and audio links stay valid longer: the provider may
    // fetch them only when the task starts. Storage itself stays private.
    for (const [name, items] of Object.entries(context.inputs ?? {})) {
      for (const it of items) {
        if ("jobId" in it) {
          if (it.taskId) (sourceTasks[name] ??= []).push(it.taskId);
          continue;
        }
        const ttl = it.mime.startsWith("image/") ? REFERENCE_URL_TTL_SECONDS : MEDIA_URL_TTL_SECONDS;
        const { data, error } = await db.storage.from(it.bucket).createSignedUrl(it.path, ttl);
        if (error || !data) throw new Error("reference url failed");
        (inputUrls[name] ??= []).push(data.signedUrl);
      }
    }
  } catch {
    // Nothing was sent yet: this is a definite non-submission, safe to retry with backoff.
    await record({ kind: "rejected_retryable", code: "REFERENCE_URL", message: "reference link failed" });
    return "submit:reference_retry";
  }
  // Only KIE callbacks are verified (attempt + correlation token); other providers are polled.
  const base = env.kieCallbackBaseUrl() ?? env.appBaseUrl();
  const callBackUrl = base && route.provider === "kie"
    ? `${base}/api/webhooks/kie?attempt=${encodeURIComponent(begin.attemptId!)}&correlation=${encodeURIComponent(begin.correlationToken!)}`
    : null;

  let outcome: SubmitOutcome;
  try {
    if (!env.fakeProvider() && !provider.adapters.includes(route.adapter)) throw new Error(`adapter ${route.adapter} is not in this release`);
    outcome = await provider.submit({ context, referenceUrls, inputUrls, sourceTasks, callBackUrl, route, key, idempotencyKey: `genlixs-${begin.attemptId}` });
  } catch (e) {
    // Local failure building the request (before any network send) is terminal for this input.
    outcome = { kind: "rejected_terminal" as const, code: "ADAPTER", message: redact(String(e instanceof Error ? e.message : e)),
      publicCode: "INVALID_REQUEST", publicMessage: "This request could not be prepared for the generation service." };
  }
  const r = await record(outcome);
  return `submit:${r.action}`;
}

/** The route pinned to the job's latest attempt; status reads and downloads always use that supplier and key. */
async function attemptRoute(db: SupabaseClient, c: Claim): Promise<AttemptRoute | null> {
  return call<AttemptRoute | null>(db, "worker_attempt_route", lease(c));
}

function observation(d: TaskDetail, source: string) {
  return {
    taskId: d.taskId, providerState: d.providerState, normalized: d.normalized, resultUrls: d.resultUrls,
    failCode: d.failCode ?? null, failMsg: d.failMsg ? redact(d.failMsg) : null, creditsConsumed: d.creditsConsumed ?? null,
    costTime: d.costTime ?? null, progress: d.progress ?? null, source,
  };
}

async function handleCheck(db: SupabaseClient, c: Claim): Promise<string> {
  const taskId = (c.payload.taskId as string | undefined) ?? c.context.attempt?.taskId ?? null;
  if (!taskId) {
    await call(db, "worker_complete", { ...lease(c), p_note: "no bound task to check" });
    return "check:no_task";
  }
  let detail: TaskDetail;
  try {
    const route = await attemptRoute(db, c);
    if (!route) throw new TransientProviderError("no attempt route");
    const key = await credentialFor(route).catch((e: unknown) => {
      // A revoked or missing key is an operational problem to fix, never a generation failure.
      throw new TransientProviderError(e instanceof Error ? e.message : "credential unavailable");
    });
    detail = await providerClient(route.provider).getTask(taskId, { route, key });
  } catch (e) {
    if (e instanceof TransientProviderError) {
      await call(db, "worker_defer", { ...lease(c), p_seconds: jitter(30), p_error: redact(e.message) });
      return "check:deferred";
    }
    throw e;
  }
  const r = await call<{ action: string }>(db, "worker_record_observation", {
    ...lease(c), p_obs: observation(detail, c.payload.trigger === "callback" ? "callback" : "poll"),
  });
  return `check:${r.action}`;
}

async function handleBind(db: SupabaseClient, c: Claim): Promise<string> {
  const taskId = String(c.payload.taskId ?? "");
  let detail: TaskDetail;
  try {
    // Binding evidence (the callBackUrl recorded with the task) exists only on KIE, the provider whose callbacks we use.
    const route = await attemptRoute(db, c);
    if (!route || (route.provider !== "kie" && !env.fakeProvider())) {
      await call(db, "worker_complete", { ...lease(c), p_note: "task binding applies to KIE callbacks only" });
      return "bind:not_applicable";
    }
    const key = await credentialFor(route).catch((e: unknown) => {
      throw new TransientProviderError(e instanceof Error ? e.message : "credential unavailable");
    });
    detail = await providerClient(route.provider).getTask(taskId, { route, key });
  } catch (e) {
    if (e instanceof TransientProviderError) {
      await call(db, "worker_defer", { ...lease(c), p_seconds: jitter(30), p_error: redact(e.message) });
      return "bind:deferred";
    }
    throw e;
  }
  // The database compares the observed attempt + correlation token with the persisted hash (§15.2).
  const observed = parseCallbackUrl(detail.callBackUrl);
  const r = await call<{ action: string }>(db, "worker_bind_task", {
    ...lease(c), p_observed_attempt: observed.attempt, p_observed_correlation: observed.correlation,
    p_evidence: detail.notFound ? "task detail not found" : `task detail state ${detail.providerState ?? "unknown"}`,
  });
  return `bind:${r.action}`;
}

async function fetchResult(url: string, maxBytes: number, allowedHosts: string[]): Promise<Uint8Array> {
  if (url.startsWith(FAKE_RESULT_PREFIX)) {
    if (!env.fakeProvider()) throw new FetchRejected("fake result outside fake mode", false);
    const rel = FAKE_SAMPLES[url.slice(FAKE_RESULT_PREFIX.length)];
    if (!rel) throw new FetchRejected("unknown fake sample", false);
    return new Uint8Array(await readFile(path.join(process.cwd(), "public", rel)));
  }
  const { bytes } = await safeDownload(url, { allowedHosts, maxBytes, timeoutMs: 180_000 });
  return bytes;
}

/** Download hosts for the supplier that produced the job: its documented hosts plus reviewed additions from settings. */
async function importHosts(db: SupabaseClient, c: Claim): Promise<string[]> {
  const route = await attemptRoute(db, c).catch(() => null);
  const own = route && !env.fakeProvider() ? providerClient(route.provider).resultHosts : [];
  return [...new Set([...env.mediaAllowedHosts(), ...own])];
}

async function handleImport(db: SupabaseClient, c: Claim): Promise<string> {
  const urls = Array.isArray(c.payload.urls) ? (c.payload.urls as unknown[]).filter((u): u is string => typeof u === "string") : [];
  const expected = Number(c.payload.expected ?? c.context.output?.count ?? 1);
  const out = c.context.output;
  const job = c.context.job;
  const fail = async (msg: string, retryable: boolean) => {
    const r = await call<{ action: string }>(db, "worker_import_failed", { ...lease(c), p_error: redact(msg), p_retryable: retryable });
    return `import:${r.action}`;
  };
  if (urls.length < expected) return fail("result manifest incomplete", false);
  const hosts = await importHosts(db, c);

  const assets = [];
  for (let i = 0; i < expected; i++) {
    let bytes: Uint8Array;
    try {
      bytes = await fetchResult(urls[i], out.maxBytes, hosts);
    } catch (e) {
      if (e instanceof FetchRejected) return fail(e.message, e.retryable);
      return fail("download failed", true);
    }
    const s = sniff(bytes);
    if (!s || !out.mime.includes(s.mime)) return fail(`unexpected file type ${s?.mime ?? "unknown"}`, false);
    if (s.mime.startsWith("image/") && !imageDimensionsOk(s)) return fail("image dimensions out of bounds", false);
    // Videos keep their picture size, length and frame rate so they can be reused as inputs (edit, motion).
    const probe = s.mime.startsWith("video/") ? probeMedia(bytes) : null;
    // Deterministic path: a retried import overwrites the same object, never a second copy (§16.1).
    const objectPath = `${job.userId}/${job.id}/${i}/original.${s.ext}`;
    const { error } = await db.storage.from("generation-outputs").upload(objectPath, bytes, { contentType: s.mime, upsert: true });
    if (error) return fail(`storage upload failed: ${error.message}`, true);
    assets.push({
      bucket: "generation-outputs", path: objectPath, mime: s.mime, bytes: bytes.byteLength, width: s.width ?? probe?.width ?? null,
      height: s.height ?? probe?.height ?? null, durationMs: probe?.durationMs ?? s.durationMs ?? null, sha256: sha256Hex(bytes),
      media: probe ? { fps: probe.fps ?? null, hasAudio: probe.hasAudio, hasVideo: probe.hasVideo, codec: probe.codec ?? null, rotation: probe.rotation ?? 0 } : null,
    });
  }
  const r = await call<{ action: string }>(db, "worker_record_import", { ...lease(c), p_assets: assets });
  return `import:${r.action}`;
}

async function handleAssetDelete(db: SupabaseClient, c: Claim): Promise<string> {
  const { data, error } = await db.from("assets").select("bucket, object_path, state").eq("id", c.refId).maybeSingle();
  if (error) throw new Error("asset lookup failed");
  if (!data || !["deleting", "expired"].includes(data.state)) {
    await call(db, "worker_complete", { ...lease(c), p_note: "asset not pending deletion" });
    return "delete:skip";
  }
  const { error: rmError } = await db.storage.from(data.bucket).remove([data.object_path]);
  const r = await call<{ action: string }>(db, "worker_asset_deleted", { ...lease(c), p_ok: !rmError, p_error: rmError ? redact(rmError.message) : null });
  return `delete:${r.action}`;
}

async function handleBilling(db: SupabaseClient, c: Claim): Promise<string> {
  const r = await call<{ action: string }>(db, "worker_apply_billing", lease(c));
  return `billing:${r.action}`;
}

const HANDLERS: Record<string, (db: SupabaseClient, c: Claim) => Promise<string>> = {
  job_submit: handleSubmit,
  job_check: handleCheck,
  job_bind: handleBind,
  job_import: handleImport,
  asset_delete: handleAssetDelete,
  billing_apply: handleBilling,
};

// ---------------------------------------------------------------------- loop

export async function runWorker(kind: QueueKind, opts: { budgetMs?: number; workerName?: string } = {}): Promise<RunSummary> {
  const db = adminClient();
  const queue = `genlixs_${kind}`;
  const started = Date.now();
  const budget = Math.min(opts.budgetMs ?? BUDGET_MS[kind], BUDGET_MS[kind]);
  const name = opts.workerName ?? `vercel-${kind}-${process.env.VERCEL_DEPLOYMENT_ID?.slice(-8) ?? "local"}`;
  const outcomes: Record<string, number> = {};
  let processed = 0;
  const bump = (k: string) => (outcomes[k] = (outcomes[k] ?? 0) + 1);

  while (Date.now() - started < budget) {
    const msgs = await call<{ msgId: number; workItemId: string }[]>(db, "worker_dequeue", {
      p_queue: queue, p_visibility_seconds: kind === "media" ? 300 : 90, p_qty: kind === "media" ? 2 : 5,
    });
    if (!msgs.length) return { queue, processed, outcomes, stoppedBy: "empty" };
    for (const m of msgs) {
      if (Date.now() - started >= budget) break;
      const claim = await call<Claim | { status: string }>(db, "worker_claim", {
        p_queue: queue, p_msg_id: m.msgId, p_work_item_id: m.workItemId, p_worker: name,
      });
      if (claim.status !== "claimed") {
        bump(`claim:${claim.status}`);
        continue;
      }
      const c = claim as Claim;
      const handler = HANDLERS[c.kind];
      processed++;
      try {
        if (!handler) {
          await call(db, "worker_complete", { ...lease(c), p_note: `no handler for ${c.kind}` });
          bump("unhandled");
          continue;
        }
        bump(await handler(db, c));
      } catch (e) {
        // Unexpected fault: give the item back with backoff. STALE_LEASE means another worker owns it now.
        const stale = e instanceof ApiError && e.code === "STALE_LEASE";
        const msg = e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e);
        bump(stale ? "stale_lease" : "error");
        console.error(`[worker:${kind}] ${c.kind} ${c.workItemId} ${redact(msg)}`);
        if (!stale) {
          await call(db, "worker_defer", { ...lease(c), p_seconds: jitter(30 * Math.min(c.attemptCount, 10)), p_error: redact(msg) }).catch(() => {});
        }
      }
    }
  }
  return { queue, processed, outcomes, stoppedBy: "budget" };
}

/**
 * Records the supplier balance observations (§12.5), success or failure. Stale/missing is distinct from zero. The KIE
 * environment key keeps its existing reading; accounts with Admin keys are refreshed a few at a time.
 */
export async function recordProviderBalance(): Promise<number | null> {
  await syncProviderBalances(6).catch(() => 0);
  if (!balanceReadable()) return null;
  const read = await readAndRecordBalance("worker");
  return read.ok ? read.credits : null;
}
