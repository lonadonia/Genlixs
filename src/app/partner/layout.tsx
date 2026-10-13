import type { Metadata } from "next";
import { PartnerChrome } from "@/components/partner/partner-chrome";

export const metadata: Metadata = { title: { default: "Partner portal", template: "%s · Genlixs partners" } };

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return <PartnerChrome>{children}</PartnerChrome>;
}
