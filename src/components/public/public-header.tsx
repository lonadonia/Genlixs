"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
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
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[rgb(15_18_18/0.72)] backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <span className="-ml-1.5 hidden shrink-0 sm:block">
          <Logo width={150} priority />
        </span>
        <span className="-ml-1.5 shrink-0 sm:hidden">
          <Logo width={128} priority />
        </span>
        <nav aria-label="Main" className="hidden flex-1 justify-center lg:flex">
          <ul className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className="inline-flex h-9 items-center rounded-full px-4 text-[15px] font-medium text-muted transition-colors hover:bg-white/[0.07] hover:text-ink"
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
            <Link href="/sign-in" className="hidden h-11 items-center rounded-full px-4 text-[15px] font-semibold text-ink hover:bg-white/[0.07] sm:inline-flex">
              Sign in
            </Link>
          )}
          <ButtonLink href="/#create" icon={<ArrowUpRight aria-hidden className="order-last size-4" />}>
            Create
          </ButtonLink>
          <button
            ref={trigger}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className="grid size-11 place-items-center rounded-full border border-white/20 text-ink lg:hidden"
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
        className="mr-0 ml-auto h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none border-l border-white/10 bg-surface p-0 text-ink backdrop:bg-[rgb(8_10_10/0.75)]"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[76px] items-center justify-between border-b border-white/[0.08] px-4">
            <Logo width={128} href={null} />
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="grid size-11 place-items-center rounded-full text-muted hover:bg-white/[0.07] hover:text-ink"
            >
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
            <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-subtle uppercase">Create</p>
            <ul className="mb-4">
              {[
                { href: "/studio/image", label: "Create an image" },
                { href: "/studio/edit", label: "Edit an image" },
                { href: "/studio/video", label: "Create a short video" },
              ].map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={() => dialog.current?.close()} className="flex h-12 items-center rounded-2xl px-3 text-base font-medium hover:bg-white/[0.06]">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="px-3 pb-2 text-xs font-semibold tracking-wider text-subtle uppercase">Explore</p>
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={() => dialog.current?.close()} className="flex h-12 items-center rounded-2xl px-3 text-base font-medium hover:bg-white/[0.06]">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="grid gap-2 border-t border-white/[0.08] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
