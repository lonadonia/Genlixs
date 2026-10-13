"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Banknote, FolderDown, LayoutDashboard, Link2, LifeBuoy, Settings, Users, Wallet } from "lucide-react";
import { ConsoleShell, type NavGroup } from "@/components/console/console-shell";
import { PARTNER } from "@/lib/admin-data";

const GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/partner", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/partner/links", label: "Links", icon: Link2 },
      { href: "/partner/referrals", label: "Referrals", icon: Users },
      { href: "/partner/commissions", label: "Commissions", icon: Wallet },
      { href: "/partner/payouts", label: "Payouts", icon: Banknote },
      { href: "/partner/resources", label: "Resources", icon: FolderDown },
      { href: "/partner/settings", label: "Settings", icon: Settings },
      { href: "/studio/support", label: "Support", icon: LifeBuoy },
    ],
  },
];

export function PartnerChrome({ children }: { children: ReactNode }) {
  const badge = (
    <div className="rounded-[12px] border border-line bg-surface p-3 text-xs">
      <p className="font-semibold text-ink">{PARTNER.name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-brand-lime">
        <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" /> Approved partner
      </p>
    </div>
  );
  const topbar = (
    <>
      <p className="hidden text-base font-semibold text-ink-dark sm:block">Partner portal</p>
      <div role="group" aria-label="Workspace" className="ml-auto flex items-center rounded-[var(--radius-control)] border border-rule bg-paper p-1 text-sm">
        <Link href="/studio" className="rounded-[8px] px-3 py-1.5 font-medium text-muted-dark hover:text-ink-dark">
          Customer studio
        </Link>
        <span aria-current="true" className="rounded-[8px] bg-sheet px-3 py-1.5 font-semibold text-ink-dark shadow-[var(--shadow-lift)]">
          Partner portal
        </span>
      </div>
    </>
  );
  return (
    <ConsoleShell groups={GROUPS} label="Partner" badge={badge} topbar={topbar}>
      {children}
    </ConsoleShell>
  );
}
