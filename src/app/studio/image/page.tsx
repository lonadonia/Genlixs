import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";

export const metadata: Metadata = { title: "Image studio" };

export default function ImageStudioPage() {
  return <Workspace tool="image" />;
}
