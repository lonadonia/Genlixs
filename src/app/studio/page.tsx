import type { Metadata } from "next";
import { Overview } from "@/components/studio/overview";
import { LiveOverview } from "@/components/live/studio/live-pages";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Overview" };

export default function StudioOverviewPage() {
  return LIVE ? <LiveOverview /> : <Overview />;
}
