"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Banknote, FolderDown, LayoutDashboard, Link2, LifeBuoy, Settings, Users, Wallet } from "lucide-react";
import { ConsoleShell, type NavGroup } from "@/components/console/console-shell";
import { PARTNER } from "@/lib/admin-data";
import { LIVE } from "@/lib/config";
import { AccountProvider } from "@/lib/live/account";
import { LivePartnerBadge, LivePartnerGate } from "@/components/live/partner/live-partner";

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
    <div className="rounded-xl border border-line bg-surface p-3 text-xs">
      <p className="font-semibold text-ink">{PARTNER.name}</p>
      {/* Lime text on the night rail: 15.6:1. */}
      <p className="mt-0.5 flex items-center gap-1.5 font-semibold text-brand-lime">
        <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" /> Approved partner
      </p>
    </div>
  );
  const topbar = (
    <>
      <p className="hidden text-base font-semibold text-ink-dark sm:block">Partner portal</p>
      <div role="group" aria-label="Workspace" className="ml-auto flex items-center rounded-full border border-rule bg-paper p-1 text-sm">
        <Link href="/studio" className="rounded-full px-3.5 py-1.5 font-medium text-muted-dark transition-colors hover:text-ink-dark">
          Customer studio
        </Link>
        <span aria-current="true" className="rounded-full bg-sheet px-3.5 py-1.5 font-semibold text-ink-dark shadow-[0_1px_2px_rgb(15_18_18/0.08),0_2px_8px_-2px_rgb(15_18_18/0.12)] ring-1 ring-rule">
          Partner portal
        </span>
      </div>
    </>
  );
  if (LIVE) {
    return (
      <AccountProvider>
        <ConsoleShell groups={GROUPS} label="Partner" badge={<LivePartnerBadge />} topbar={topbar}>
          <LivePartnerGate>{children}</LivePartnerGate>
        </ConsoleShell>
      </AccountProvider>
    );
  }
  return (
    <ConsoleShell groups={GROUPS} label="Partner" badge={badge} topbar={topbar}>
      {children}
    </ConsoleShell>
  );
}
