import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";

export const metadata: Metadata = { title: "Edit studio" };

export default function EditStudioPage() {
  return <Workspace tool="edit" />;
}
