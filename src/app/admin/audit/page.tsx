import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminAudit, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return LIVE ? <LiveAdminAudit /> : <LiveOnlyNotice />;
}
