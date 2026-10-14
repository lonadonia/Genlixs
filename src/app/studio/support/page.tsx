import type { Metadata } from "next";
import { Support } from "@/components/studio/support";
import { LiveSupport } from "@/components/live/studio/live-pages";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return LIVE ? <LiveSupport /> : <Support />;
}
