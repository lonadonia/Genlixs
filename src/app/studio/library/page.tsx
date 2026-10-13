import type { Metadata } from "next";
import { Suspense } from "react";
import { Library } from "@/components/studio/library";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}
