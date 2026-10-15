"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, FlaskConical, Search } from "lucide-react";
import type { CatalogModel } from "@/lib/live/types";
import { cn } from "@/lib/format";

/** One-line capability summary from the model's own spec (never marketing claims). */
export function capabilitySummary(m: CatalogModel): string[] {
  const out: string[] = [];
  const res = m.options.resolution ?? m.options.mode;
  if (res) {
    const order = ["480p", "540p", "720p", "1080p", "4k", "4K"];
    const top = [...res.values].map(String).sort((a, b) => order.indexOf(a) - order.indexOf(b)).pop();
    if (top) out.push(top.replace(/^4k$/i, "4K"));
  }
  const dur = m.options.duration;
  if (dur) {
    const v = dur.values.map(Number).filter(Number.isFinite);
    if (v.length) out.push(Math.min(...v) === Math.max(...v) ? `${v[0]} s` : `${Math.min(...v)}–${Math.max(...v)} s`);
  }
  const derived = Object.entries(m.options).find(([, o]) => o.derived);
  if (derived) {
    const v = derived[1].values.map(Number);
    out.push(`${Math.min(...v)}–${Math.max(...v)} s from your clip`);
  }
  const slots = Object.values(m.inputs ?? {});
  if (slots.some((s) => s.label === "Start frame" || s.label === "First frame")) out.push("Start/end frame");
  if (slots.some((s) => s.group === "elements")) out.push("@Elements");
  if (slots.some((s) => s.label === "Reference images")) out.push("References");
  if (slots.some((s) => s.kind === "audio")) out.push("Audio refs");
  if (m.options.audio) out.push("Sound");
  return out;
}

export type PickerModel = CatalogModel & { privateTest?: boolean };

const PANEL_W = 380;
const PANEL_MAX_H = 480;

/**
 * Searchable model selector (popover beside the panel on desktop, sheet on phones). Rendered in a portal so the
 * composer's own scrolling never clips it. Lists only models that fit the current operation; models offered only as
 * a private staff test are grouped and labelled. Keyboard: arrows, Home/End, Enter, Escape.
 */
export function ModelPicker({ models, value, onChange, label = "Model" }: { models: PickerModel[]; value: PickerModel | null; onChange: (id: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? models.filter((m) => `${m.name} ${m.family ?? ""} ${m.variant ?? ""} ${capabilitySummary(m).join(" ")}`.toLowerCase().includes(t)) : models;
  }, [models, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const t = window.setTimeout(() => search.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const choose = (m: PickerModel) => {
    onChange(m.id);
    setOpen(false);
    setQ("");
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter" && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]);
    }
  };

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          setActive(Math.max(0, models.findIndex((m) => m.id === value?.id)));
          // Desktop: open beside the button, kept inside the viewport.
          const r = btn.current?.getBoundingClientRect();
          if (r) {
            const left = r.right + 12 + PANEL_W <= window.innerWidth - 8 ? r.right + 12 : Math.max(8, r.left);
            const top = Math.max(8, Math.min(r.top, window.innerHeight - PANEL_MAX_H - 8));
            setAt({ top: left === r.right + 12 ? top : Math.min(r.bottom + 8, window.innerHeight - PANEL_MAX_H - 8), left });
          }
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-raised px-3.5 py-2.5 text-left hover:border-white/20"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-muted">{label}</span>
          <span className="flex items-center gap-2 truncate text-[15px] font-semibold text-ink">
            {value ? value.name : "Choose a model"}
            {value?.privateTest ? <FlaskConical aria-label="Private test" className="size-4 text-orange-on-dark" /> : null}
          </span>
        </span>
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open
        ? createPortal(
            <>
              <div aria-hidden className="fixed inset-0 z-40 bg-[rgb(8_10_10/0.6)] lg:hidden" onClick={() => setOpen(false)} />
              <div
                ref={panel}
                role="dialog"
                aria-label="Choose a model"
                onKeyDown={onKey}
                style={at ? ({ "--picker-top": `${at.top}px`, "--picker-left": `${at.left}px` } as React.CSSProperties) : undefined}
                className="fixed inset-x-3 bottom-3 z-50 max-h-[70dvh] overflow-hidden rounded-[20px] border border-white/10 bg-elevated shadow-[var(--shadow-pop)] lg:inset-x-auto lg:top-[var(--picker-top,80px)] lg:bottom-auto lg:left-[var(--picker-left,420px)] lg:w-[380px]"
              >
          <div className="flex items-center gap-2 border-b border-white/[0.08] px-3">
            <Search aria-hidden className="size-4 text-muted" />
            <input
              ref={search}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
              aria-label="Search models"
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
              placeholder="Search models"
              className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="scroll-thin max-h-[calc(70dvh-48px)] overflow-y-auto p-2 lg:max-h-[420px]">
            {filtered.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted">No model matches “{q}”.</li> : null}
            {filtered.map((m, i) => {
              const selected = m.id === value?.id;
              const caps = capabilitySummary(m);
              const firstTest = m.privateTest && !filtered[i - 1]?.privateTest;
              return (
                <li key={m.id} role="presentation">
                  {firstTest ? (
                    <p className="mt-2 px-3 pb-1 text-[11px] font-semibold tracking-wide text-orange-on-dark uppercase">Private test · not on sale</p>
                  ) : null}
                  <div
                    id={`${listId}-${m.id}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(m)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5",
                      i === active ? "bg-white/[0.07]" : "",
                      selected ? "ring-1 ring-brand-blue-bright/60" : "",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {m.name}
                        {m.state === "experimental" ? <span className="rounded-full bg-[rgb(169_180_255/0.16)] px-2 py-0.5 text-[10px] font-bold text-link">BETA</span> : null}
                        {(m.badges ?? []).includes("recommended") ? <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-bold text-white">TOP</span> : null}
                      </span>
                      {caps.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {caps.map((c) => (
                            <span key={c} className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-ink">
                              {c}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {m.purpose ? <span className="mt-1 line-clamp-2 block text-xs text-muted">{m.purpose}</span> : null}
                    </span>
                    {selected ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-blue-bright" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
