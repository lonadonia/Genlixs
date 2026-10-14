import type { Metadata } from "next";
import { Suspense } from "react";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { PricingPage } from "@/components/live/admin/catalog/pricing-page";

export const metadata: Metadata = { title: "Pricing & packages" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return (
    <Suspense>
      <PricingPage />
    </Suspense>
  );
}
