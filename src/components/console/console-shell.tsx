"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { PreviewPill } from "@/components/preview-banner";
import { cn } from "@/lib/format";

export type NavItem = { href?: string; label: string; icon: LucideIcon; exact?: boolean; later?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

/**
 * Data-surface shell (guide §09/§10): dark brand rail with the white logo,
 * light data canvas, white panels. Shared by the admin console and partner portal.
 */
export function ConsoleShell({ groups, label, badge, topbar, children }: { groups: NavGroup[]; label: string; badge: ReactNode; topbar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const active = (i: NavItem) => Boolean(i.href) && (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));

  const nav = (onNavigate?: () => void) => (
    <nav aria-label={label} className="space-y-5">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title ? <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-[#8794ab] uppercase">{g.title}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const Icon = i.icon;
              if (!i.href || i.later)
                return (
                  <li key={i.label}>
                    <span aria-disabled="true" className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm text-[#7d8ba3]">
                      <Icon aria-hidden className="size-[18px]" />
                      <span className="flex-1">{i.label}</span>
                      <span className="text-[10px] font-semibold tracking-wide uppercase">Later</span>
                    </span>
                  </li>
                );
              const on = active(i);
              return (
                <li key={i.label}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors",
                      on ? "bg-[rgb(28_93_255/0.22)] text-white" : "text-muted hover:bg-raised hover:text-ink",
                    )}
                  >
                    {on ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-brand-blue" /> : null}
                    <Icon aria-hidden className={cn("size-[18px]", on && "text-link")} />
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="surface-light flex min-h-dvh bg-paper text-ink-dark">
      <aside className="rail-dark sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col bg-canvas text-ink lg:flex">
        <div className="flex h-16 items-center border-b border-line px-3">
          <Logo width={146} />
        </div>
        <div className="px-4 pt-4">{badge}</div>
        <div className="scroll-thin flex-1 overflow-y-auto p-3">{nav()}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-3 border-b border-rule bg-sheet/95 px-4 py-2 backdrop-blur sm:px-6">
          <button
            ref={btn}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="grid size-11 place-items-center rounded-[var(--radius-control)] border border-rule lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">Open {label} menu</span>
          </button>
          <span className="lg:hidden">
            <Logo variant="dark" width={120} />
          </span>
          <PreviewPill surface="light" />
          {topbar}
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>

      <dialog
        ref={dlg}
        aria-label={`${label} menu`}
        onClose={() => {
          setOpen(false);
          btn.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dlg.current) dlg.current?.close();
        }}
        className="rail-dark mr-auto ml-0 h-dvh max-h-dvh w-[min(20rem,100vw)] max-w-none bg-canvas p-0 text-ink backdrop:bg-[rgb(4_10_25/0.6)]"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-line px-3">
            <Logo width={136} />
            <button type="button" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised">
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <div className="px-4 pt-4">{badge}</div>
          <div className="flex-1 overflow-y-auto p-3">{nav(() => setOpen(false))}</div>
        </div>
      </dialog>
    </div>
  );
}
