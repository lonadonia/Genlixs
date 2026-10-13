import { PreviewBanner } from "@/components/preview-banner";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PreviewBanner />
      <PublicHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
