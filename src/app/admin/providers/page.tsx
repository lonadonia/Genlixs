import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { ProvidersPage } from "@/components/live/admin/providers/providers-page";

export const metadata: Metadata = { title: "Providers & routing" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return <ProvidersPage />;
}
