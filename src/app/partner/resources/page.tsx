import type { Metadata } from "next";
import Image from "next/image";
import { Download } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";

export const metadata: Metadata = { title: "Resources" };

const LOGOS = [
  { file: "/brand/genlixs-logo-white-960.png", name: "Logo — white wordmark (PNG, 960 px)", bg: "bg-canvas", use: "Dark backgrounds" },
  { file: "/brand/genlixs-logo-dark-960.png", name: "Logo — dark wordmark (PNG, 960 px)", bg: "bg-paper", use: "Light backgrounds" },
  { file: "/brand/genlixs-symbol-512.png", name: "Symbol only (PNG, 512 px)", bg: "bg-paper", use: "Avatars and small spaces" },
];

export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead title="Resources" sub="Supplied Genlixs logo exports, disclosure guidance and truthful ways to describe the product." />
      <Panel title="Logo files" id="logos-h">
        <ul className="grid gap-4 md:grid-cols-3">
          {LOGOS.map((l) => (
            <li key={l.file} className="overflow-hidden rounded-[var(--radius-media)] border border-rule">
              <div className={`grid h-32 place-items-center p-6 ${l.bg}`}>
                <Image src={l.file} alt="" width={l.file.includes("symbol") ? 64 : 200} height={l.file.includes("symbol") ? 64 : 31} className="h-auto max-h-16 w-auto" />
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-dark">{l.name}</p>
                  <p className="text-xs text-muted-dark">{l.use}</p>
                </div>
                <a href={l.file} download className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-rule px-3 text-sm font-semibold text-ink-dark hover:bg-paper">
                  <Download aria-hidden className="size-4" /> Download
                </a>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-dark">Use the files as supplied. Don&apos;t recolor, stretch, rotate or redraw the wordmark or symbol.</p>
      </Panel>
      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Disclosure" id="disc-h">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-dark">
            <li>Say clearly that you may earn a commission when someone pays through your link.</li>
            <li>Place the disclosure before the link, not only at the end of a description.</li>
            <li>Follow the rules of each platform and your local advertising law.</li>
          </ul>
        </Panel>
        <Panel title="Describing Genlixs truthfully" id="truth-h">
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink-dark">
            <li>Do say: create images, edit a reference image, or generate a short video with credits.</li>
            <li>Don&apos;t promise unlimited use, guaranteed results or earnings.</li>
            <li>Don&apos;t show other people&apos;s work as yours or claim features that aren&apos;t listed.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
