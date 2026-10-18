import type { Metadata } from "next";
import { Suspense } from "react";
import { LIVE } from "@/lib/config";
import { LiveOnlyNotice } from "@/components/live/admin/live-admin";
import { ModelsPage } from "@/components/live/admin/catalog/models-page";

export const metadata: Metadata = { title: "Models & pricing" };

export default function Page() {
  if (!LIVE) return <LiveOnlyNotice />;
  return (
    <Suspense>
      <ModelsPage />
    </Suspense>
  );
}
