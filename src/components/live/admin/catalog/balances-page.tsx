"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronRight, ExternalLink, Landmark, Receipt, RefreshCw, Wallet } from "lucide-react";
import { PageHead } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { useAdminMe } from "../live-admin";
import { BalanceCell, money } from "../providers/parts";
import type { ProviderAccount, ProvidersOverview } from "../providers/types";
import { PipelineHealth } from "./pipeline-health";
import { KieActivity, useKieSummary } from "./provider";
import { fmtKie, Notice, Wrap } from "./shared";
import type { Supply } from "./supply";
import { Kpi, SupplierMark } from "./supply-parts";
import type { CatalogData } from "./types";

/**
 * Supplier balances (provider.read): what Genlixs has left at each supplier, how fast it is spent, and whether new jobs
 * can be sent. Balances are shown exactly as known — with their source and age — and unknown is never shown as $0.
 * KIE's balance is read live while the page is open; the other suppliers are read when they have a key.
 */
export function BalancesPage() {
  const me = useAdminMe();
  const caps = me.data?.capabilities ?? [];
  const canRead = caps.includes("provider.read");
  const overview = useApi<ProvidersOverview>(canRead ? "/api/admin/providers/overview" : null, [canRead]);
  const catalog = useApi<CatalogData>(canRead ? "/api/admin/catalog" : null, [canRead]);
  const supply = useApi<Supply>(canRead ? "/api/admin/catalog/supply" : null, [canRead]);
  const kie = useKieSummary(canRead);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // A live KIE read updates the same account row the overview shows; reload it so both agree.
  const kieReadAt = kie.s?.balance.observedAt ?? null;
  const reloadOverview = overview.reload;
  useEffect(() => {
    if (kieReadAt) reloadOverview();
  }, [kieReadAt, reloadOverview]);

  const refreshAll = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const r = await api<ProvidersOverview>("/api/admin/providers/balances/refresh", { body: {} });
      overview.setData(r);
      await kie.refresh("admin");
      const n = r.refreshed?.filter((x) => !x.skipped).length ?? 0;
      const failed = r.refreshed?.filter((x) => x.ok === false).length ?? 0;
      setMsg({ tone: failed ? "error" : "success", text: n ? `${n} supplier balance(s) read${failed ? `, ${failed} failed` : ""}.` : "Balances were read moments ago; nothing new to read." });
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const o = overview.data;
  const accounts = useMemo(
    () => [...(o?.accounts ?? [])].sort((a, b) => b.offers.routing - a.offers.routing || a.sortOrder - b.sortOrder),
    [o],
  );

  return (
    <Wrap>
      <PageHead
        title="Supplier balances"
        sub={
          <span className="block max-w-3xl">
            What Genlixs has left at each supplier, how fast it is spent, and whether new jobs can be sent. Keys stay on the server; balances show their source
            and age, and unknown is never shown as zero.
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
        <div role="status" aria-busy="true" aria-label="Loading balances" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : !canRead ? (
        <Notice>Your role cannot see supplier balances.</Notice>
      ) : overview.error && !o ? (
        <Notice tone="error" title="Balances could not load" action={<Button size="sm" variant="secondary-light" onClick={overview.reload}>Try again</Button>}>
          {overview.error.message}
        </Notice>
      ) : !o ? (
        <div role="status" aria-busy="true" aria-label="Loading balances" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : (
        <Body o={o} accounts={accounts} catalog={catalog.data} supply={supply.data} kie={kie} msg={msg} canOperate={caps.includes("catalog.operate")} />
      )}
    </Wrap>
  );
}

function Body({
  o,
  accounts,
  catalog,
  supply,
  kie,
  msg,
  canOperate,
}: {
  o: ProvidersOverview;
  accounts: ProviderAccount[];
  catalog: CatalogData | null;
  supply: Supply | null;
  kie: ReturnType<typeof useKieSummary>;
  msg: { tone: "error" | "success"; text: string } | null;
  canOperate: boolean;
}) {
  const s = kie.s;
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
  const perDay = s ? (s.spend.days7.customerCredits + s.spend.days7.testCredits) / 7 : null;
  const runwayDays = kieCredits !== null && perDay ? kieCredits / perDay : null;

  // Known balances in USD, counting a shared wallet once.
  const seenGroups = new Set<string>();
  let knownUsd = 0;
  let reporting = 0;
  for (const a of o.accounts) {
    if (a.balance.usdApprox === null) continue;
    if (a.walletGroup) {
      if (seenGroups.has(a.walletGroup)) continue;
      seenGroups.add(a.walletGroup);
    }
    knownUsd += a.balance.usdApprox;
    reporting++;
  }
  const t = o.totals;

  return (
    <>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {kieCredits !== null && kieCredits < 0 ? (
        <Notice tone="error" title="KIE reports a negative balance" action={s ? <TopUp href={s.billingUrl} /> : undefined}>
          The KIE account is {fmtKie(Math.abs(kieCredits))} below zero. New generations sent to KIE fail until it is topped up.
        </Notice>
      ) : above.length ? (
        <Notice tone="error" title={`KIE’s balance is too low for some settings of ${above.length} model${above.length === 1 ? "" : "s"}`} action={s ? <TopUp href={s.billingUrl} /> : undefined}>
          KIE has {kieCredits?.toLocaleString("en-US", { maximumFractionDigits: 2 })} credits left
          {kieAcct?.balance.usdApprox !== null && kieAcct?.balance.usdApprox !== undefined ? ` (≈ ${money(kieAcct.balance.usdApprox)})` : ""}. The most expensive
          settings of {listNames(above.map((m) => `${m.name} (up to ${fmtKie(m.cost!.maxCredits)})`))} cost more, so those requests are refused before any
          charge until the account is topped up. Cheaper settings keep working.
        </Notice>
      ) : kieAcct?.balance.low ? (
        <Notice tone="attention" title="KIE balance is below your warning level" action={s ? <TopUp href={s.billingUrl} /> : undefined}>
          {fmtKie(kieCredits)} left; warning at {fmtKie(kieAcct.lowBalanceThreshold)}.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Wallet}
          label="Known balance"
          value={reporting ? `≈ ${money(knownUsd)}` : "Unknown"}
          sub={`${reporting} of ${o.accounts.length} suppliers report a balance${reporting < o.accounts.length ? " · the others have no key yet" : ""}`}
          tone={above.length ? "bad" : "neutral"}
        />
        <Kpi
          icon={Receipt}
          label="Spent today (UTC)"
          value={money(t.todayConfirmedUsd)}
          sub={t.todayEstimatedUsd ? `+ ${money(t.todayEstimatedUsd)} awaiting confirmation` : "Confirmed by the suppliers"}
        />
        <Kpi
          icon={Landmark}
          label="Spent this month"
          value={money(t.monthConfirmedUsd)}
          sub={`${t.monthEstimatedUsd ? `+ ${money(t.monthEstimatedUsd)} awaiting confirmation · ` : ""}${t.pendingUsd ? `${money(t.pendingUsd)} in flight` : "nothing in flight"}`}
        />
        <Kpi
          icon={CalendarClock}
          label="KIE balance lasts"
          value={runwayDays === null ? "—" : runwayDays < 1 ? "< 1" : `≈ ${Math.floor(runwayDays)}`}
          suffix={runwayDays === null ? undefined : "days"}
          sub={perDay ? `At the last 7 days’ pace: ${fmtKie(Math.round(perDay))} a day` : "No KIE spending in the last 7 days"}
          tone={runwayDays !== null && runwayDays < 7 ? "warn" : "neutral"}
        />
      </div>

      <section aria-labelledby="suppliers-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="suppliers-h" className="text-lg font-semibold text-ink-dark">
            Suppliers
          </h2>
          <Link href="/admin/providers?tab=providers" className="inline-flex items-center gap-1 text-sm font-semibold text-info-text hover:underline">
            Keys and settings in Providers &amp; routing <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <SupplierCard key={a.id} a={a} kie={a.provider === "kie" ? kie : null} />
          ))}
        </div>
      </section>

      <PipelineHealth />

      <section aria-labelledby="kie-h" className="space-y-3">
        <h2 id="kie-h" className="text-lg font-semibold text-ink-dark">
          KIE activity
        </h2>
        {s ? (
          <KieActivity s={s} canOperate={canOperate} onSaved={() => void kie.refresh("auto")} />
        ) : kie.error ? (
          <Notice tone="error" title="KIE activity could not load" action={<Button size="sm" variant="secondary-light" onClick={() => void kie.refresh("admin")}>Try again</Button>}>
            {kie.error}
          </Notice>
        ) : (
          <div role="status" aria-busy="true" aria-label="Loading KIE activity" className="h-40 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
        )}
      </section>
    </>
  );
}

function SupplierCard({ a, kie }: { a: ProviderAccount; kie: ReturnType<typeof useKieSummary> | null }) {
  const serving = a.offers.routing;
  const status =
    serving > 0
      ? { tone: "success" as const, label: `Serving ${serving} model${serving === 1 ? "" : "s"}` }
      : a.credential.source === "none"
        ? { tone: "neutral" as const, label: "No API key" }
        : !a.enabled || a.paused
          ? { tone: "info" as const, label: "Key saved · switched off" }
          : { tone: "info" as const, label: "Ready · not serving" };
  const sp = a.spend;
  return (
    <article
      aria-label={a.name}
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-media)] border bg-sheet p-5 shadow-[var(--shadow-lift)]",
        serving > 0 ? "border-[#c7cefd]" : "border-rule",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <SupplierMark provider={a.provider} name={a.name} />
        <Badge surface="light" tone={status.tone}>
          {status.label}
        </Badge>
      </header>
      <div className="mt-4">
        <BalanceCell a={a} large />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-rule pt-3 text-xs">
        <div>
          <dt className="text-muted-dark">Today</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{money(sp.todayConfirmedUsd + sp.todayEstimatedUsd)}</dd>
        </div>
        <div>
          <dt className="text-muted-dark">This month</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{money(sp.monthConfirmedUsd + sp.monthEstimatedUsd)}</dd>
        </div>
        <div>
          <dt className="text-muted-dark">In flight</dt>
          <dd className="mt-0.5 font-semibold text-ink-dark tabular">{sp.pendingJobs ? `${money(sp.pendingUsd)} · ${sp.pendingJobs}` : "—"}</dd>
        </div>
      </dl>
      <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
        {kie ? (
          <>
            <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} busy={kie.busy} onClick={() => void kie.refresh("admin")}>
              Read now
            </Button>
            {kie.s ? <TopUp href={kie.s.billingUrl} /> : null}
          </>
        ) : (
          <Link href="/admin/providers?tab=providers" className="inline-flex items-center gap-1 text-sm font-semibold text-info-text hover:underline">
            {a.credential.source === "none" ? "Add the API key" : "Manage"} <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
        {a.offers.total ? (
          <span className="text-xs text-muted-dark">
            {a.offers.mapped} offer{a.offers.mapped === 1 ? "" : "s"} for Genlixs models · {a.offers.total - a.offers.mapped} more products
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function TopUp({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-info-text underline">
      Top up on KIE <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
