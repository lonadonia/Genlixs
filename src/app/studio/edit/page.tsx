import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";
import { LiveWorkspace } from "@/components/live/studio/live-workspace";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Edit studio" };

export default function EditStudioPage() {
  return LIVE ? <LiveWorkspace tool="edit" /> : <Workspace tool="edit" />;
}
