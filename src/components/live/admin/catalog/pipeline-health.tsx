"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Panel } from "@/components/console/parts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { Notice, when } from "./shared";

type Health = {
  checkedAt: string;
  wake: {
    configured: boolean;
    host: string | null;
    sent6h: number;
    ok6h: number;
    failed6h: number;
    lastWokenAt: string | null;
    lastOkAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  } | null;
  queues: { queue: string; due: number; oldestDueSeconds: number | null; leased: number; dead24h: number }[];
  jobs: { active: number; byState: Record<string, number>; oldestActiveSeconds: number | null } | null;
  submissions24h: { outcome: string; count: number; lastAt: string; lastMessage: string | null }[];
  imports24h: { done: number; dead: number; pending: number; lastError: string | null } | null;
  supplier: { blocked: boolean; blockedUntil: string | null; code: string | null; message: string | null; since: string | null } | null;
  watchdogHeartbeat: string | null;
  config: {
    deployment: { environment: string; commit: string | null; productionHost: string | null };
    appBase: { host: string | null; resolves: boolean | null };
    callbacks: { host: string | null; resolves: boolean | null; signed: boolean };
    provider: { keyConfigured: boolean; fake: boolean; paused: boolean };
    resultHosts: { effective: string[]; configuredValuePresent: boolean; configuredHostsUnderstood: number };
  };
};

type Check = { key: string; label: string; tone: Tone; status: string; detail: string };

const minutesAgo = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 60_000 : Infinity);
const ago = (secs: number | null) => (secs === null ? "—" : secs < 90 ? `${secs} s` : secs < 5400 ? `${Math.round(secs / 60)} min` : `${Math.round(secs / 3600)} h`);

/** Turns the raw health read into plain checks with a concrete next step for each problem. */
export function healthChecks(h: Health): Check[] {
  const out: Check[] = [];
  const w = h.wake;
  const due = h.queues.reduce((n, q) => n + q.due, 0);
  const oldestDue = Math.max(0, ...h.queues.map((q) => q.oldestDueSeconds ?? 0));
  if (!w?.configured) {
    out.push({ key: "wake", label: "Background workers", tone: "error", status: "Not configured",
      detail: "Cron cannot wake the workers: add genlixs_worker_base_url and genlixs_worker_token in Supabase Vault (see the setup guide)." });
  } else if (w.lastErrorAt && (!w.lastOkAt || Date.parse(w.lastErrorAt) > Date.parse(w.lastOkAt))) {
    out.push({ key: "wake", label: "Background workers", tone: "error", status: "Unreachable",
      detail: `Cron calls ${w.host ?? "the worker origin"} and gets "${w.lastError}" (${when(w.lastErrorAt)}). Set the Vault secret genlixs_worker_base_url to the live site origin. Until then jobs only move while someone has the site open.` });
  } else if (due > 0 && oldestDue > 180) {
    out.push({ key: "wake", label: "Background workers", tone: "attention", status: "Behind",
      detail: `${due} task(s) waiting, the oldest for ${ago(oldestDue)}. Workers last answered ${when(w.lastOkAt)}.` });
  } else {
    out.push({ key: "wake", label: "Background workers", tone: "success", status: "Working",
      detail: w.lastOkAt ? `Woken at ${w.host}; last answer ${when(w.lastOkAt)} (${w.ok6h} of ${w.sent6h} wake-ups answered in 6 h).` : `Woken at ${w.host} only when work is due; no wake-up was needed in the last 6 h.` });
  }

  const s = h.supplier;
  const accepted = h.submissions24h.filter((x) => x.outcome === "accepted").reduce((n, x) => n + x.count, 0);
  const refused = h.submissions24h.filter((x) => /^KIE_40[12]$/.test(x.outcome));
  if (!h.config.provider.keyConfigured && !h.config.provider.fake) {
    out.push({ key: "kie", label: "Sending jobs to KIE", tone: "error", status: "No key", detail: "KIE_API_KEY is not set on this deployment." });
  } else if (s?.blocked) {
    out.push({ key: "kie", label: "Sending jobs to KIE", tone: "error", status: "Refused",
      detail: `KIE refused our account (${s.code}: ${s.message ?? "no message"}) since ${when(s.since)}. New quotes pause until ${when(s.blockedUntil)}; waiting jobs retry, and are returned after 20 minutes. Check the KIE balance and the API key limits at kie.ai/api-key.` });
  } else if (refused.length) {
    out.push({ key: "kie", label: "Sending jobs to KIE", tone: "attention", status: "Refusals today",
      detail: `KIE refused ${refused.reduce((n, x) => n + x.count, 0)} request(s) in 24 h (last: ${refused[0].outcome} "${refused[0].lastMessage ?? ""}", ${when(refused[0].lastAt)}); ${accepted} accepted.` });
  } else {
    out.push({ key: "kie", label: "Sending jobs to KIE", tone: "success", status: accepted ? "Accepting" : "No jobs yet",
      detail: accepted ? `${accepted} job(s) accepted in 24 h.` : "No job was sent in the last 24 h." });
  }

  const imp = h.imports24h;
  if (imp && imp.dead > 0) {
    out.push({ key: "import", label: "Saving results", tone: "attention", status: `${imp.dead} failed`,
      detail: `Last error: "${imp.lastError ?? "unknown"}". Jobs stay in review with credits reserved; use Retry import on the job after fixing the cause.` });
  } else {
    out.push({ key: "import", label: "Saving results", tone: "success", status: imp?.done ? `${imp.done} saved` : "Idle",
      detail: `Results are downloaded only from: ${h.config.resultHosts.effective.join(", ")}.${h.config.resultHosts.configuredValuePresent ? ` MEDIA_FETCH_ALLOWED_HOSTS adds ${h.config.resultHosts.configuredHostsUnderstood} understood host(s).` : ""}` });
  }

  const cb = h.config.callbacks;
  if (cb.host && cb.resolves === false) {
    out.push({ key: "callbacks", label: "Completion callbacks", tone: "error", status: "Origin unreachable",
      detail: `KIE is told to call ${cb.host}, which does not resolve. Set KIE_CALLBACK_BASE_URL (and APP_BASE_URL) to the live site origin and redeploy. Status is still read every minute.` });
  } else if (!cb.signed) {
    out.push({ key: "callbacks", label: "Completion callbacks", tone: "attention", status: "Polling only",
      detail: "KIE_WEBHOOK_HMAC_KEY is not set, so callbacks are refused and results are found by checking every minute (correct, a little slower). Add the key in Vercel and the same key in KIE to speed this up." });
  } else {
    out.push({ key: "callbacks", label: "Completion callbacks", tone: "success", status: "Signed", detail: `KIE calls ${cb.host}; every callback is verified.` });
  }

  const app = h.config.appBase;
  if (app.host && app.resolves === false) {
    out.push({ key: "origin", label: "Site address", tone: "error", status: "Does not resolve",
      detail: `APP_BASE_URL points to ${app.host}, which does not resolve; sign-up and password links use it. Set it to the live origin and redeploy.` });
  }
  return out;
}

/** Generation pipeline health for staff: what moves jobs, what KIE answered, what failed, and what to do about it. */
export function PipelineHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setH(await api<Health>("/api/admin/generation/health"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    const i = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, [load]);

  const checks = h ? healthChecks(h) : [];
  const worst = checks.some((c) => c.tone === "error") ? "error" : checks.some((c) => c.tone === "attention") ? "attention" : "success";
  return (
    <Panel
      title="Generation pipeline"
      action={
        <Button size="sm" variant="secondary-light" busy={busy} onClick={() => void load()} icon={<RefreshCw aria-hidden className="size-4" />}>
          Check again
        </Button>
      }
    >
      {error && !h ? (
        <Notice tone="error" title="Health could not load">{error}</Notice>
      ) : !h ? (
        <div role="status" aria-busy="true" aria-label="Loading pipeline health" className="h-32 animate-pulse-soft rounded-xl bg-neutral-tint" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-dark" aria-live="polite">
            {worst === "success" ? "Everything that moves a job from Generate to a saved file is working." : worst === "error" ? "Something stops jobs from finishing. Fix the red items first." : "Jobs finish, with the warnings below."}
            {" "}Checked {when(h.checkedAt)}
            {h.config.deployment.commit ? ` · release ${h.config.deployment.commit}` : ""}.
          </p>
          <ul className="divide-y divide-rule rounded-xl border border-rule">
            {checks.map((c) => (
              <li key={c.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_120px_1fr] sm:items-start sm:gap-3">
                <span className="text-sm font-semibold text-ink-dark">{c.label}</span>
                <span>
                  <Badge surface="light" tone={c.tone}>{c.status}</Badge>
                </span>
                <span className="text-sm break-words text-muted-dark">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-neutral-tint px-3 py-2">
              <p className="text-xs text-muted-dark">Active jobs</p>
              <p className="font-semibold text-ink-dark tabular">
                {h.jobs?.active ?? 0}
                {h.jobs?.oldestActiveSeconds ? <span className="ml-1 text-xs font-normal text-muted-dark">· oldest {ago(h.jobs.oldestActiveSeconds)}</span> : null}
              </p>
            </div>
            <div className="rounded-xl bg-neutral-tint px-3 py-2">
              <p className="text-xs text-muted-dark">Tasks due now</p>
              <p className="font-semibold text-ink-dark tabular">{h.queues.reduce((n, q) => n + q.due, 0)}</p>
            </div>
            <div className="rounded-xl bg-neutral-tint px-3 py-2">
              <p className="text-xs text-muted-dark">Watchdog</p>
              <p className="font-semibold text-ink-dark">{minutesAgo(h.watchdogHeartbeat) < 3 ? "Running" : `Last run ${when(h.watchdogHeartbeat)}`}</p>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
