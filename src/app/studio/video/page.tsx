import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";

export const metadata: Metadata = { title: "Video studio" };

export default function VideoStudioPage() {
  return <Workspace tool="video" />;
}
