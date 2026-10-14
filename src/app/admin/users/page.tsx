import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminUsers, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Customers" };

export default function Page() {
  return LIVE ? <LiveAdminUsers /> : <LiveOnlyNotice />;
}
