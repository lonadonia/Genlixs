import type { Metadata } from "next";
import { Suspense } from "react";
import { LIVE } from "@/lib/config";
import { LiveAdminAffiliates, LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { PartnerTermsPanel } from "@/components/live/admin/admin-settings";

export const metadata: Metadata = { title: "Partners" };

export default function Page() {
  return LIVE ? (
    <Suspense>
      <LiveAdminAffiliates terms={<PartnerTermsPanel />} />
    </Suspense>
  ) : (
    <LiveOnlyNotice />
  );
}
