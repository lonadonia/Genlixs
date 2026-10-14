import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminSupport, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Support" };

export default function Page() {
  return LIVE ? <LiveAdminSupport /> : <LiveOnlyNotice />;
}
