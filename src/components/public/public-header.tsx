"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { useDemo } from "@/lib/demo-store";

const NAV = [
  { href: "/#tools", label: "Tools" },
  { href: "/#examples", label: "Examples" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#partners", label: "Partners" },
  { href: "/help", label: "Help" },
];

export function PublicHeader() {
  const { signedIn, hydrated } = useDemo();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const authed = hydrated && signedIn;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-[rgb(11_15_26/0.88)] backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1360px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <span className="-ml-2 hidden shrink-0 sm:block">
          <Logo width={168} priority />
        </span>
        <span className="-ml-2 shrink-0 sm:hidden">
          <Logo width={136} priority />
        </span>
        <nav aria-label="Main" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="inline-flex h-10 items-center rounded-[var(--radius-control)] px-3 text-[15px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {authed ? (
            <span className="hidden sm:block">
              <ButtonLink href="/studio" variant="secondary">
                Open studio
              </ButtonLink>
            </span>
          ) : (
            <Link
              href="/sign-in"
              className="hidden h-11 items-center rounded-[var(--radius-control)] px-3 text-[15px] font-semibold text-ink hover:bg-raised sm:inline-flex"
            >
              Sign in
            </Link>
          )}
          <ButtonLink href="/#create">Create</ButtonLink>
          <button
            ref={trigger}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="grid size-11 place-items-center rounded-[var(--radius-control)] border border-line-strong text-ink lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">Open menu</span>
          </button>
        </div>
      </div>

      <dialog
        ref={dialog}
        aria-label="Menu"
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="ml-auto mr-0 h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none border-l border-line bg-surface p-0 text-ink backdrop:bg-[rgb(4_10_25/0.7)]"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[72px] items-center justify-between border-b border-line px-4">
            <Logo width={136} href={null} />
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="grid size-11 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink"
            >
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
            <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Create</p>
            <ul className="mb-4">
              {[
                { href: "/studio/image", label: "Create an image" },
                { href: "/studio/edit", label: "Edit an image" },
                { href: "/studio/video", label: "Create a short video" },
              ].map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => dialog.current?.close()}
                    className="flex h-12 items-center rounded-[var(--radius-control)] px-3 text-base font-medium hover:bg-raised"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Explore</p>
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={() => dialog.current?.close()}
                    className="flex h-12 items-center rounded-[var(--radius-control)] px-3 text-base font-medium hover:bg-raised"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="grid gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {authed ? (
              <ButtonLink href="/studio" variant="secondary" onClick={() => dialog.current?.close()}>
                Open studio
              </ButtonLink>
            ) : (
              <ButtonLink href="/sign-in" variant="secondary" onClick={() => dialog.current?.close()}>
                Sign in
              </ButtonLink>
            )}
            <ButtonLink href="/#create" onClick={() => dialog.current?.close()}>
              Create
            </ButtonLink>
          </div>
        </div>
      </dialog>
    </header>
  );
}
