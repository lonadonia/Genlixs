import type { Metadata } from "next";
import { Suspense } from "react";
import { Credits } from "@/components/studio/credits";
import { LiveCredits } from "@/components/live/studio/live-pages";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Credits" };

export default function CreditsPage() {
  return <Suspense>{LIVE ? <LiveCredits /> : <Credits />}</Suspense>;
}
