"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ExternalLink, KeyRound, RefreshCw, Settings2 } from "lucide-react";
import { PageHead } from "@/components/console/parts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { PipelineHealth, usePipelineHealth } from "../catalog/pipeline-health";
import { useKieSummary } from "../catalog/provider";
import { fmtKie, Notice, Switch, when, Wrap } from "../catalog/shared";
import type { Supply } from "../catalog/supply";
import { SupplierMark } from "../catalog/supply-parts";
import type { CatalogData } from "../catalog/types";
import { useAdminMe } from "../live-admin";
import { ModelsTab } from "./models-tab";
import { age, money, native } from "./parts";
import { BILLING, KeyDialog, ProviderDrawer } from "./provider-dialogs";
import type { ProviderAccount, ProvidersOverview } from "./types";
import { UsageTab } from "./usage-tab";

type More = "usage" | "pipeline" | "routing";
type RowMsg = { tone: "error" | "success" | "attention"; text: string };

/**
 * One status per provider, the most useful first: a problem, then whether it serves customers and, if not, the step that
 * is missing. A saved key and the switch are not enough: an offer serves only once verified (one paid test) with routing on.
 */
function providerStatus(a: ProviderAccount, now: number): { label: string; tone: Tone; hint?: string } {
  if (a.credential.source === "none") return { label: "No API key", tone: "neutral" };
  if (a.connection.state === "unauthorized") return { label: "Key refused", tone: "error" };
  if (a.circuit.blockedUntil && Date.parse(a.circuit.blockedUntil) > now) return { label: "Refusing jobs", tone: "error" };
  if (a.paused) return { label: "Paused", tone: "attention" };
  if (!a.enabled) return { label: "Off", tone: "neutral" };
  if (a.balance.low) return { label: "Low balance", tone: "error" };
  if (a.connection.state === "failed") return { label: "Check failed", tone: "error" };
  if (a.offers.routing > 0) return { label: `Serving ${a.offers.routing} model${a.offers.routing === 1 ? "" : "s"}`, tone: "success" };
  if (a.offers.eligible > 0) {
    return { label: "Verified · routing off", tone: "info", hint: `${a.offers.eligible} verified offer(s); switch routing on in More → Routing & offers.` };
  }
  if (a.offers.mapped > 0) {
    return {
      label: "Not verified yet",
      tone: "attention",
      hint: `0 of ${a.offers.mapped} offers verified: each needs one paid test before it can serve (More → Routing & offers).`,
    };
  }
  return { label: "No offers for Genlixs models", tone: "neutral" };
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Providers & balances (provider.read; changes need provider.manage, which only the owner has): one row per provider
 * with its status, balance, spending, switch, key and a balance refresh. Funding terms, usage, diagnostics, the
 * generation pipeline and routing stay one click away. Keys are stored in Vault on the server; this page only ever sees
 * a masked hint. Problems that stop generation are shown as banners, never hidden. `?routing=<model>` opens routing.
 */
export function ProvidersPage() {
  const me = useAdminMe();
  const caps = me.data?.capabilities ?? [];
  const canRead = caps.includes("provider.read");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const overview = useApi<ProvidersOverview>(canRead ? "/api/admin/providers/overview" : null, [canRead]);
  // For the KIE low-balance warning: the most expensive settings of the live models KIE serves.
  const catalog = useApi<CatalogData>(canRead ? "/api/admin/catalog" : null, [canRead]);
  const supply = useApi<Supply>(canRead ? "/api/admin/catalog/supply" : null, [canRead]);
  const kie = useKieSummary(canRead);
  const health = usePipelineHealth(canRead);
  const routingModel = sp.get("routing");
  const [more, setMore] = useState<More | null>(routingModel ? "routing" : null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, RowMsg | undefined>>({});
  const [pageMsg, setPageMsg] = useState<RowMsg | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // A live KIE read updates the same account row; reload the overview so both agree.
  const kieReadAt = kie.s?.balance.observedAt ?? null;
  const reloadOverview = overview.reload;
  useEffect(() => {
    if (kieReadAt) reloadOverview();
  }, [kieReadAt, reloadOverview]);

  const open = useCallback((m: More) => {
    setMore(m);
    window.setTimeout(() => moreRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }, []);
  useEffect(() => {
    if (routingModel) window.setTimeout(() => moreRef.current?.scrollIntoView({ block: "start" }), 0);
  }, [routingModel]);

  const o = overview.data;
  const accounts = useMemo(() => [...(o?.accounts ?? [])].sort((a, b) => b.offers.routing - a.offers.routing || a.sortOrder - b.sortOrder), [o]);
  const canManage = Boolean(o?.canManage);

  const refreshAll = async () => {
    setRefreshing(true);
    setPageMsg(null);
    try {
      const r = await api<ProvidersOverview>("/api/admin/providers/balances/refresh", { body: {} });
      overview.setData(r);
      await kie.refresh("admin");
      const n = r.refreshed?.filter((x) => !x.skipped).length ?? 0;
      const failed = r.refreshed?.filter((x) => x.ok === false).length ?? 0;
      setPageMsg({ tone: failed ? "error" : "success", text: n ? `${n} balance(s) read${failed ? `, ${failed} failed` : ""}.` : "Balances were read moments ago; nothing new to read." });
    } catch (e) {
      setPageMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const run = async (a: ProviderAccount, what: string, fn: () => Promise<string>) => {
    setBusy(`${a.id}:${what}`);
    setRowMsg((m) => ({ ...m, [a.id]: undefined }));
    try {
      const text = await fn();
      setRowMsg((m) => ({ ...m, [a.id]: { tone: "success", text } }));
      overview.reload();
    } catch (e) {
      setRowMsg((m) => ({ ...m, [a.id]: { tone: "error", text: errorMessage(e) } }));
    } finally {
      setBusy(null);
    }
  };

  const refreshOne = (a: ProviderAccount) =>
    void run(a, "refresh", async () => {
      const r = await api<{ skipped: boolean; ok?: boolean; state?: string; error?: string | null }>(`/api/admin/providers/${a.id}/refresh`, { body: {} });
      if (a.provider === "kie") await kie.refresh("auto");
      if (r.skipped) return "Read moments ago; showing that reading.";
      if (r.ok) return "Balance read (read-only; nothing was generated).";
      throw new Error(r.state === "unsupported" ? "This provider has no balance endpoint; enter a manual balance in Details." : `The read failed (${r.error ?? r.state}).`);
    });

  const setMoreParam = (m: More | null) => {
    setMore(m);
    if (m !== "routing" && routingModel) {
      const n = new URLSearchParams(sp.toString());
      n.delete("routing");
      router.replace(`${pathname}${n.size ? `?${n}` : ""}`, { scroll: false });
    }
  };

  const drawerAccount = drawerFor ? accounts.find((a) => a.id === drawerFor) ?? null : null;
  const keyAccount = keyFor ? accounts.find((a) => a.id === keyFor) ?? null : null;

  return (
    <Wrap>
      <PageHead
        title="Providers & balances"
        sub={
          <span className="block max-w-3xl">
            API keys, provider availability, balances and spending. Customers always see one card per model; the server picks the cheapest verified provider
            for each request.
          </span>
        }
        actions={
          canRead ? (
            <Button size="sm" variant="secondary-light" busy={refreshing} icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void refreshAll()}>
              Refresh balances
            </Button>
          ) : undefined
        }
      />
      {!me.data ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : !canRead ? (
        <Notice>Your role cannot see providers, balances or spending.</Notice>
      ) : overview.error && !o ? (
        <Notice tone="error" title="Providers could not load" action={<Button size="sm" variant="secondary-light" onClick={overview.reload}>Try again</Button>}>
          {overview.error.message}
        </Notice>
      ) : !o ? (
        <div role="status" aria-busy="true" aria-label="Loading providers" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : (
        <>
          {pageMsg ? <Notice tone={pageMsg.tone}>{pageMsg.text}</Notice> : null}
          <Alerts
            o={o}
            catalog={catalog.data}
            supply={supply.data}
            kieBilling={kie.s?.billingUrl ?? BILLING.kie}
            health={health}
            onPipeline={() => open("pipeline")}
            onProvider={(id) => setDrawerFor(id)}
          />

          <p className="text-sm text-muted-dark">
            Spent today (UTC) <span className="font-semibold text-ink-dark tabular">{money(o.totals.todayConfirmedUsd + o.totals.todayEstimatedUsd)}</span>
            {" · "}this month <span className="font-semibold text-ink-dark tabular">{money(o.totals.monthConfirmedUsd + o.totals.monthEstimatedUsd)}</span>
            {o.totals.pendingUsd ? (
              <>
                {" · "}in flight <span className="font-semibold text-ink-dark tabular">{money(o.totals.pendingUsd)}</span>
              </>
            ) : null}
            {o.totals.todayEstimatedUsd || o.totals.monthEstimatedUsd ? <span className="text-xs"> (includes estimates awaiting confirmation)</span> : null}
          </p>

          <ul className="divide-y divide-rule overflow-hidden rounded-[var(--radius-media)] border border-rule bg-sheet shadow-[var(--shadow-lift)]">
            {accounts.map((a) => (
              <ProviderRow
                key={a.id}
                a={a}
                now={Date.parse(o.generatedAt)}
                canManage={canManage}
                canRefresh={a.credential.source !== "none" && o.runtime.providers[a.provider]?.balance === "api"}
                busy={busy}
                msg={rowMsg[a.id]}
                onToggle={(v) =>
                  void run(a, "enabled", async () => {
                    await api(`/api/admin/providers/${a.id}/settings`, { body: { patch: { enabled: v } } });
                    return v ? "Switched on. Only verified offers with routing on receive jobs." : "Switched off for new jobs. Jobs already sent finish normally.";
                  })
                }
                onKey={() => setKeyFor(a.id)}
                onRefresh={() => refreshOne(a)}
                onDetails={() => setDrawerFor(a.id)}
              />
            ))}
          </ul>
          {!canManage ? <p className="text-sm text-muted-dark">Only the owner can add keys, switch providers on or off and change limits.</p> : null}

          <div ref={moreRef} className="scroll-mt-4 space-y-3">
            <div role="group" aria-label="More details" className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-muted-dark">More:</span>
              {(
                [
                  ["usage", "Spending by job"],
                  ["pipeline", "Generation pipeline"],
                  ["routing", "Routing & offers"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-expanded={more === id}
                  onClick={() => setMoreParam(more === id ? null : id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold",
                    more === id ? "border-ink-dark bg-ink-dark text-white" : "border-rule-strong bg-sheet text-ink-dark hover:border-ink-dark",
                  )}
                >
                  {label}
                  <ChevronDown aria-hidden className={cn("size-4 transition-transform", more === id && "rotate-180")} />
                </button>
              ))}
            </div>
            {more === "usage" ? <UsageTab accounts={o.accounts} /> : null}
            {more === "pipeline" ? <PipelineHealth health={health} /> : null}
            {more === "routing" ? (
              <ModelsTab canManage={canManage} canTest={caps.includes("catalog.test")} units={o.units} focusModel={routingModel} />
            ) : null}
          </div>

          {keyAccount ? <KeyDialog a={keyAccount} onClose={() => setKeyFor(null)} onSaved={overview.reload} /> : null}
          {drawerAccount ? (
            <ProviderDrawer
              a={drawerAccount}
              o={o}
              canManage={canManage}
              canOperate={caps.includes("catalog.operate")}
              kie={drawerAccount.provider === "kie" ? kie : null}
              onClose={() => setDrawerFor(null)}
              onSaved={overview.reload}
            />
          ) : null}
        </>
      )}
    </Wrap>
  );
}

function ProviderRow({
  a,
  now,
  canManage,
  canRefresh,
  busy,
  msg,
  onToggle,
  onKey,
  onRefresh,
  onDetails,
}: {
  a: ProviderAccount;
  now: number;
  canManage: boolean;
  canRefresh: boolean;
  busy: string | null;
  msg: RowMsg | undefined;
  onToggle: (v: boolean) => void;
  onKey: () => void;
  onRefresh: () => void;
  onDetails: () => void;
}) {
  const status = providerStatus(a, now);
  const b = a.balance;
  const value = b.available ?? b.total;
  const failing = Boolean(b.lastErrorAt && (!b.observedAt || Date.parse(b.lastErrorAt) > Date.parse(b.observedAt)));
  const sp = a.spend;
  return (
    // Same columns on every row (the action column has a fixed width), so balances and spending line up.
    <li className="grid gap-x-5 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,12rem)_27rem] lg:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-col lg:items-start lg:gap-1.5">
        <SupplierMark provider={a.provider} name={a.name} />
        <Badge surface="light" tone={status.tone}>
          {status.label}
        </Badge>
        {status.hint ? <p className="basis-full text-[11px] leading-snug text-muted-dark lg:basis-auto">{status.hint}</p> : null}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-ink-dark tabular">
          {a.credential.source === "none" ? "No key saved" : value === null ? (b.unlimitedKeyQuota ? "Unlimited key allowance" : "Balance unknown") : native(value, b.unit)}
        </p>
        <p className="text-xs text-muted-dark">
          {value !== null && b.usdApprox !== null && b.unit !== "usd" ? `≈ ${money(b.usdApprox)} · ` : ""}
          {b.source === "manual" ? "Manual entry" : b.source === "api" ? "Provider API" : "No reading yet"}
          {b.observedAt ? ` · ${age(b.ageSeconds) ?? when(b.observedAt)}` : ""}
          {b.observedAt && b.stale ? " · stale" : ""}
        </p>
        {failing ? <p className="text-xs font-semibold text-error-text">Last read failed ({b.lastError})</p> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 text-sm">
        <div>
          <dt className="text-xs text-muted-dark">Today</dt>
          <dd className="font-semibold text-ink-dark tabular">{money(sp.todayConfirmedUsd + sp.todayEstimatedUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-dark">This month</dt>
          <dd className="font-semibold text-ink-dark tabular">{money(sp.monthConfirmedUsd + sp.monthEstimatedUsd)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <label className="mr-1 flex items-center gap-2 text-sm font-semibold text-ink-dark">
          <span aria-hidden className="w-6 text-right">{a.enabled ? "On" : "Off"}</span>
          <Switch checked={a.enabled} label={`${a.name} available for new jobs`} disabled={!canManage} busy={busy === `${a.id}:enabled`} onChange={onToggle} />
        </label>
        {canRefresh ? (
          <Button size="sm" variant="ghost-light" busy={busy === `${a.id}:refresh`} icon={<RefreshCw aria-hidden className="size-4" />} onClick={onRefresh} aria-label={`Refresh the ${a.name} balance`}>
            Refresh
          </Button>
        ) : null}
        {canManage ? (
          <Button size="sm" variant="secondary-light" icon={<KeyRound aria-hidden className="size-4" />} onClick={onKey}>
            {a.credential.source === "vault" ? "Replace key" : "Add key"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost-light" icon={<Settings2 aria-hidden className="size-4" />} onClick={onDetails} aria-label={`${a.name} details`}>
          Details
        </Button>
      </div>
      {msg ? (
        <div className="lg:col-span-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Concise banners for what needs action now, most serious first, each with a way to the details: generation pipeline
 * failures, KIE balance below what live models can cost, low balances, refused keys and providers refusing jobs.
 */
function Alerts({
  o,
  catalog,
  supply,
  kieBilling,
  health,
  onPipeline,
  onProvider,
}: {
  o: ProvidersOverview;
  catalog: CatalogData | null;
  supply: Supply | null;
  kieBilling: string;
  health: ReturnType<typeof usePipelineHealth>;
  onPipeline: () => void;
  onProvider: (id: string) => void;
}) {
  const now = Date.parse(o.generatedAt);
  const pipelineErrors = health.checks.filter((c) => c.tone === "error");
  // Polling instead of signed callbacks is slower but correct, so it stays in the pipeline details only.
  const pipelineWarnings = health.checks.filter((c) => c.tone === "attention" && c.key !== "callbacks");
  const kieAcct = o.accounts.find((a) => a.provider === "kie") ?? null;
  const kieCredits = kieAcct ? (kieAcct.balance.available ?? kieAcct.balance.total) : null;
  // Live models served by KIE whose most expensive settings cost more KIE credits than the account holds.
  const servedByKie = new Set((supply?.models ?? []).filter((m) => m.route.provider === "kie").map((m) => m.id));
  const above =
    kieCredits === null
      ? []
      : (catalog?.models ?? []).filter(
          (m) =>
            (m.state === "enabled" || m.state === "experimental") &&
            (!supply || servedByKie.has(m.id)) &&
            m.cost?.maxCredits !== null &&
            m.cost?.maxCredits !== undefined &&
            m.cost.maxCredits > kieCredits,
        );
  const lowOthers = o.accounts.filter((a) => a.balance.low && a.provider !== "kie");
  const refused = o.accounts.filter((a) => a.credential.source !== "none" && (a.connection.state === "unauthorized" || a.connection.state === "failed"));
  const blocked = o.accounts.filter((a) => a.circuit.blockedUntil && Date.parse(a.circuit.blockedUntil) > now);
  const details = (label: string, fn: () => void) => (
    <button type="button" className="font-semibold whitespace-nowrap underline" onClick={fn}>
      {label}
    </button>
  );
  const topUp = (
    <a href={kieBilling} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold whitespace-nowrap underline">
      Top up on KIE <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );

  return (
    <div className="space-y-2">
      {!o.runtime.paidSubmissionsAllowed ? (
        <Notice tone="attention">Paid provider calls are disabled on this deployment (not production). Nothing is sent to providers from here.</Notice>
      ) : null}
      {pipelineErrors.length ? (
        <Notice tone="error" title={`Generation is not working: ${pipelineErrors.map((c) => `${c.label.toLowerCase()} ${c.status.toLowerCase()}`).join(", ")}`} action={details("Details", onPipeline)}>
          {pipelineErrors[0].detail}
        </Notice>
      ) : pipelineWarnings.length ? (
        <Notice tone="attention" title={`Generation works with warnings: ${pipelineWarnings.map((c) => c.label.toLowerCase()).join(", ")}`} action={details("Details", onPipeline)}>
          {pipelineWarnings[0].detail}
        </Notice>
      ) : health.error && !health.h ? (
        <Notice tone="attention" action={details("Details", onPipeline)}>
          The generation pipeline could not be checked: {health.error}
        </Notice>
      ) : null}
      {kieCredits !== null && kieCredits < 0 ? (
        <Notice tone="error" title="KIE reports a negative balance" action={topUp}>
          The KIE account is {fmtKie(Math.abs(kieCredits))} below zero. New generations sent to KIE fail until it is topped up.
        </Notice>
      ) : above.length ? (
        <Notice tone="error" title={`KIE balance too low for some settings of ${above.length} model${above.length === 1 ? "" : "s"}`} action={topUp}>
          {fmtKie(kieCredits)} left. The most expensive settings of {listNames(above.map((m) => `${m.name} (up to ${fmtKie(m.cost!.maxCredits)})`))} cost
          more, so those requests are refused before any charge until the account is topped up. Cheaper settings keep working.
        </Notice>
      ) : kieAcct?.balance.low ? (
        <Notice tone="attention" title="KIE balance is below your warning level" action={topUp}>
          {fmtKie(kieCredits)} left; warning at {fmtKie(kieAcct.lowBalanceThreshold)}.
        </Notice>
      ) : null}
      {lowOthers.length ? (
        <Notice tone="error" title="Low balance" action={details("Details", () => onProvider(lowOthers[0].id))}>
          {listNames(lowOthers.map((a) => a.name))} {lowOthers.length === 1 ? "is" : "are"} below the warning level. Top up at the provider; Genlixs never moves
          money between accounts.
        </Notice>
      ) : null}
      {refused.length ? (
        <Notice tone="error" title="Connection problem" action={details("Details", () => onProvider(refused[0].id))}>
          {refused.map((a) => `${a.name}: ${a.connection.state === "unauthorized" ? "key refused" : a.connection.message ?? "check failed"}`).join(" · ")}
        </Notice>
      ) : null}
      {blocked.length ? (
        <Notice tone="attention" title="Provider refusing jobs" action={details("Details", () => onProvider(blocked[0].id))}>
          {blocked.map((a) => `${a.name} until ${when(a.circuit.blockedUntil)} (${a.circuit.code ?? "refused"})`).join(" · ")}. New jobs wait or use another
          verified provider.
        </Notice>
      ) : null}
    </div>
  );
}
