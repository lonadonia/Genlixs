"use client";

import Image from "next/image";
import { useId, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import type { OptionSpec } from "@/lib/live/types";
import { cn } from "@/lib/format";

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
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl bg-canvas/70 p-1 ring-1 ring-white/[0.06]">
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
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 font-semibold transition-colors",
              size === "sm" ? "h-9 text-[13px]" : "h-10 text-sm",
              on ? "bg-raised text-ink shadow-[0_1px_0_rgb(255_255_255/0.06)_inset]" : "text-muted hover:text-ink",
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

/**
 * Compact setting chip (length, shape, resolution) backed by a native select: one tap opens the platform's own
 * picker on phones, and keyboard and screen readers get a standard control.
 */
export function OptionChip({
  optionKey,
  spec,
  value,
  onChange,
  icon,
}: {
  optionKey: string;
  spec: OptionSpec;
  value: string | number;
  onChange: (v: string | number) => void;
  icon: ReactNode;
}) {
  const fixed = spec.values.length < 2;
  return (
    <label
      className={cn(
        "relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-raised px-2.5 text-sm font-semibold text-ink ring-1 ring-white/[0.06] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
        fixed ? "text-muted" : "cursor-pointer hover:ring-white/20",
      )}
      title={spec.label}
    >
      <span className="text-muted">{icon}</span>
      <span className="truncate tabular">{valueLabel(spec, value, optionKey)}</span>
      <select
        aria-label={spec.label}
        value={String(value)}
        disabled={fixed}
        onChange={(e) => onChange(typeof spec.values[0] === "number" ? Number(e.target.value) : e.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
      >
        {spec.values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {valueLabel(spec, v, optionKey)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A labelled row (Model, Quality, Tier…) in the panel's list style; the value opens a native picker. */
export function OptionRow({
  optionKey,
  spec,
  value,
  onChange,
  label,
}: {
  optionKey: string;
  spec: OptionSpec;
  value: string | number;
  onChange: (v: string | number) => void;
  label?: string;
}) {
  const fixed = spec.values.length < 2;
  return (
    <label
      className={cn(
        "relative flex items-center justify-between gap-3 rounded-2xl bg-raised px-3.5 py-2.5 ring-1 ring-white/[0.06] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]",
        fixed ? "" : "cursor-pointer hover:ring-white/20",
      )}
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-muted">{label ?? spec.label}</span>
        <span className="block truncate text-[15px] font-semibold text-ink">{valueLabel(spec, value, optionKey)}</span>
      </span>
      {fixed ? null : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />}
      <select
        aria-label={label ?? spec.label}
        value={String(value)}
        disabled={fixed}
        onChange={(e) => onChange(typeof spec.values[0] === "number" ? Number(e.target.value) : e.target.value)}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
      >
        {spec.values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {valueLabel(spec, v, optionKey)}
          </option>
        ))}
      </select>
    </label>
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
        className="flex h-11 w-full items-center justify-between rounded-xl px-1 text-sm font-semibold text-ink hover:text-white"
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
    <div className="relative h-[116px] overflow-hidden rounded-2xl ring-1 ring-white/[0.06] sm:h-[128px]">
      <Image src={poster} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className="object-cover object-[center_32%]" priority={false} />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[rgb(8_10_10/0.92)] via-[rgb(8_10_10/0.45)] to-[rgb(8_10_10/0.05)]" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgb(37_63_246/0.35),transparent_60%)]" />
      <button
        type="button"
        onClick={onHelp}
        className="absolute top-2.5 right-2.5 flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs font-semibold text-white backdrop-blur hover:bg-black/70"
      >
        <BookOpen aria-hidden className="size-3.5" /> How it works
      </button>
      <div className="absolute inset-x-4 bottom-3">
        <p className="font-display text-xl leading-none font-extrabold tracking-tight text-white uppercase sm:text-[22px]">{title}</p>
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
