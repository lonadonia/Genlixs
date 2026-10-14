import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminStaff, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Staff" };

export default function Page() {
  return LIVE ? <LiveAdminStaff /> : <LiveOnlyNotice />;
}
