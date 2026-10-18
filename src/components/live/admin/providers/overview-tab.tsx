"use client";

import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { fmtNum } from "@/lib/format";
import { Empty, Notice, when } from "../catalog/shared";
import { BalanceCell, ConnectionBadge, money } from "./parts";
import type { ProvidersOverview } from "./types";

/** Overview: balances with their age and source, Genlixs spending today and this month, pending work and notices. */
export function OverviewTab({ o, onOpen }: { o: ProvidersOverview; onOpen: (tab: "providers" | "models" | "usage") => void }) {
  const t = o.totals;
  const configured = o.accounts.filter((a) => a.credential.source !== "none");
  // Known balances in USD, counting a shared wallet once and leaving unknown or unconvertible balances out.
  const seen = new Set<string>();
  let knownUsd = 0;
  let knownCount = 0;
  for (const a of configured) {
    const key = a.walletGroup ?? a.id;
    if (seen.has(key) || a.balance.usdApprox === null) continue;
    seen.add(key);
    knownUsd += a.balance.usdApprox;
    knownCount++;
  }
  const low = o.accounts.filter((a) => a.balance.low);
  const failing = o.accounts.filter((a) => a.credential.source !== "none" && (a.connection.state === "unauthorized" || a.connection.state === "failed"));
  const blocked = o.accounts.filter((a) => a.circuit.blockedUntil && Date.parse(a.circuit.blockedUntil) > Date.parse(o.generatedAt));

  return (
    <div className="space-y-5">
      {!o.runtime.paidSubmissionsAllowed ? (
        <Notice tone="attention">Paid provider calls are disabled on this deployment (not production). Nothing is sent to suppliers from here.</Notice>
      ) : null}
      {low.length ? (
        <Notice tone="error" title="Low balance">
          {low.map((a) => a.name).join(", ")} {low.length === 1 ? "is" : "are"} below the warning level. Top up at the provider; Genlixs never moves money between accounts.
        </Notice>
      ) : null}
      {failing.length ? (
        <Notice tone="error" title="Connection problem" action={<button type="button" className="font-semibold underline" onClick={() => onOpen("providers")}>Open providers</button>}>
          {failing.map((a) => `${a.name}: ${a.connection.state === "unauthorized" ? "key refused" : a.connection.message ?? "check failed"}`).join(" · ")}
        </Notice>
      ) : null}
      {blocked.length ? (
        <Notice tone="attention" title="Paused by the circuit breaker">
          {blocked.map((a) => `${a.name} until ${when(a.circuit.blockedUntil)} (${a.circuit.code ?? "refused"})`).join(" · ")}. New jobs wait or use another verified supplier.
        </Notice>
      ) : null}
      {o.notices.stalePrices || o.notices.modelsWithoutRoute || o.notices.eligibleWithoutRouting ? (
        <Notice tone="attention" action={<button type="button" className="font-semibold underline" onClick={() => onOpen("models")}>Open models</button>}>
          {[
            o.notices.stalePrices ? `${o.notices.stalePrices} verified offer(s) with a stale price (older than ${o.policy.priceStaleDays} days)` : null,
            o.notices.modelsWithoutRoute ? `${o.notices.modelsWithoutRoute} public model(s) without any routable supplier` : null,
            o.notices.eligibleWithoutRouting ? `${o.notices.eligibleWithoutRouting} verified offer(s) not switched on for routing` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Notice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Confirmed today (UTC)" value={money(t.todayConfirmedUsd)} sub={`+ ${money(t.todayEstimatedUsd)} estimated, awaiting confirmation`} />
        <Tile label="Confirmed this month" value={money(t.monthConfirmedUsd)} sub={`+ ${money(t.monthEstimatedUsd)} estimated, awaiting confirmation`} />
        <Tile label="Pending (sent, not settled)" value={money(t.pendingUsd)} sub={`${fmtNum(t.submissionUnknownJobs)} submission(s) being verified`} />
        <Tile
          label="Known balances"
          value={knownCount ? money(knownUsd) : "Unknown"}
          sub={`${knownCount} of ${configured.length} configured provider(s) with a convertible reading; a shared wallet counts once`}
        />
      </div>
      <p className="text-xs text-muted-dark">
        Amounts are Genlixs supplier spending in USD at each account&apos;s funding terms. A top-up is a transfer into a wallet, not a generation cost, so it is not counted here.
      </p>

      <Panel title="Balances" bodyClass="p-0" action={<button type="button" className="text-sm font-semibold text-info-text underline" onClick={() => onOpen("providers")}>Manage</button>}>
        {o.accounts.length === 0 ? (
          <div className="p-5">
            <Empty>No provider accounts.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-rule">
            {o.accounts.map((a) => (
              <li key={a.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-center">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink-dark">{a.name}</span>
                  {!a.enabled ? (
                    <Badge surface="light" tone="neutral">
                      Off
                    </Badge>
                  ) : null}
                </div>
                <BalanceCell a={a} />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-dark sm:justify-end">
                  <ConnectionBadge a={a} />
                  <span className="tabular">Month {money(a.spend.monthConfirmedUsd)}</span>
                  {a.failures24h ? <span className="font-semibold text-orange-text">{a.failures24h} refused/unknown (24 h)</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[var(--radius-media)] border border-rule bg-sheet p-4 shadow-[var(--shadow-lift)]">
      <p className="text-xs font-semibold text-muted-dark">{label}</p>
      <p className="mt-1.5 text-[1.5rem] leading-none font-semibold tracking-tight tabular text-ink-dark">{value}</p>
      <p className="mt-1.5 text-[11px] text-muted-dark">{sub}</p>
    </div>
  );
}
