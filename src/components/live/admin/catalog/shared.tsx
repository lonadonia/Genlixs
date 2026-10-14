"use client";

import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/format";
import type { AdminModel, AvailabilityState, CapabilitySpec, VerificationStatus } from "./types";

/* Shared formatting and small pieces for the admin catalog workspace (light admin surface). */

const credits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const kie = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** Genlixs customer credits (whole numbers). */
export const fmtGx = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${credits.format(n)} cr`);
/** KIE supplier credits (may be fractional). Always labelled so the two units are never confused. */
export const fmtKie = (n: number | null | undefined) => (n === null || n === undefined ? "Unknown" : `${kie.format(n)} KIE`);
export const fmtUsd4 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : usd4.format(n));
export const fmtUsd2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : usd2.format(n));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : pct.format(n));
const signedPct = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "always" });
/** Markup above cost from a percentage number: "+100 %", "−12.5 %". */
export const fmtMarkup = (pctValue: number | null | undefined) => (pctValue === null || pctValue === undefined ? "—" : `${signedPct.format(pctValue)} %`);
const rate = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
/** USD per credit with up to 6 decimals ($0.005, $0.02, $0.0345). */
export const fmtRate = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : rate.format(n));
/** Page container shared by the catalog, pricing and KIE pages. */
export const Wrap = ({ children }: { children: ReactNode }) => <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6 lg:p-8">{children}</div>;
export const fmtBps = (bps: number) => `${bps / 100} %`;
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—");
export const range = (a: number | null | undefined, b: number | null | undefined, f: (n: number) => string) =>
  a === null || a === undefined ? "—" : a === b || b === null || b === undefined ? f(a) : `${f(a)} – ${f(b)}`;

/** "1080p · With audio · 10 s" from a configuration's option values and the model's option labels. */
export function configLabel(spec: CapabilitySpec | undefined, options: Record<string, string | number>) {
  const parts = Object.entries(options).map(([k, v]) => {
    const o = spec?.options?.[k];
    const label = o?.labels?.[String(v)];
    if (label) return label;
    if (k === "duration") return `${v} s`;
    return String(v);
  });
  return parts.length ? parts.join(" · ") : "Any settings";
}

export const STATE_INFO: Record<AvailabilityState, { label: string; tone: Tone; customer: string }> = {
  enabled: { label: "Enabled", tone: "success", customer: "Customers can choose it and generate." },
  experimental: { label: "Experimental", tone: "violet", customer: "Customers can use it; it is labelled Experimental." },
  maintenance: { label: "Maintenance", tone: "attention", customer: "Shown as temporarily unavailable with your note; no new quotes or submissions." },
  disabled: { label: "Disabled", tone: "neutral", customer: "Hidden from customers; new quotes and submissions are refused. Running jobs finish normally." },
};

export const VERIFY_INFO: Record<VerificationStatus, { label: string; tone: Tone }> = {
  verified_by_test: { label: "Tested", tone: "success" },
  manual_evidence: { label: "Manual evidence", tone: "info" },
  test_failed: { label: "Last test failed", tone: "error" },
  untested: { label: "Not tested yet", tone: "neutral" },
};

export function VerificationBadge({ model }: { model: Pick<AdminModel, "verificationStatus" | "verifiedCurrent"> }) {
  const v = VERIFY_INFO[model.verificationStatus];
  if (model.verificationStatus === "verified_by_test" && model.verifiedCurrent === false) {
    return (
      <Badge surface="light" tone="attention">
        Tested (older options)
      </Badge>
    );
  }
  return (
    <Badge surface="light" tone={v.tone}>
      {v.label}
    </Badge>
  );
}

const BADGE_LABEL: Record<string, string> = { recommended: "Recommended", premium: "Premium", budget: "Budget", fast: "Fast", long: "Longer clips" };
export function ModelBadges({ badges }: { badges: string[] }) {
  if (!badges.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b} className="rounded-full border border-rule bg-paper px-2 py-0.5 text-[11px] font-semibold text-muted-dark">
          {BADGE_LABEL[b] ?? b}
        </span>
      ))}
    </span>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "attention" | "error" | "success"; title?: string; children: ReactNode; action?: ReactNode }) {
  const tones = {
    info: "border-[#c7cefd] bg-info-tint text-info-text",
    attention: "border-[#f3d9a8] bg-orange-tint text-orange-text",
    error: "border-[#f6c4c4] bg-error-tint text-error-text",
    success: "border-[#dceb8f] bg-success-tint text-success-text",
  };
  return (
    <div role={tone === "error" ? "alert" : "note"} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5" : ""}>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid min-w-0 gap-1 text-sm", className)}>
      <span className="font-semibold text-ink-dark">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-dark">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "h-10 rounded-lg border border-rule-strong bg-sheet px-3 text-sm text-ink-dark";

/** Accessible two-state switch with a visible text state. */
export function Switch({ checked, onChange, label, disabled, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "border-brand-blue bg-brand-blue" : "border-rule-strong bg-neutral-tint",
      )}
    >
      <span aria-hidden className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

/** Tab strip (roving selection is not needed for a handful of buttons; each is a real button). */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="scroll-thin flex gap-1 overflow-x-auto border-b border-rule">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap",
            t.id === value ? "border-brand-blue text-ink-dark" : "border-transparent text-muted-dark hover:text-ink-dark",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-neutral-tint px-1.5 text-xs">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-rule-strong p-5 text-center text-sm text-muted-dark">{children}</p>;
}

export const unitLabel = (unit: "output" | "second" | undefined, kind: "image" | "video" | undefined) =>
  unit === "second" ? "per second of video" : kind === "video" ? "per video" : "per image";
