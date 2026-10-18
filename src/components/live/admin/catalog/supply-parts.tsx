"use client";

import type { ComponentType, ReactNode } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/format";
import { inputCls } from "./shared";
import { savingLabel, STAGE_INFO, type SupplyStage } from "./supply";

/* Small pieces shared by the Models, Pricing and Supplier balances pages (light admin surface). */

/** One fixed colour per supplier so a supplier is recognisable at a glance; white text is ≥ 4.5:1 on each. */
const SUPPLIER_COLOR: Record<string, string> = {
  kie: "#253ff6",
  nezhagate: "#0f766e",
  duomi: "#b45309",
  poyo: "#7c3aed",
  apimart: "#be123c",
  cuddler: "#0369a1",
};

export function SupplierMark({ provider, name, quiet, className }: { provider: string; name: string; quiet?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs font-semibold whitespace-nowrap",
        quiet ? "border-rule bg-sheet text-muted-dark" : "border-rule bg-paper text-ink-dark",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] leading-none font-bold text-white"
        style={{ backgroundColor: SUPPLIER_COLOR[provider] ?? "#59615f", opacity: quiet ? 0.75 : 1 }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function StageBadge({ stage }: { stage: SupplyStage }) {
  const s = STAGE_INFO[stage];
  return (
    <span title={s.hint}>
      <Badge surface="light" tone={s.tone}>
        {s.label}
      </Badge>
    </span>
  );
}

/** "−78 %" for a cheaper alternative (never shown for an equal or higher price). */
export function SavingTag({ fraction }: { fraction: number }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full bg-success-tint px-1.5 text-[11px] font-bold text-success-text tabular">
      {savingLabel(fraction)}
    </span>
  );
}

/** Summary tile: label, one large value, one line of context. */
export function Kpi({
  label,
  value,
  suffix,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  suffix?: ReactNode;
  sub?: ReactNode;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const accents = {
    neutral: "bg-neutral-tint text-ink-dark",
    good: "bg-success-tint text-success-text",
    warn: "bg-orange-tint text-orange-text",
    bad: "bg-error-tint text-error-text",
  };
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-media)] border border-rule bg-sheet p-4 shadow-[var(--shadow-lift)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted-dark">{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", accents[tone])}>
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <p className="mt-1 font-display text-[1.75rem] leading-tight font-extrabold tracking-tight text-ink-dark tabular">
        {value}
        {suffix ? <span className="ml-1 text-base font-semibold text-muted-dark">{suffix}</span> : null}
      </p>
      {sub ? <p className="mt-1 text-xs leading-snug text-muted-dark">{sub}</p> : null}
    </div>
  );
}

/** Pill group of mutually exclusive filters (each option is a real toggle button). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="scroll-thin inline-flex max-w-full overflow-x-auto rounded-full border border-rule-strong bg-sheet p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap",
            value === o.id ? "bg-ink-dark text-white" : "text-muted-dark hover:text-ink-dark",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className={cn("ml-1.5 text-xs tabular", value === o.id ? "text-white/75" : "text-muted-dark")}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="relative block w-full sm:w-64">
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} className={cn(inputCls, "w-full pl-9")} />
    </label>
  );
}

/** Heading row inside a table body that groups rows by type ("Images · 6"). */
export function GroupRow({ label, count, colSpan }: { label: string; count: number; colSpan: number }) {
  return (
    <tr className="bg-paper/70">
      <th scope="colgroup" colSpan={colSpan} className="px-4 pt-4 pb-2 text-left text-xs font-bold tracking-wide text-muted-dark uppercase sm:px-5">
        {label} <span className="font-semibold tabular">· {count}</span>
      </th>
    </tr>
  );
}

/** Model type labels used across the catalog pages. */
export const TYPE_LABEL: Record<string, string> = { image: "Image", edit: "Image edit", video: "Video" };
export const TYPE_GROUP: Record<string, string> = { image: "Images", edit: "Image editing", video: "Videos" };
export const TYPE_ORDER = ["image", "edit", "video"] as const;
