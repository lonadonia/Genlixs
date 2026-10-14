import type { Metadata } from "next";
import { InfoPage } from "@/components/public/info-page";
import { ApplyForm } from "./apply-form";
import { LIVE } from "@/lib/config";
import { AccountProvider } from "@/lib/live/account";
import { LiveApplyForm } from "@/components/live/partner/live-partner";

export const metadata: Metadata = { title: "Apply to the partner program" };

export default function ApplyPage() {
  return (
    <InfoPage
      eyebrow="Partner program"
      title="Apply to the partner program"
      intro="A short application. We review channels by hand and reply with a decision or a question."
    >
      {LIVE ? (
        <AccountProvider>
          <LiveApplyForm />
        </AccountProvider>
      ) : (
        <ApplyForm />
      )}
    </InfoPage>
  );
}
