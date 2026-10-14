import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { ModelsPage } from "@/components/live/admin/catalog/models-page";

export const metadata: Metadata = { title: "Models" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return <ModelsPage />;
}
