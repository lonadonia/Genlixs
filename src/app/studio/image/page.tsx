import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";
import { LiveWorkspace } from "@/components/live/studio/live-workspace";
import { ImageModeSwitch } from "@/components/studio/image-mode-switch";
import { LIVE } from "@/lib/config";
import { imageModeOf } from "@/lib/studio-routes";

export const metadata: Metadata = { title: "Image studio" };

/** Image studio: Generate (text to image) or Edit (`?mode=edit`, formerly /studio/edit). */
export default async function ImageStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = imageModeOf((await searchParams).mode);
  if (LIVE) return <LiveWorkspace key={mode} initialMode={mode} />;
  return (
    <>
      <ImageModeSwitch mode={mode} />
      <Workspace key={mode} tool={mode} />
    </>
  );
}
