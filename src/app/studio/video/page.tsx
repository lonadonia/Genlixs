import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";
import { LiveWorkspace } from "@/components/live/studio/live-workspace";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Video studio" };

export default function VideoStudioPage() {
  return LIVE ? <LiveWorkspace tool="video" /> : <Workspace tool="video" />;
}
