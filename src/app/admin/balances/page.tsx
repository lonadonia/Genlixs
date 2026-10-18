import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { BalancesPage } from "@/components/live/admin/catalog/balances-page";

export const metadata: Metadata = { title: "Supplier balances" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return <BalancesPage />;
}
