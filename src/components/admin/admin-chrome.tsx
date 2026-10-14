"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Banknote,
  Boxes,
  Briefcase,
  Coins,
  CreditCard,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  Search,
  ShieldCheck,
  Tag,
  Users,
  Wallet,
} from "lucide-react";
import { ConsoleShell, type NavGroup } from "@/components/console/console-shell";
import { setDemo, useDemo, type AdminRole } from "@/lib/demo-store";
import { LIVE } from "@/lib/config";
import { AccountProvider } from "@/lib/live/account";
import { LiveAdminBadge, LiveAdminGate } from "@/components/live/admin/live-admin";

/** Live console navigation: every entry is backed by an allowlisted, capability-checked API. */
const LIVE_GROUPS: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/jobs", label: "Jobs", icon: Activity },
      { href: "/admin/users", label: "Customers & credits", icon: Users },
    ],
  },
  {
    title: "Catalog",
    items: [
      { href: "/admin/catalog", label: "Models", icon: Boxes },
      { href: "/admin/pricing", label: "Pricing & packages", icon: Tag },
      { href: "/admin/kie", label: "KIE balance", icon: Gauge },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/admin/payments", label: "Payments & refunds", icon: CreditCard },
      { href: "/admin/payouts", label: "Payouts", icon: Banknote },
    ],
  },
  { title: "Partners", items: [{ href: "/admin/affiliates", label: "Partners", icon: Briefcase }] },
  {
    title: "Governance",
    items: [
      { href: "/admin/support", label: "Support", icon: LifeBuoy },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
      { href: "/admin/staff", label: "Staff", icon: ShieldCheck },
    ],
  },
];

const GROUPS: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/jobs", label: "Jobs", icon: Activity },
      { label: "Customers", icon: Users, later: true },
      { label: "Models", icon: Boxes, later: true },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Pricing", icon: Tag, later: true },
      { label: "Payments", icon: CreditCard, later: true },
      { label: "Credits", icon: Coins, later: true },
      { href: "/admin/payouts", label: "Payouts", icon: Banknote },
    ],
  },
  {
    title: "Partners",
    items: [
      { label: "Affiliates", icon: Briefcase, later: true },
      { label: "Commissions", icon: Wallet, later: true },
    ],
  },
  {
    title: "Governance",
    items: [
      { label: "Support", icon: LifeBuoy, later: true },
      { label: "Audit & reports", icon: ScrollText, later: true },
    ],
  },
];

export const ROLE_LABEL: Record<AdminRole, string> = {
  operations: "Operations admin",
  support: "Support agent",
  finance: "Finance approver",
};

export function AdminChrome({ children }: { children: ReactNode }) {
  return LIVE ? <LiveAdminChrome>{children}</LiveAdminChrome> : <DemoAdminChrome>{children}</DemoAdminChrome>;
}

function LiveAdminChrome({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ids = useId();
  const topbar = (
    <form
      role="search"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        router.push(v ? `/admin/jobs?q=${encodeURIComponent(v)}` : "/admin/jobs");
      }}
      className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1"
    >
      <label htmlFor={`${ids}-q`} className="sr-only">
        Search jobs by reference, task id or customer email
      </label>
      <div className="relative w-full max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
        <input
          id={`${ids}-q`}
          name="q"
          placeholder="Job reference, task id or customer email…"
          className="h-10 w-full rounded-[var(--radius-control)] border border-rule-strong bg-paper pr-3 pl-9 text-sm text-ink-dark placeholder:text-muted-dark"
        />
      </div>
    </form>
  );
  return (
    <AccountProvider>
      <ConsoleShell groups={LIVE_GROUPS} label="Admin" badge={<LiveAdminBadge />} topbar={topbar}>
        <LiveAdminGate>{children}</LiveAdminGate>
      </ConsoleShell>
    </AccountProvider>
  );
}

function DemoAdminChrome({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const router = useRouter();
  const [q, setQ] = useState("");
  const ids = useId();

  const search = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    router.push(v ? `/admin/jobs?q=${encodeURIComponent(v)}` : "/admin/jobs");
  };

  const badge = (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(225_255_1/0.35)] bg-[rgb(225_255_1/0.08)] px-2.5 py-1 text-xs font-semibold text-brand-lime">
      <ShieldCheck aria-hidden className="size-3.5" /> Admin · {ROLE_LABEL[demo.adminRole]}
    </p>
  );

  const topbar = (
    <>
      <form role="search" onSubmit={search} className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:flex-1">
        <label htmlFor={`${ids}-q`} className="sr-only">
          Search jobs, customers, payments
        </label>
        <div className="relative w-full max-w-md">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
          <input
            id={`${ids}-q`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search job ID, customer ID or email…"
            className="h-10 w-full rounded-[var(--radius-control)] border border-rule-strong bg-paper pr-3 pl-9 text-sm text-ink-dark placeholder:text-muted-dark"
          />
        </div>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <label htmlFor={`${ids}-role`} className="hidden text-xs font-semibold text-muted-dark xl:block">
          Prototype role
        </label>
        <select
          id={`${ids}-role`}
          value={demo.adminRole}
          onChange={(e) => setDemo((s) => ({ ...s, adminRole: e.target.value as AdminRole }))}
          className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 text-sm text-ink-dark"
          aria-label="Prototype role (changes which actions are permitted)"
        >
          {(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  return (
    <ConsoleShell groups={GROUPS} label="Admin" badge={badge} topbar={topbar}>
      {children}
    </ConsoleShell>
  );
}
