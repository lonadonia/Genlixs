"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, FlaskConical, Search, SlidersHorizontal } from "lucide-react";
import type { CatalogModel } from "@/lib/live/types";
import { cn, fmtNum } from "@/lib/format";
import { SelectMenu } from "@/components/ui/select-menu";
import { capabilitySummary, fromCredits, WORKFLOWS } from "@/lib/live/model-summary";
import { providerOf } from "@/lib/live/makers";
import { ModelLogo } from "./model-logo";

export { capabilitySummary, fromCredits };

export type PickerModel = CatalogModel & { privateTest?: boolean };

const PANEL_W = 380;
const PANEL_MAX_H = 520;
const ALL = "all";

/**
 * Searchable model selector shared by Image and Video: models grouped by who makes them, each with its provider mark,
 * real name, concise capability chips and its lowest price ("From …"). Long lists get two compact filters (maker and,
 * for video, what the model can start from). Popover beside the panel on desktop, sheet on phones; rendered in a portal
 * so the composer's own scrolling never clips it. Models under maintenance are listed but cannot be chosen.
 * Keyboard: arrows, Home/End, Enter, Escape; typing filters.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  label = "Model",
  unavailable = [],
}: {
  models: PickerModel[];
  value: PickerModel | null;
  onChange: (id: string) => void;
  label?: string;
  unavailable?: CatalogModel[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [maker, setMaker] = useState<string>(ALL);
  const [workflow, setWorkflow] = useState<string>(ALL);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const makers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const m of models) if (!m.privateTest) seen.set(providerOf(m).name, (seen.get(providerOf(m).name) ?? 0) + 1);
    return [...seen.entries()];
  }, [models]);
  const workflows = useMemo(() => WORKFLOWS.filter((w) => models.some(w.test) && !models.every(w.test)), [models]);
  const showFilters = models.length > 8;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const wf = WORKFLOWS.find((w) => w.id === workflow);
    return models.filter(
      (m) =>
        (maker === ALL || providerOf(m).name === maker) &&
        (!wf || wf.test(m)) &&
        (!t || `${m.name} ${m.family ?? ""} ${m.variant ?? ""} ${providerOf(m).name} ${capabilitySummary(m).join(" ")}`.toLowerCase().includes(t)),
    );
  }, [models, q, maker, workflow]);
  // Grouped by maker in catalog order (private tests last, as given); the flat order drives keyboard navigation.
  const groups = useMemo(() => {
    const out: { name: string; items: PickerModel[] }[] = [];
    for (const m of filtered) {
      const name = m.privateTest ? "Private test · not on sale" : providerOf(m).name;
      const g = out.find((x) => x.name === name);
      if (g) g.items.push(m);
      else out.push({ name, items: [m] });
    }
    return out;
  }, [filtered]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // Clicks inside a filter's own popover (rendered in a portal) belong to the picker.
      if (t.closest?.("[data-popover]")) return;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const timer = window.setTimeout(() => search.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(`#${CSS.escape(`${listId}-${flat[active]?.id ?? ""}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, flat, listId]);

  const choose = (m: PickerModel) => {
    onChange(m.id);
    setOpen(false);
    setQ("");
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    // Keys inside a filter (its button or its popover, which React bubbles here through the portal) are its own.
    if ((e.target as Element).closest?.("[data-filter],[data-popover]")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Tab" && !(e.target as Element).closest?.("[data-filters]")) {
      setOpen(false);
    }
  };
  const filtersOn = maker !== ALL || workflow !== ALL;

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // Desktop: open beside the button, kept inside the viewport.
          const r = btn.current?.getBoundingClientRect();
          if (r) {
            const left = r.right + 12 + PANEL_W <= window.innerWidth - 8 ? r.right + 12 : Math.max(8, r.left);
            const top = Math.max(8, Math.min(r.top, window.innerHeight - PANEL_MAX_H - 8));
            setAt({ top: left === r.right + 12 ? top : Math.max(8, Math.min(r.bottom + 8, window.innerHeight - PANEL_MAX_H - 8)), left });
          }
          setActive(Math.max(0, flat.findIndex((m) => m.id === value?.id)));
          setOpen((v) => !v);
        }}
        className="control-raised flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-raised px-2.5 py-2 text-left transition-colors hover:border-white/[0.18] aria-expanded:border-brand-blue-bright/70"
      >
        {value ? <ModelLogo model={value} /> : <span aria-hidden className="size-8 rounded-lg bg-white/[0.06]" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-muted">
            {label}
            {models.length > 1 ? <span className="text-subtle"> · {models.length} available</span> : null}
          </span>
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            <span className="truncate">{value ? value.name : "Choose a model"}</span>
            {value?.privateTest ? <FlaskConical aria-label="Private test" className="size-3.5 shrink-0 text-orange-on-dark" /> : null}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted transition-transform lg:-rotate-90", open && "rotate-180 lg:rotate-0")} />
      </button>
      {open
        ? createPortal(
            <>
              <div aria-hidden className="fixed inset-0 z-40 bg-[rgb(8_10_10/0.6)] lg:hidden" onClick={() => setOpen(false)} />
              <div
                ref={panel}
                role="dialog"
                aria-label={`Choose a ${label.toLowerCase()}`}
                onKeyDown={onKey}
                style={at ? ({ "--picker-top": `${at.top}px`, "--picker-left": `${at.left}px` } as React.CSSProperties) : undefined}
                className="studio-ui fixed inset-x-3 bottom-3 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-[16px] border border-white/10 bg-elevated shadow-[var(--shadow-pop)] lg:inset-x-auto lg:top-[var(--picker-top,80px)] lg:bottom-auto lg:left-[var(--picker-left,420px)] lg:max-h-[520px] lg:w-[380px]"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-3">
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
                    aria-activedescendant={flat[active] ? `${listId}-${flat[active].id}` : undefined}
                    placeholder={`Search ${models.length} models`}
                    className="h-11 w-full bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
                  />
                </div>
                {showFilters ? (
                  <div data-filters="" className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.08] px-3 py-2">
                    <SlidersHorizontal aria-hidden className="size-3.5 text-subtle" />
                    <FilterSelect
                      label="Maker"
                      value={maker}
                      options={[{ value: ALL, label: "All makers" }, ...makers.map(([name, n]) => ({ value: name, label: name, hint: String(n) }))]}
                      onChange={(v) => {
                        setMaker(v);
                        setActive(0);
                      }}
                    />
                    {workflows.length > 1 ? (
                      <FilterSelect
                        label="Starts from"
                        value={workflow}
                        options={[{ value: ALL, label: "Any input" }, ...workflows.map((w) => ({ value: w.id, label: w.label }))]}
                        onChange={(v) => {
                          setWorkflow(v);
                          setActive(0);
                        }}
                      />
                    ) : null}
                    {filtersOn ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMaker(ALL);
                          setWorkflow(ALL);
                          setActive(0);
                        }}
                        className="ml-auto text-[11.5px] font-semibold text-link hover:underline"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <ul id={listId} role="listbox" aria-label={label} className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                  {flat.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-muted">{q ? `No model matches “${q}”.` : "No model matches these filters."}</li>
                  ) : null}
                  {groups.map((g) => (
                    <li key={g.name} role="presentation">
                      <p className="sticky top-0 z-[1] flex items-baseline justify-between bg-elevated/95 px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase backdrop-blur">
                        <span className={cn(g.name.startsWith("Private test") && "text-orange-on-dark")}>{g.name}</span>
                        <span className="font-normal tabular">{g.items.length}</span>
                      </p>
                      <ul role="presentation">
                        {g.items.map((m) => {
                          const i = flat.indexOf(m);
                          const selected = m.id === value?.id;
                          const caps = capabilitySummary(m);
                          const from = fromCredits(m);
                          return (
                            <li key={m.id} role="presentation">
                              <div
                                id={`${listId}-${m.id}`}
                                role="option"
                                aria-selected={selected}
                                onClick={() => choose(m)}
                                onMouseEnter={() => setActive(i)}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2",
                                  i === active ? "bg-white/[0.07]" : "",
                                  selected ? "ring-1 ring-brand-blue-bright/60 ring-inset" : "",
                                )}
                              >
                                <ModelLogo model={m} />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-start justify-between gap-2">
                                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-semibold text-ink">
                                      <span className="truncate">{m.name}</span>
                                      {m.state === "experimental" ? <span className="rounded-full bg-[rgb(169_180_255/0.16)] px-1.5 py-px text-[10px] font-bold text-link">BETA</span> : null}
                                      {(m.badges ?? []).includes("recommended") ? <span className="rounded-full bg-brand-blue px-1.5 py-px text-[10px] font-bold text-white">TOP</span> : null}
                                    </span>
                                    {from !== null && !m.privateTest ? (
                                      <span className="shrink-0 pt-px text-[11px] whitespace-nowrap text-muted tabular">From {fmtNum(from)} cr</span>
                                    ) : null}
                                  </span>
                                  {caps.length ? (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {caps.map((c) => (
                                        <span key={c} className="rounded-md bg-white/[0.08] px-1.5 py-px text-[11px] text-ink">
                                          {c}
                                        </span>
                                      ))}
                                    </span>
                                  ) : null}
                                  {m.purpose ? <span className="mt-1 line-clamp-2 block text-xs text-muted">{m.purpose}</span> : null}
                                </span>
                                {selected ? <Check aria-hidden className="mt-1 size-4 shrink-0 text-brand-blue-bright" /> : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                  {unavailable.length && !q && !filtersOn ? (
                    <li role="presentation">
                      <p className="mt-2 px-3 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Temporarily unavailable</p>
                      <ul role="presentation">
                        {unavailable.map((m) => (
                          <li key={m.id} role="presentation" className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 opacity-60">
                            <ModelLogo model={m} />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-semibold text-ink">
                                {m.name} <span className="sr-only">(temporarily unavailable)</span>
                              </span>
                              <span className="block text-xs text-muted">{m.note ?? "Back soon. Your other models work as usual."}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ) : null}
                </ul>
                <p className="shrink-0 border-t border-white/[0.08] px-3 py-1.5 text-[11px] text-subtle">
                  “From” is the lowest price of a model in credits; the price for your settings appears before you generate.
                </p>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Compact filter inside the picker (a small chip that opens the shared dark select). */
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span data-filter="">
      <SelectMenu
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        minWidth={200}
        className={cn(
          "flex h-7 items-center gap-1 rounded-lg border px-2 text-[12px] font-semibold transition-colors",
          value === ALL ? "border-white/[0.08] bg-white/[0.04] text-muted hover:text-ink" : "border-brand-blue-bright/60 bg-[rgb(37_63_246/0.18)] text-ink",
        )}
      >
        {(selected, isOpen) => (
          <>
            <span className="max-w-[150px] truncate">{selected?.label ?? label}</span>
            <ChevronDown aria-hidden className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-180")} />
          </>
        )}
      </SelectMenu>
    </span>
  );
}
