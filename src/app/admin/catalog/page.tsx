import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveAdminCatalog, LiveOnlyNotice } from "@/components/live/admin/live-admin";

export const metadata: Metadata = { title: "Models, prices and terms" };

export default function Page() {
  return LIVE ? <LiveAdminCatalog /> : <LiveOnlyNotice />;
}
