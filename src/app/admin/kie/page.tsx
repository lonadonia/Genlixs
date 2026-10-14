import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { KieBalancePage } from "@/components/live/admin/catalog/provider";

export const metadata: Metadata = { title: "KIE balance" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return <KieBalancePage />;
}
