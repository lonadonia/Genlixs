import { PreviewBanner } from "@/components/preview-banner";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";
import { Suspense } from "react";
import { LIVE } from "@/lib/config";
import { ReferralConsent } from "@/components/live/public/live-public";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PreviewBanner />
      <PublicHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <PublicFooter />
      {LIVE ? (
        <Suspense>
          <ReferralConsent />
        </Suspense>
      ) : null}
    </>
  );
}
