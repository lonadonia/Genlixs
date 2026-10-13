import type { Metadata } from "next";
import { Billing } from "@/components/studio/billing";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return <Billing />;
}
