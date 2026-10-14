import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";
import { LiveWorkspace } from "@/components/live/studio/live-workspace";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Image studio" };

export default function ImageStudioPage() {
  return LIVE ? <LiveWorkspace tool="image" /> : <Workspace tool="image" />;
}
