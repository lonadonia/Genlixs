"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  CircleHelp,
  Clapperboard,
  Coins,
  FolderOpen,
  House,
  ImagePlus,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  Receipt,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandSymbol, Logo } from "@/components/brand/logo";
import { PreviewBanner, PreviewPill } from "@/components/preview-banner";
import { Button, ButtonLink } from "@/components/ui/button";
import { PHASE_LABEL, isTerminal, jobPhase, setDemo, useDemo, useNow } from "@/lib/demo-store";
import { TOOLS } from "@/lib/catalog";
import { cn, fmtNum } from "@/lib/format";
import { LIVE } from "@/lib/config";
import { AccountProvider, useAccount } from "@/lib/live/account";
import { units } from "@/lib/live/types";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

/* Grouped like a creative app: make things, find them again, manage the account (guide §06). */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Create",
    items: [
      { href: "/studio", label: "Home", icon: House, exact: true },
      { href: "/studio/image", label: "Image", icon: ImagePlus },
      { href: "/studio/video", label: "Video", icon: Clapperboard },
    ],
  },
  { title: "Your work", items: [{ href: "/studio/library", label: "Library", icon: FolderOpen }] },
  {
    title: "Account",
    items: [
      { href: "/studio/credits", label: "Credits", icon: Coins },
      { href: "/studio/billing", label: "Billing", icon: Receipt },
      { href: "/studio/support", label: "Support", icon: LifeBuoy },
    ],
  },
];

const FOOTER_LINKS: Item[] = [
  { href: "/partner", label: "Partner portal", icon: Users },
  { href: "/help", label: "Help centre", icon: CircleHelp },
  { href: "/status", label: "Service status", icon: Activity },
];

const TITLES: Record<string, string> = {
  "/studio": "Home",
  "/studio/image": "Image studio",
  "/studio/video": "Video studio",
  "/studio/library": "Library",
  "/studio/credits": "Credits",
  "/studio/billing": "Billing",
  "/studio/support": "Support",
};

function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full z-50 ml-3 hidden rounded-lg border border-white/10 bg-elevated px-2.5 py-1 text-sm whitespace-nowrap text-ink shadow-[var(--shadow-pop)] group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

function RailLink({ item, active, collapsed, onNavigate }: { item: Item; active: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-2.5 rounded-[10px] text-sm font-medium transition-colors",
        collapsed ? "justify-center px-0" : "px-1.5",
        active ? "bg-[rgb(37_63_246/0.14)] text-ink ring-1 ring-[rgb(81_101_248/0.38)] ring-inset" : "text-muted hover:bg-white/[0.04] hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
          active ? "bg-brand-blue text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.25)]" : "bg-white/[0.05] group-hover:bg-white/[0.08]",
        )}
      >
        <Icon className="size-4" />
      </span>
      {collapsed ? <Tip>{item.label}</Tip> : <span>{item.label}</span>}
    </Link>
  );
}

/** What the frame needs from either the design preview store or the live account. */
type ShellView = {
  live: boolean;
  hydrated: boolean;
  signedIn: boolean;
  email: string;
  available: number;
  reserved: number;
  restricted: boolean;
  bellTitle: string;
  bellCount: number;
  bellItems: { key: string; title: string; label: string; href: string }[];
  onSignOut: () => void | Promise<void>;
  onDemoSignIn?: () => void;
};

export function StudioShell({ children }: { children: ReactNode }) {
  return LIVE ? (
    <AccountProvider>
      <LiveShell>{children}</LiveShell>
    </AccountProvider>
  ) : (
    <DemoShell>{children}</DemoShell>
  );
}

function DemoShell({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const now = useNow();
  const active = demo.jobs.filter((j) => !j.settled && !isTerminal(jobPhase(j, now)));
  const view: ShellView = {
    live: false,
    hydrated: demo.hydrated,
    signedIn: demo.signedIn,
    email: demo.email || "demo.creator@example.com",
    available: demo.available,
    reserved: demo.reserved,
    restricted: false,
    bellTitle: "Recent jobs",
    bellCount: active.length,
    bellItems: demo.jobs.slice(0, 4).map((j) => ({
      key: j.id,
      title: j.title,
      label: j.expired ? "Expired" : PHASE_LABEL[jobPhase(j, now)],
      href: j.settled ? `/studio/library?job=${j.id}` : TOOLS[j.tool].href,
    })),
    onSignOut: () => setDemo((s) => ({ ...s, signedIn: false })),
    onDemoSignIn: () => setDemo((s) => ({ ...s, signedIn: true, email: "demo.creator@example.com" })),
  };
  return <ShellFrame view={view}>{children}</ShellFrame>;
}

function LiveShell({ children }: { children: ReactNode }) {
  const acct = useAccount();
  const view: ShellView = {
    live: true,
    hydrated: acct.hydrated,
    signedIn: Boolean(acct.me),
    email: acct.me?.email ?? "",
    available: units(acct.wallet?.availableUnits),
    reserved: units(acct.wallet?.reservedUnits),
    restricted: acct.me?.accountStatus === "suspended",
    bellTitle: "Notifications",
    bellCount: acct.unread,
    bellItems: acct.notifications.slice(0, 6).map((n) => ({
      key: n.id,
      title: n.title,
      label: n.read_at ? "" : "New",
      href: n.link && n.link.startsWith("/") ? n.link : "/studio",
    })),
    onSignOut: acct.signOut,
  };
  return <ShellFrame view={view}>{children}</ShellFrame>;
}

function ShellFrame({ view, children }: { view: ShellView; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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

  if (view.hydrated && !view.signedIn) {
    return (
      <>
        {view.live ? null : <PreviewBanner />}
        <main id="main" className="relative isolate grid min-h-[calc(100dvh-36px)] place-items-center overflow-hidden px-4">
          <div aria-hidden className="glow-electric pointer-events-none absolute top-1/4 left-1/2 -z-10 h-[420px] w-[min(900px,100%)] -translate-x-1/2" />
          <div className="console-frame w-full max-w-md p-8 text-center">
            <Logo width={150} href="/" className="mx-auto" />
            <h1 className="font-display mt-7 text-2xl font-extrabold">Sign in to open your studio</h1>
            <p className="mt-2 text-muted">Your drafts, library and credits are tied to your account.</p>
            <div className="mt-7 grid gap-2">
              <ButtonLink href={`/sign-in?next=${encodeURIComponent(pathname)}`} size="lg">
                Sign in
              </ButtonLink>
              {view.onDemoSignIn ? (
                <Button variant="secondary" size="lg" onClick={view.onDemoSignIn}>
                  Continue with demo account
                </Button>
              ) : (
                <ButtonLink href={`/sign-in?mode=sign-up&next=${encodeURIComponent(pathname)}`} variant="secondary" size="lg">
                  Create an account
                </ButtonLink>
              )}
            </div>
          </div>
        </main>
      </>
    );
  }

  const nav = (collapsed: boolean, onNavigate?: () => void) => (
    <nav aria-label="Studio" className="flex flex-col gap-4">
      {GROUPS.map((g, gi) => (
        <div key={g.title}>
          {collapsed ? (
            gi > 0 ? <span aria-hidden className="mx-auto mb-2 block h-px w-6 bg-white/10" /> : null
          ) : (
            <p className="px-2 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-subtle uppercase">{g.title}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((n) => (
              <li key={n.href}>
                <RailLink item={n} active={isActive(n.href, n.exact)} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const initial = (view.email || "D").slice(0, 1).toUpperCase();

  return (
    <div className="studio-ui min-h-dvh">
      {/* Floating rail: 236 px at ≥1280, 72 px icon rail with tooltips at 1024–1279, drawer below 1024 */}
      <aside className="fixed inset-y-3 left-3 z-40 hidden w-[64px] flex-col rounded-[20px] border border-white/[0.07] bg-surface lg:flex xl:w-[212px]">
        <div className="flex h-[60px] shrink-0 items-center justify-center px-2.5 xl:justify-start xl:px-3.5">
          <span className="hidden xl:block">
            <Logo width={128} href="/" priority />
          </span>
          <Link href="/" aria-label="Genlixs home" className="rounded-xl p-1.5 xl:hidden">
            <BrandSymbol size={28} />
          </Link>
        </div>

        <div className="scroll-none flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-2.5">
          <Link
            href="/studio"
            className="group relative mb-4 flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-blue text-sm font-semibold text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.22),0_8px_22px_-12px_rgb(37_63_246/0.9)] transition-colors hover:bg-brand-blue-hover xl:justify-start xl:px-3"
            aria-label="New creation"
          >
            <Plus aria-hidden className="size-[18px]" />
            <span className="hidden xl:inline">New creation</span>
            <span className="xl:hidden">
              <Tip>New creation</Tip>
            </span>
          </Link>
          <div className="hidden xl:block">{nav(false)}</div>
          <div className="xl:hidden">{nav(true)}</div>

          {/* Balance card (expanded rail only); the header keeps the balance visible at every width. */}
          <div className="mt-auto hidden pt-5 xl:block">
            <div className="rounded-[14px] border border-white/[0.07] bg-[radial-gradient(120%_90%_at_0%_0%,rgb(37_63_246/0.32),transparent_70%)] bg-raised p-3.5">
              <p className="text-xs font-medium text-muted">Available credits</p>
              <p className="font-display mt-0.5 text-xl font-extrabold text-ink tabular">{fmtNum(view.available)}</p>
              {view.reserved ? <p className="text-xs text-muted tabular">{fmtNum(view.reserved)} reserved for running jobs</p> : null}
              <Link href="/studio/credits" className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-brand-night shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)] hover:bg-white/90">
                <Coins aria-hidden className="size-4" /> Top up
              </Link>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-center gap-1 border-t border-white/[0.07] p-2 max-xl:flex-col">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-label={l.label} className="group relative grid size-9 place-items-center rounded-[10px] text-muted hover:bg-white/[0.06] hover:text-ink">
              <l.icon aria-hidden className="size-[18px]" />
              <Tip>{l.label}</Tip>
            </Link>
          ))}
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-[84px] xl:pl-[236px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-[rgb(15_18_18/0.82)] px-3 backdrop-blur-xl sm:gap-2.5 sm:px-5 lg:h-[60px] lg:pl-2">
          <button
            ref={menuBtn}
            type="button"
            onClick={() => setDrawer(true)}
            aria-haspopup="dialog"
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/[0.03] lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
            <span className="sr-only">Open studio menu</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <p className="min-w-0 truncate text-base font-semibold">{title}</p>
            {view.live ? null : (
              <span className="hidden sm:inline-flex">
                <PreviewPill />
              </span>
            )}
          </div>

          <div role="group" aria-label="Workspace" className="hidden items-center rounded-xl border border-white/[0.08] bg-white/[0.03] p-[3px] text-[13px] md:flex">
            <span aria-current="true" className="rounded-[9px] bg-brand-blue px-3 py-1.5 font-semibold text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.25)]">
              Customer studio
            </span>
            <Link href="/partner" className="rounded-[9px] px-3 py-1.5 font-medium text-muted hover:text-ink">
              Partner portal
            </Link>
          </div>

          <Link
            href="/studio/credits"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] font-semibold hover:border-white/25"
          >
            <Coins aria-hidden className="size-4 text-brand-blue-bright" />
            <span className="tabular">{fmtNum(view.available)}</span>
            <span className="hidden text-muted xl:inline">credits available</span>
            <span className="sr-only xl:hidden">credits available</span>
          </Link>
          <span className="hidden sm:inline-flex">
            <ButtonLink href="/studio/credits" size="sm">
              Top up
            </ButtonLink>
          </span>

          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={() => setBell((b) => !b)}
              aria-expanded={bell}
              aria-controls="notif-panel"
              className="relative grid size-9 place-items-center rounded-xl text-muted hover:bg-white/[0.06] hover:text-ink"
            >
              <Bell aria-hidden className="size-5" />
              {view.bellCount ? (
                <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-brand-blue text-[10px] font-bold text-white">{Math.min(view.bellCount, 9)}</span>
              ) : null}
              <span className="sr-only">
                Notifications{view.bellCount ? `, ${view.bellCount} ${view.live ? "unread" : "running"}` : ""}
              </span>
            </button>
            {bell ? (
              <div id="notif-panel" className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-elevated p-2 shadow-[var(--shadow-pop)]">
                <p className="px-2 pt-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">{view.bellTitle}</p>
                {view.bellItems.length ? (
                  <ul>
                    {view.bellItems.map((j) => (
                      <li key={j.key}>
                        <Link
                          href={j.href}
                          onClick={() => setBell(false)}
                          className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.05]"
                        >
                          <span className="min-w-0 truncate">{j.title}</span>
                          {j.label ? <span className="shrink-0 text-xs text-muted">{j.label}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 pb-2 text-sm text-muted">Nothing new yet.</p>
                )}
              </div>
            ) : null}
          </div>

          <details className="group relative">
            <summary className="grid size-9 cursor-pointer place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-brand-lime),#9ecbff_55%,var(--color-brand-blue))] p-[2px]">
              <span className="grid size-full place-items-center rounded-full bg-brand-night text-sm font-bold text-ink">
                <span aria-hidden>{initial}</span>
              </span>
              <span className="sr-only">Account menu</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-white/10 bg-elevated p-2 shadow-[var(--shadow-pop)]">
              <p className="truncate px-2 py-1.5 text-sm text-muted">{view.email}</p>
              <Link href="/studio/billing" className="flex h-10 items-center rounded-xl px-2 text-sm hover:bg-white/[0.05]">
                Plan and billing
              </Link>
              <Link href="/help" className="flex h-10 items-center rounded-xl px-2 text-sm hover:bg-white/[0.05]">
                Help centre
              </Link>
              <button
                type="button"
                onClick={async () => {
                  await view.onSignOut();
                  router.push("/");
                }}
                className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-white/[0.05]"
              >
                <LogOut aria-hidden className="size-4" /> Sign out
              </button>
            </div>
          </details>
        </header>
        {view.live ? null : (
          <p className="px-4 pb-2 text-xs text-muted sm:hidden">
            <PreviewPill /> <span className="ml-1">Nothing here is real.</span>
          </p>
        )}
        {view.restricted ? (
          <p role="alert" className="mx-4 mb-2 rounded-xl border border-[rgb(255_181_71/0.35)] bg-[rgb(255_181_71/0.08)] px-3 py-2 text-sm text-orange-on-dark sm:mx-6">
            Your account is restricted. New generations and purchases are paused — contact support for details.
          </p>
        ) : null}

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {view.hydrated ? children : <ShellSkeleton />}
        </main>
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
        className="mr-auto ml-0 h-dvh max-h-dvh w-[min(20rem,100vw)] max-w-none rounded-r-[24px] border-r border-white/[0.07] bg-surface p-0 text-ink"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-3">
            <Logo width={136} href="/" />
            <button type="button" onClick={() => drawerRef.current?.close()} className="grid size-11 place-items-center rounded-full text-muted hover:bg-white/[0.06]">
              <X aria-hidden className="size-5" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto p-3">
            <div className="mb-4 rounded-2xl border border-white/[0.08] bg-raised p-4">
              <p className="text-xs text-muted">Available credits</p>
              <p className="font-display text-2xl font-extrabold tabular">{fmtNum(view.available)}</p>
            </div>
            {nav(false, () => setDrawer(false))}
            <div className="mt-5 grid gap-0.5 border-t border-white/[0.07] pt-4">
              {FOOTER_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setDrawer(false)}
                  className="flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] text-muted hover:bg-white/[0.04] hover:text-ink"
                >
                  <l.icon aria-hidden className="size-5" /> {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="p-6" role="status" aria-busy="true" aria-label="Loading studio">
      <div className="mx-auto h-10 w-80 max-w-full animate-pulse-soft rounded-xl bg-raised" />
      <div className="mx-auto mt-8 h-48 max-w-[860px] animate-pulse-soft rounded-[28px] bg-surface" />
    </div>
  );
}
