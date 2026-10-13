"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import type { ModelSlot } from "@/lib/catalog";
import { cn } from "@/lib/format";

const RATIO_BOX: Record<string, [number, number]> = {
  "1:1": [18, 18],
  "3:2": [24, 16],
  "2:3": [16, 24],
  "16:9": [26, 15],
  "9:16": [14, 24],
  "4:5": [17, 21],
  Original: [22, 16],
};

/** Ratio chips: simple proportion rectangles + text label (guide §08, §11). */
export function RatioChips({ value, options, onChange, legend = "Aspect ratio" }: { value: string; options: string[]; onChange: (v: string) => void; legend?: string }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((r) => {
          const [w, h] = RATIO_BOX[r] ?? [20, 16];
          const selected = r === value;
          return (
            <label
              key={r}
              className={cn(
                "flex h-14 min-w-[60px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border px-2 text-xs font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                selected ? "border-brand-blue bg-[rgb(28_93_255/0.16)] text-ink" : "border-line-strong bg-raised text-muted hover:text-ink",
              )}
            >
              <input type="radio" name={name} value={r} checked={selected} onChange={() => onChange(r)} className="sr-only" />
              <span aria-hidden className={cn("block rounded-[3px] border-2", selected ? "border-link" : "border-current")} style={{ width: w, height: h }} />
              {r}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  format = (v) => String(v),
}: {
  legend: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-[var(--radius-control)] border border-line-strong bg-raised p-1">
        {options.map((o) => {
          const selected = o === value;
          return (
            <label
              key={String(o)}
              className={cn(
                "flex h-9 min-w-14 cursor-pointer items-center justify-center rounded-[8px] px-3 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                selected ? "bg-brand-blue text-white" : "text-muted hover:text-ink",
              )}
            >
              <input type="radio" name={name} checked={selected} onChange={() => onChange(o)} className="sr-only" />
              {format(o)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-7 w-12 shrink-0 rounded-full border transition-colors", checked ? "border-brand-blue bg-brand-blue" : "border-line-strong bg-raised")}
      >
        <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform", checked && "translate-x-5")} />
      </button>
    </div>
  );
}

/** Model selector: explains why each model is useful; maintenance models are visible but not selectable. */
export function ModelPicker({ models, value, onChange }: { models: ModelSlot[]; value: string; onChange: (m: ModelSlot) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">Model</legend>
      <div className="grid gap-2">
        {models.map((m) => {
          const disabled = m.availability === "maintenance";
          const selected = m.id === value;
          const descId = `${name}-${m.id}-d`;
          return (
            <label
              key={m.id}
              className={cn(
                "relative flex gap-3 rounded-[var(--radius-control)] border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
                disabled ? "cursor-not-allowed border-line bg-surface opacity-80" : "cursor-pointer",
                selected ? "border-brand-blue bg-[rgb(28_93_255/0.12)]" : !disabled && "border-line-strong bg-raised hover:border-[#8f9db5]",
              )}
            >
              <input
                type="radio"
                name={name}
                checked={selected}
                disabled={disabled}
                aria-describedby={descId}
                onChange={() => onChange(m)}
                className="mt-1 size-4 shrink-0 accent-[#1c5dff]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{m.name}</span>
                  {m.availability === "experimental" ? <Badge tone="violet">Experimental</Badge> : null}
                  {m.availability === "maintenance" ? <Badge tone="warning">Maintenance</Badge> : null}
                </span>
                <span id={descId} className="mt-0.5 block text-[13px] leading-snug text-muted">
                  {m.purpose}
                  {m.availabilityNote ? <span className="mt-1 block text-orange-on-dark">{m.availabilityNote}</span> : null}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
