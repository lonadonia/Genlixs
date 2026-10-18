"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/format";

export type SelectOption<T extends string | number> = { value: T; label: string; hint?: string };

const GAP = 6;
/** Clock read for typeahead (event handlers only, kept out of render). */
const clock = () => Date.now();
const MAX_H = 288;

/**
 * Dark-theme select: a button that opens a listbox popover (rendered in a portal, so scrolling panels never clip it).
 * Keyboard: Enter/Space/↓/↑ open; arrows, Home/End and typing move; Enter/Space choose; Escape/Tab close and return
 * focus to the button. Replaces the native select whose white system popup did not fit the studio.
 */
export function SelectMenu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  children,
  className,
  disabled,
  align = "start",
  minWidth = 160,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  /** Trigger content; receives the selected option. */
  children: (selected: SelectOption<T> | undefined, open: boolean) => ReactNode;
  className?: string;
  disabled?: boolean;
  align?: "start" | "end";
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((o) => String(o.value) === String(value)));
  const selected = options[selectedIndex];
  const fixed = disabled || options.length < 2;

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, minWidth);
    const room = window.innerHeight - r.bottom;
    const up = room < Math.min(MAX_H, options.length * 40 + 12) + GAP && r.top > room;
    let left = align === "end" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: up ? r.top - GAP : r.bottom + GAP, left, width, up });
  };

  const openMenu = () => {
    if (fixed) return;
    setActive(selectedIndex);
    place();
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    list.current?.focus();
    list.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    const onScroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      place();
    };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listeners only depend on the open state
  }, [open]);

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(last, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1) {
      const now = clock();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup={fixed ? undefined : "listbox"}
        aria-expanded={fixed ? undefined : open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-disabled={fixed || undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={cn(fixed ? "cursor-default" : "cursor-pointer", className)}
      >
        {children(selected, open)}
      </button>
      {open && pos
        ? createPortal(
            <ul
              ref={list}
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              tabIndex={-1}
              aria-activedescendant={`${id}-o-${active}`}
              onKeyDown={onListKey}
              style={{ left: pos.left, minWidth: pos.width, maxHeight: MAX_H, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
              className="studio-ui fixed z-[60] overflow-y-auto rounded-xl border border-white/[0.09] bg-elevated p-1 text-sm shadow-[var(--shadow-pop)] outline-none scroll-none"
            >
              {options.map((o, i) => {
                const on = i === selectedIndex;
                return (
                  <li
                    key={String(o.value)}
                    id={`${id}-o-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={cn(
                      "flex h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5",
                      i === active ? "bg-white/[0.08] text-ink" : "text-muted",
                      on && "text-ink",
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{o.label}</span>
                      {o.hint ? <span className="truncate text-xs text-subtle">{o.hint}</span> : null}
                    </span>
                    {on ? <Check aria-hidden className="size-4 shrink-0 text-brand-blue-bright" /> : null}
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </>
  );
}
