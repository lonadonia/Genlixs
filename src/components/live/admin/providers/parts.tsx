"use client";

import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/format";
import { when } from "../catalog/shared";
import type { Candidate, Decision, OfferStatus, ProviderAccount } from "./types";

/* Small shared pieces of the Providers & routing admin section (light admin surface). */

const usdFine = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** USD with up to 6 decimals (supplier unit prices are small). null = unknown, never $0. */
export const usd = (n: number | null | undefined, unknown = "Unknown") => (n === null || n === undefined ? unknown : usdFine.format(n));
export const usdShort = (n: number | null | undefined, unknown = "Unknown") => (n === null || n === undefined ? unknown : usd2.format(n));
const usdSmall = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** Spending: cents for larger amounts, up to four decimals below one dollar (a $0.005 job is never shown as $0.01). */
export const money = (n: number | null | undefined, unknown = "Unknown") =>
  n === null || n === undefined ? unknown : Math.abs(n) < 1 ? usdSmall.format(n) : usd2.format(n);

export const UNIT_LABEL: Record<string, string> = {
  usd: "USD",
  kie_credit: "KIE credits",
  poyo_credit: "PoYo credits",
  apimart_credit: "APIMart credits",
  cny: "CNY",
  duomi_point: "Duomi points",
};
/** An amount always carries its unit: supplier credits, points and Genlixs credits are never mixed. */
export const native = (n: number | null | undefined, unit: string | null | undefined) =>
  n === null || n === undefined ? "Unknown" : unit === "usd" ? usdFine.format(n) : `${num.format(n)} ${UNIT_LABEL[unit ?? ""] ?? unit ?? ""}`.trim();

export const age = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 90) return `${seconds} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} days ago`;
};

export const STATUS_INFO: Record<OfferStatus, { label: string; tone: Tone }> = {
  discovered: { label: "Discovered", tone: "neutral" },
  pricing_unverified: { label: "Price unverified", tone: "attention" },
  capabilities_unverified: { label: "Capabilities unverified", tone: "attention" },
  configured: { label: "Configured", tone: "info" },
  eligible: { label: "Verified", tone: "success" },
  disabled: { label: "Disabled", tone: "neutral" },
  stale: { label: "Stale", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "error" },
};

export const DECISION_INFO: Record<Decision, { label: string; tone: Tone; hint: string }> = {
  eligible: { label: "Wins", tone: "success", hint: "Cheapest (or tied) for at least one supported configuration." },
  dominated: { label: "Dominated", tone: "neutral", hint: "Another verified offer is cheaper for every configuration it supports." },
  incompatible: { label: "Incompatible", tone: "warning", hint: "Supports none of the model's configurations." },
  unavailable: { label: "Unavailable", tone: "error", hint: "Marked unavailable at the provider." },
  unresolved: { label: "Unresolved", tone: "attention", hint: "Missing price, capability or integration evidence." },
};

export function StatusBadge({ status }: { status: OfferStatus }) {
  const s = STATUS_INFO[status];
  return (
    <Badge surface="light" tone={s.tone}>
      {s.label}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const d = DECISION_INFO[decision];
  return (
    <span title={d.hint}>
      <Badge surface="light" tone={d.tone}>
        {d.label}
      </Badge>
    </span>
  );
}

const CONNECTION: Record<ProviderAccount["connection"]["state"], { label: string; tone: Tone }> = {
  untested: { label: "Not tested", tone: "neutral" },
  ok: { label: "Connected", tone: "success" },
  failed: { label: "Check failed", tone: "error" },
  unauthorized: { label: "Key refused", tone: "error" },
  unsupported: { label: "No read-only check", tone: "attention" },
};

export function ConnectionBadge({ a }: { a: ProviderAccount }) {
  if (a.credential.source === "none") {
    return (
      <Badge surface="light" tone="neutral">
        No key
      </Badge>
    );
  }
  const c = CONNECTION[a.connection.state];
  return (
    <Badge surface="light" tone={c.tone}>
      {c.label}
    </Badge>
  );
}

/**
 * Balance exactly as known: the number with its unit, where it came from (provider API or a dated manual entry), how
 * old it is, and whether the last read failed. Unknown is shown as unknown; an unlimited key allowance is not a wallet.
 */
export function BalanceCell({ a, large }: { a: ProviderAccount; large?: boolean }) {
  const b = a.balance;
  const value = b.available ?? b.total;
  const failing = b.lastErrorAt && (!b.observedAt || Date.parse(b.lastErrorAt) > Date.parse(b.observedAt));
  const label =
    a.credential.source === "none"
      ? "No key saved"
      : value === null
        ? b.unlimitedKeyQuota
          ? "Unlimited key allowance (wallet unknown)"
          : "Unknown"
        : native(value, b.unit);
  return (
    <div className="min-w-0">
      <p className={cn("font-semibold tabular text-ink-dark", large ? "text-[1.5rem] leading-tight" : "text-sm")}>{label}</p>
      <p className="mt-0.5 text-xs text-muted-dark">
        {value !== null && b.usdApprox !== null && b.unit !== "usd" ? `≈ ${usdShort(b.usdApprox)} · ` : ""}
        {b.source === "manual" ? "Manual entry" : b.source === "api" ? "From provider API" : "No reading yet"}
        {b.observedAt ? ` · ${age(b.ageSeconds) ?? when(b.observedAt)}` : ""}
        {b.held !== null ? ` · ${native(b.held, b.unit)} held` : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {b.observedAt && b.stale ? (
          <Badge surface="light" tone="attention">
            Stale
          </Badge>
        ) : null}
        {b.low ? (
          <Badge surface="light" tone="error">
            Below warning
          </Badge>
        ) : null}
        {failing ? (
          <Badge surface="light" tone="error">
            Last read failed ({b.lastError})
          </Badge>
        ) : null}
        {a.walletGroup ? (
          <Badge surface="light" tone="info">
            Shared wallet: {a.walletGroup}
          </Badge>
        ) : null}
      </div>
      {b.note ? <p className="mt-1 text-[11px] text-muted-dark">{b.note}</p> : null}
    </div>
  );
}

/** One candidate's cost line: native amount, nominal and funded USD, or the reason it was excluded. */
export function CandidateCost({ c }: { c: Candidate }) {
  if (c.excluded) return <span className="text-xs text-muted-dark">{c.excluded}</span>;
  if (c.effectiveUsd === null) return <span className="text-xs text-muted-dark">Cost unknown for these settings</span>;
  return (
    <span className="tabular">
      <span className="font-semibold text-ink-dark">{usd(c.effectiveUsd)}</span>
      <span className="text-xs text-muted-dark">
        {" "}
        {c.unit !== "usd" ? ` · ${native(c.native, c.unit)}` : ""}
        {c.nominalUsd !== null && c.nominalUsd !== c.effectiveUsd ? ` · ${usd(c.nominalUsd)} before funding terms` : ""}
      </span>
    </span>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-dark">{k}</dt>
      <dd className="min-w-0 break-words text-ink-dark">{children}</dd>
    </div>
  );
}

export const settingsText = (o: Record<string, unknown> | null | undefined) =>
  o && Object.keys(o).length
    ? Object.entries(o)
        .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
        .join(" · ")
    : "Default settings";
