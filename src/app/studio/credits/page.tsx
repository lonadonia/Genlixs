import type { Metadata } from "next";
import { Suspense } from "react";
import { Credits } from "@/components/studio/credits";

export const metadata: Metadata = { title: "Credits" };

export default function CreditsPage() {
  return (
    <Suspense>
      <Credits />
    </Suspense>
  );
}
