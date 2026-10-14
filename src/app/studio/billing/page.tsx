import type { Metadata } from "next";
import { Suspense } from "react";
import { Billing } from "@/components/studio/billing";
import { LiveBilling } from "@/components/live/studio/live-pages";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return LIVE ? (
    <Suspense>
      <LiveBilling />
    </Suspense>
  ) : (
    <Billing />
  );
}
