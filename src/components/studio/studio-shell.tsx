"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Clapperboard,
  Coins,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Menu,
  Receipt,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { BrandSymbol, Logo } from "@/components/brand/logo";
import { PreviewBanner, PreviewPill } from "@/components/preview-banner";
import { Button, ButtonLink } from "@/components/ui/button";
import { PHASE_LABEL, isTerminal, jobPhase, setDemo, useDemo, useNow } from "@/lib/demo-store";
import { TOOLS } from "@/lib/catalog";
import { cn, fmtNum } from "@/lib/format";

const NAV = [
  { href: "/studio", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/studio/image", label: "Image", icon: ImagePlus },
  { href: "/studio/edit", label: "Edit", icon: WandSparkles },
  { href: "/studio/video", label: "Video", icon: Clapperboard },
  { href: "/studio/library", label: "Library", icon: FolderOpen },
  { href: "/studio/credits", label: "Credits", icon: Coins },
  { href: "/studio/billing", label: "Billing", icon: Receipt },
  { href: "/studio/support", label: "Support", icon: LifeBuoy },
];

const TITLES: Record<string, string> = {
  "/studio": "Overview",
  "/studio/image": "Image studio",
  "/studio/edit": "Edit studio",
  "/studio/video": "Video studio",
  "/studio/library": "Library",
  "/studio/credits": "Credits",
  "/studio/billing": "Billing",
  "/studio/support": "Support",
};

function RailLink({ item, active, collapsed, onNavigate }: { item: (typeof NAV)[number]; active: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-11 items-center gap-3 rounded-[var(--radius-control)] text-[15px] font-medium transition-colors",
        collapsed ? "justify-center px-0" : "px-3",
        active ? "bg-[rgb(28_93_255/0.18)] text-ink" : "text-muted hover:bg-raised hover:text-ink",
      )}
    >
      {active ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-brand-blue" /> : null}
      <Icon aria-hidden className={cn("size-5 shrink-0", active && "text-link")} />
      {collapsed ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full z-50 ml-3 hidden rounded-md border border-line bg-raised px-2.5 py-1 text-sm whitespace-nowrap text-ink shadow-[var(--shadow-pop)] group-hover:block group-focus-visible:block"
        >
          {item.label}
        </span>
      ) : (
        <span>{item.label}</span>
      )}
    </Link>
  );
}

export function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const demo = useDemo();
  const now = useNow();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawer && !d.open) d.showModal();
    if (!drawer && d.open) d.close();
  }, [drawer]);

  useEffect(() => {
    if (!bell) return;
    const onDown = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) setBell(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBell(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [bell]);

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));
  const title = TITLES[pathname] ?? "Studio";
  const active = demo.jobs.filter((j) => !j.settled && !isTerminal(jobPhase(j, now)));
  const recent = demo.jobs.slice(0, 4);

  if (demo.hydrated && !demo.signedIn) {
    return (
      <>
        <PreviewBanner />
        <main id="main" className="grid min-h-[calc(100dvh-33px)] place-items-center px-4">
          <div className="w-full max-w-md rounded-[var(--radius-dialog)] border border-line bg-surface p-8 text-center">
            <Logo width={150} href="/" className="mx-auto" />
            <h1 className="mt-6 text-2xl font-semibold">Sign in to open your studio</h1>
            <p className="mt-2 text-muted">Your drafts, library and credits are tied to your account.</p>
            <div className="mt-6 grid gap-2">
              <ButtonLink href={`/sign-in?next=${encodeURIComponent(pathname)}`} size="lg">
                Sign in
              </ButtonLink>
              <Button
                variant="secondary"
                onClick={() => setDemo((s) => ({ ...s, signedIn: true, email: "demo.creator@example.com" }))}
              >
                Continue with demo account
              </Button>
            </div>
          </div>
        </main>
      </>
    );
  }

  const rail = (collapsed: boolean, onNavigate?: () => void) => (
    <nav aria-label="Studio" className="flex flex-1 flex-col gap-1">
      {NAV.map((n) => (
        <RailLink key={n.href} item={n} active={isActive(n.href, n.exact)} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <div className="flex">
        {/* Desktop rail: 232px at ≥1280, collapsed 72px at 1024–1279 */}
        <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface lg:flex lg:w-[72px] xl:w-[232px]">
          <div className="flex h-16 items-center justify-center border-b border-line xl:justify-start xl:px-3">
            <span className="hidden xl:block">
              <Logo width={150} href="/" />
            </span>
            <Link href="/" aria-label="Genlixs home" className="rounded-[var(--radius-control)] p-2 xl:hidden">
              <BrandSymbol size={30} />
            </Link>
          </div>
          <div className="scroll-thin flex flex-1 flex-col overflow-y-auto p-3">
            <div className="hidden flex-1 flex-col xl:flex">{rail(false)}</div>
            <div className="flex flex-1 flex-col xl:hidden">{rail(true)}</div>
            <div className="mt-4 border-t border-line pt-4">
              <Link
                href="/partner"
                aria-label="Switch to Partner portal"
                className="group relative flex h-11 items-center justify-center gap-3 rounded-[var(--radius-control)] text-sm font-medium text-muted hover:bg-raised hover:text-ink xl:justify-start xl:px-3"
              >
                <Users aria-hidden className="size-5 shrink-0" />
                <span className="hidden xl:inline">Partner portal</span>
              </Link>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-[rgb(11_15_26/0.92)] px-3 backdrop-blur-md sm:gap-3 sm:px-6">
            <button
              ref={menuBtn}
              type="button"
              onClick={() => setDrawer(true)}
              aria-haspopup="dialog"
              className="grid size-11 place-items-center rounded-[var(--radius-control)] border border-line-strong lg:hidden"
            >
              <Menu aria-hidden className="size-5" />
              <span className="sr-only">Open studio menu</span>
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <p className="min-w-0 truncate text-lg font-semibold">{title}</p>
              <span className="hidden sm:inline-flex">
                <PreviewPill />
              </span>
            </div>

            <div role="group" aria-label="Workspace" className="hidden items-center rounded-[var(--radius-control)] border border-line bg-surface p-1 text-sm md:flex">
              <span aria-current="true" className="rounded-[8px] bg-raised px-3 py-1.5 font-semibold text-ink">
                Customer studio
              </span>
              <Link href="/partner" className="rounded-[8px] px-3 py-1.5 font-medium text-muted hover:text-ink">
                Partner portal
              </Link>
            </div>

            <Link
              href="/studio/credits"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-semibold hover:border-line-strong"
            >
              <Coins aria-hidden className="size-4 text-brand-lime" />
              <span className="tabular">{fmtNum(demo.available)}</span>
              <span className="hidden text-muted sm:inline">credits available</span>
              <span className="sr-only sm:hidden">credits available</span>
            </Link>

            <div ref={bellRef} className="relative">
              <button
                type="button"
                onClick={() => setBell((b) => !b)}
                aria-expanded={bell}
                aria-controls="notif-panel"
                className="relative grid size-10 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised hover:text-ink"
              >
                <Bell aria-hidden className="size-5" />
                {active.length ? (
                  <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-brand-blue text-[10px] font-bold text-white">{active.length}</span>
                ) : null}
                <span className="sr-only">Notifications{active.length ? `, ${active.length} running` : ""}</span>
              </button>
              {bell ? (
                <div id="notif-panel" className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-media)] border border-line bg-raised p-2 shadow-[var(--shadow-pop)]">
                  <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">Recent jobs</p>
                  <ul>
                    {recent.map((j) => {
                      const p = jobPhase(j, now);
                      return (
                        <li key={j.id}>
                          <Link
                            href={j.settled ? `/studio/library?job=${j.id}` : TOOLS[j.tool].href}
                            onClick={() => setBell(false)}
                            className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 text-sm hover:bg-surface"
                          >
                            <span className="min-w-0 truncate">{j.title}</span>
                            <span className="shrink-0 text-xs text-muted">{j.expired ? "Expired" : PHASE_LABEL[p]}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>

            <details className="group relative">
              <summary className="grid size-10 cursor-pointer place-items-center rounded-full bg-brand-violet text-sm font-bold text-white">
                <span aria-hidden>{(demo.email || "D").slice(0, 1).toUpperCase()}</span>
                <span className="sr-only">Account menu</span>
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-64 rounded-[var(--radius-media)] border border-line bg-raised p-2 shadow-[var(--shadow-pop)]">
                <p className="truncate px-2 py-1.5 text-sm text-muted">{demo.email || "demo.creator@example.com"}</p>
                <Link href="/help" className="flex h-10 items-center rounded-[10px] px-2 text-sm hover:bg-surface">
                  Help centre
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setDemo((s) => ({ ...s, signedIn: false }));
                    router.push("/");
                  }}
                  className="flex h-10 w-full items-center gap-2 rounded-[10px] px-2 text-left text-sm hover:bg-surface"
                >
                  <LogOut aria-hidden className="size-4" /> Sign out
                </button>
              </div>
            </details>
          </header>
          <p className="border-b border-line px-4 py-1.5 text-xs text-muted sm:hidden">
            <PreviewPill /> <span className="ml-1">Nothing here is real.</span>
          </p>

          <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
            {demo.hydrated ? children : <ShellSkeleton />}
          </main>
        </div>
      </div>

      <dialog
        ref={drawerRef}
        aria-label="Studio menu"
        onClose={() => {
          setDrawer(false);
          menuBtn.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === drawerRef.current) drawerRef.current?.close();
        }}
        className="mr-auto ml-0 h-dvh max-h-dvh w-[min(20rem,100vw)] max-w-none border-r border-line bg-surface p-0 text-ink backdrop:bg-[rgb(4_10_25/0.7)]"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-line px-3">
            <Logo width={140} href="/" />
            <button type="button" onClick={() => drawerRef.current?.close()} className="grid size-11 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-raised">
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto p-3">
            {rail(false, () => setDrawer(false))}
            <div className="mt-4 grid gap-1 border-t border-line pt-4">
              <Link href="/partner" className="flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[15px] text-muted hover:bg-raised hover:text-ink">
                <Users aria-hidden className="size-5" /> Partner portal
              </Link>
              <Link href="/help" className="flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[15px] text-muted hover:bg-raised hover:text-ink">
                <LifeBuoy aria-hidden className="size-5" /> Help centre
              </Link>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="p-6" aria-busy="true" aria-label="Loading studio">
      <div className="h-8 w-56 animate-pulse-soft rounded-lg bg-raised" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse-soft rounded-[var(--radius-media)] bg-surface" />
        ))}
      </div>
    </div>
  );
}
