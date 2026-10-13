import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <Logo width={150} className="mx-auto" />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-muted">The link may be old, or the page isn&apos;t part of this preview.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/">Go to the homepage</ButtonLink>
          <ButtonLink href="/studio" variant="secondary">
            Open the studio
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
