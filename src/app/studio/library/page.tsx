import type { Metadata } from "next";
import { Suspense } from "react";
import { Library } from "@/components/studio/library";
import { LiveLibrary } from "@/components/live/studio/live-pages";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return <Suspense>{LIVE ? <LiveLibrary /> : <Library />}</Suspense>;
}
