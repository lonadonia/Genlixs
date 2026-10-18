import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { AutoplayVideo } from "@/components/ui/autoplay-video";
import { PreviewBanner } from "@/components/preview-banner";
import { SignInForm } from "./sign-in-form";
import { LIVE } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  return (
    <>
      {LIVE ? null : <PreviewBanner />}
      <div className="grid min-h-[calc(100dvh-36px)] lg:grid-cols-2">
        <div className="relative isolate flex min-w-0 flex-col">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="dot-field absolute inset-0 opacity-70" />
          </div>
          <header className="flex h-[76px] w-full items-center px-4 sm:px-6 lg:px-10">
            <Logo width={150} className="-ml-1.5" priority />
          </header>
          <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
            <SignInForm
              next={safeNext(sp.next)}
              reason={sp.reason === "reference" ? "reference" : sp.reason === "link" ? "link" : null}
              initialMode={sp.mode === "sign-up" ? "sign-up" : sp.mode === "reset" ? "reset" : "sign-in"}
            />
          </main>
        </div>

        {/* Brand panel (desktop): a client demo clip, muted and decorative; with reduced motion or Save-Data it stays on its poster. */}
        <aside aria-hidden className="relative hidden overflow-hidden p-3 lg:block">
          <div className="relative h-full overflow-hidden rounded-[28px] border border-white/[0.08] bg-raised">
            <AutoplayVideo media="demoNightMarket" decorative className="absolute inset-0 object-[50%_35%]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(15_18_18/0.95)_24%,rgb(15_18_18/0.35)_60%,transparent)]" />
            <div className="absolute inset-x-0 bottom-0 p-10">
              <p className="font-display max-w-md text-[2.25rem] leading-[1.05] font-extrabold text-white">
                Your drafts wait for you. <span className="text-brand-blue-bright">Nothing runs until you say so.</span>
              </p>
              <div className="brand-rule mt-6">
                <span className="bg-brand-blue" />
                <span className="bg-brand-lime" />
                <span className="bg-white" />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
