import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminPayments, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Payments" };

export default function Page() {
  return LIVE ? <LiveAdminPayments /> : <LiveOnlyNotice />;
}
