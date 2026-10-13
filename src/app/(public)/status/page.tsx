import type { Metadata } from "next";
import { InfoPage } from "@/components/public/info-page";
import { Badge, type Tone } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Service status" };

const SERVICES: { name: string; state: string; tone: Tone; note: string }[] = [
  { name: "Website and sign-in", state: "Operational", tone: "success", note: "No known issues." },
  { name: "Image generation", state: "Operational", tone: "success", note: "No known issues." },
  { name: "Image editing", state: "Operational", tone: "success", note: "No known issues." },
  { name: "Video generation", state: "Slower than usual", tone: "warning", note: "Some clips take longer than usual. Jobs are not lost and stay in your library." },
  { name: "Payments", state: "Operational", tone: "success", note: "No known issues." },
  { name: "File downloads", state: "Operational", tone: "success", note: "No known issues." },
];

export default function StatusPage() {
  return (
    <InfoPage
      eyebrow="Service status"
      title="Current service status"
      intro={<>Sample status for layout review. Production reads this from the monitoring service. Last updated 13 Oct 2026, 09:00 UTC.</>}
    >
      <ul className="max-w-3xl divide-y divide-line overflow-hidden rounded-[var(--radius-media)] border border-line bg-surface">
        {SERVICES.map((s) => (
          <li key={s.name} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-ink">{s.name}</p>
              <p className="text-sm text-muted">{s.note}</p>
            </div>
            <Badge tone={s.tone}>{s.state}</Badge>
          </li>
        ))}
      </ul>
    </InfoPage>
  );
}
