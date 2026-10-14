import type { Metadata } from "next";
import { LIVE } from "@/lib/config";
import { LivePartnerReferrals } from "@/components/live/partner/live-partner";
import { Badge, type Tone } from "@/components/ui/badge";
import { PageHead } from "@/components/console/parts";

export const metadata: Metadata = { title: "Referrals" };

const REFERRALS: { id: string; joined: string; campaign: string; state: string; tone: Tone; history: string }[] = [
  { id: "R-••3f9", joined: "2 Sep 2026", campaign: "YouTube tutorial", state: "Paying", tone: "success", history: "Registered 2 Sep · first payment 9 Sep · eligible 8 Oct" },
  { id: "R-••a71", joined: "5 Sep 2026", campaign: "Newsletter", state: "Paying", tone: "success", history: "Registered 5 Sep · payments 7 Sep, 10 Oct" },
  { id: "R-••c02", joined: "18 Sep 2026", campaign: "YouTube tutorial", state: "Under review", tone: "warning", history: "Payment dispute opened 10 Oct · review by 24 Oct" },
  { id: "R-••77e", joined: "21 Sep 2026", campaign: "Instagram bio", state: "Paying", tone: "success", history: "Registered 21 Sep · first payment 22 Sep" },
  { id: "R-••b18", joined: "24 Sep 2026", campaign: "Newsletter", state: "Not eligible", tone: "neutral", history: "Payment refunded 28 Sep — commission reversed" },
  { id: "R-••e40", joined: "9 Oct 2026", campaign: "YouTube tutorial", state: "Registered", tone: "info", history: "No payment yet" },
];

export default function ReferralsPage() {
  if (LIVE) return <LivePartnerReferrals />;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Referrals"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Referred accounts are masked. You never see their files, prompts or billing details.
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />
      <ul className="grid gap-3 lg:grid-cols-2">
        {REFERRALS.map((r) => (
          <li key={r.id} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-4 shadow-[var(--shadow-lift)]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-ink-dark">{r.id}</span>
              <Badge surface="light" tone={r.tone}>
                {r.state}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-dark">
              Joined {r.joined} · via {r.campaign}
            </p>
            <p className="mt-2 border-t border-rule pt-2 text-xs text-muted-dark">Eligibility history: {r.history}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
