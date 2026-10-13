import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHead, Panel } from "@/components/console/parts";
import { PARTNER } from "@/lib/admin-data";

export const metadata: Metadata = { title: "Settings" };

export default function PartnerSettingsPage() {
  return (
    <div className="mx-auto max-w-[1000px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead title="Settings" sub="Profile details and payout details are managed separately. Payout changes need verification." />
      <Panel title="Partner profile" id="prof-h">
        <dl className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-muted-dark">Display name</dt>
            <dd className="font-semibold text-ink-dark">{PARTNER.name}</dd>
          </div>
          <div>
            <dt className="text-muted-dark">Partner since</dt>
            <dd className="font-semibold text-ink-dark">{PARTNER.since}</dd>
          </div>
          <div>
            <dt className="text-muted-dark">Main channel</dt>
            <dd className="font-semibold text-ink-dark">YouTube · tutorials</dd>
          </div>
          <div>
            <dt className="text-muted-dark">Agreement</dt>
            <dd className="font-semibold text-ink-dark">{PARTNER.agreement}</dd>
          </div>
        </dl>
        <Button variant="secondary-light" className="mt-5" disabled aria-describedby="prof-why">
          Edit profile
        </Button>
        <p id="prof-why" className="mt-2 text-xs text-muted-dark">
          Unavailable in this preview: editing connects to the partner service in production.
        </p>
      </Panel>
      <Panel title="Payout details" id="pay-h" action={<Badge surface="light" tone="success">Verified</Badge>}>
        <p className="text-sm text-ink-dark">Bank transfer · account ending ••21 · USD</p>
        <p className="mt-2 text-sm text-muted-dark">
          Changing payout details sends a verification email and starts a 72-hour cooldown (sample policy). Payouts are paused during the cooldown, and the
          change is shown on your next payout review.
        </p>
        <Button variant="secondary-light" className="mt-5" disabled aria-describedby="pay-why">
          Change payout details
        </Button>
        <p id="pay-why" className="mt-2 text-xs text-muted-dark">
          Unavailable in this preview: payout details are verified by the payout provider in production.
        </p>
      </Panel>
    </div>
  );
}
