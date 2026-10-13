import type { Metadata } from "next";
import { Overview } from "@/components/studio/overview";

export const metadata: Metadata = { title: "Overview" };

export default function StudioOverviewPage() {
  return <Overview />;
}
