import type { Metadata } from "next";
import { Workspace } from "@/components/studio/workspace";
import { VideoStudio } from "@/components/live/studio/video/video-studio";
import type { DraftKey } from "@/lib/live/video-studio";
import { canvasViewOf } from "@/lib/studio-routes";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Video studio" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRAFTS: Record<string, DraftKey> = { create: "create", extend: "extend", edit: "edit", motion: "motion", avatar: "avatar" };

/**
 * Deep links: `?tab=edit|motion|extend|avatar` opens a mode, `?job=<id>` reopens a job, `?view=history|library|how` opens a
 * canvas view (How it works when none is given, History for a job or a reused file), and `?use=<assetId>&slot=<name>`
 * (from "Use as …" on a saved result) places that file into a slot once. Ownership is checked by the server.
 */
export default async function VideoStudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!LIVE) return <Workspace tool="video" />;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const draft = DRAFTS[one("tab") ?? ""] ?? "create";
  const job = one("job");
  const assetId = one("use");
  const slot = one("slot");
  const mode = one("mode");
  const use =
    assetId && UUID.test(assetId) && slot && /^[a-z0-9_]{1,40}$/.test(slot)
      ? { assetId, slot, draft, mode: mode && /^[a-z0-9_]{1,40}$/.test(mode) ? mode : null }
      : null;
  const jobId = job && UUID.test(job) ? job : null;
  return <VideoStudio initialDraft={draft} initialJobId={jobId} use={use} initialView={canvasViewOf(one("view"), jobId || use ? "history" : "how")} />;
}
