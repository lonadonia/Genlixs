"use client";

import Image from "next/image";
import { useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import type { OptionSpec } from "@/lib/live/types";
import { cn } from "@/lib/format";
import { SelectMenu } from "@/components/ui/select-menu";

/**
 * Mutually exclusive choice as a radio group (References | Extend video, input combination, orientation…).
 * Arrow keys move the choice, as in a native radio group; only the selected option is in the tab order.
 */
export function ChoiceBar<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { id: T; label: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-canvas/70 p-[3px] ring-1 ring-white/[0.06]">
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2 font-semibold transition-colors",
              size === "sm" ? "h-8 text-[12.5px]" : "h-9 text-[13px]",
              on ? "control-raised bg-elevated text-ink" : "text-muted hover:text-ink",
            )}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const valueLabel = (spec: OptionSpec, v: string | number, key: string) =>
  spec.labels?.[String(v)] ?? (key === "duration" || key === "seconds" ? `${v}s` : String(v).replace(/^4k$/i, "4K"));

/** The values of a setting as menu options; values the model does not offer with the other settings are disabled. */
const menuOptions = (spec: OptionSpec, optionKey: string, unavailable?: Set<string>, unavailableHint?: string) =>
  spec.values.map((v) => ({ value: v, label: valueLabel(spec, v, optionKey), ...(unavailable?.has(String(v)) ? { disabled: true, hint: unavailableHint ?? "Not with these settings" } : {}) }));

/** Compact setting chip (length, shape, resolution); opens the shared dark select popover. */
export function OptionChip({
  optionKey,
  spec,
  value,
  onChange,
  icon,
  unavailable,
  unavailableHint,
}: {
  optionKey: string;
  spec: OptionSpec;
  value: string | number;
  onChange: (v: string | number) => void;
  icon: ReactNode;
  /** Values that would form a combination the model does not offer with the other current settings. */
  unavailable?: Set<string>;
  unavailableHint?: string;
}) {
  const fixed = spec.values.length < 2;
  return (
    <SelectMenu
      label={spec.label}
      value={value}
      options={menuOptions(spec, optionKey, unavailable, unavailableHint)}
      onChange={onChange}
      className={cn(
        "control-raised flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-white/[0.07] bg-raised px-2 text-[13px] font-semibold text-ink transition-colors",
        fixed ? "text-muted" : "hover:border-white/[0.18] aria-expanded:border-brand-blue-bright/70 aria-expanded:bg-elevated",
      )}
    >
      {(selected, open) => (
        <>
          <span className="text-muted">{icon}</span>
          <span className="truncate tabular">{selected?.label ?? valueLabel(spec, value, optionKey)}</span>
          {fixed ? null : <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-180")} />}
        </>
      )}
    </SelectMenu>
  );
}

/** A labelled row (Quality, Tier…) in the panel's list style; the value opens the shared dark select popover. */
export function OptionRow({
  optionKey,
  spec,
  value,
  onChange,
  label,
  unavailable,
  unavailableHint,
}: {
  optionKey: string;
  spec: OptionSpec;
  value: string | number;
  onChange: (v: string | number) => void;
  label?: string;
  unavailable?: Set<string>;
  unavailableHint?: string;
}) {
  const fixed = spec.values.length < 2;
  return (
    <SelectMenu
      label={label ?? spec.label}
      value={value}
      options={menuOptions(spec, optionKey, unavailable, unavailableHint)}
      onChange={onChange}
      className={cn(
        "control-raised flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-raised px-3 py-2 text-left transition-colors",
        fixed ? "" : "hover:border-white/[0.18] aria-expanded:border-brand-blue-bright/70",
      )}
    >
      {(selected, open) => (
        <>
          <span className="min-w-0">
            <span className="block text-[11px] font-medium text-muted">{label ?? spec.label}</span>
            <span className="block truncate text-sm font-semibold text-ink">{selected?.label ?? valueLabel(spec, value, optionKey)}</span>
          </span>
          {fixed ? null : <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />}
        </>
      )}
    </SelectMenu>
  );
}

/** Collapsed section ("Advanced settings"); content stays mounted only while open. */
export function Disclosure({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between rounded-xl px-1 text-[13px] font-semibold text-ink hover:text-white"
      >
        {title}
        <ChevronDown aria-hidden className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div id={id} className="animate-fade-up space-y-3 pb-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Restrained mode banner: a project-owned still, the mode's name and one line of help. */
export function ModeBanner({ title, subtitle, poster, onHelp }: { title: string; subtitle: string; poster: string; onHelp: () => void }) {
  return (
    <div className="relative h-[104px] overflow-hidden rounded-[14px] ring-1 ring-white/[0.06] sm:h-[112px]">
      <Image src={poster} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className="object-cover object-[center_32%]" priority={false} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[rgb(8_10_10/0.92)] via-[rgb(8_10_10/0.45)] to-[rgb(8_10_10/0.05)]" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgb(37_63_246/0.35),transparent_60%)]" />
      <button
        type="button"
        onClick={onHelp}
        className="absolute top-2 right-2 flex h-7 items-center gap-1.5 rounded-lg bg-black/55 px-2.5 text-xs font-semibold text-white ring-1 ring-white/10 backdrop-blur hover:bg-black/70"
      >
        <BookOpen aria-hidden className="size-3.5" /> How it works
      </button>
      <div className="absolute inset-x-3.5 bottom-2.5">
        <p className="font-display text-lg leading-none font-extrabold tracking-tight text-white uppercase sm:text-xl">{title}</p>
        <p className="mt-1 truncate text-xs text-white/80">{subtitle}</p>
      </div>
    </div>
  );
}

/** Numbered guidance shown by "How it works". */
export function Steps({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[rgb(37_63_246/0.2)] text-xs font-bold text-link">
            {i + 1}
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink">{s.title}</span>
            <span className="mt-0.5 block text-sm text-muted">{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
