import type { Metadata } from "next";
import Image from "next/image";
import { Logo } from "@/components/brand/logo";
import { PreviewBanner } from "@/components/preview-banner";
import { ConceptTag } from "@/components/ui/badge";
import { MEDIA } from "@/lib/media";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  return (
    <>
      <PreviewBanner />
      <div className="grid min-h-[calc(100dvh-36px)] lg:grid-cols-2">
        <div className="relative isolate flex min-w-0 flex-col">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="dot-field absolute inset-0 opacity-70" />
          </div>
          <header className="flex h-[76px] w-full items-center px-4 sm:px-6 lg:px-10">
            <Logo width={150} className="-ml-1.5" priority />
          </header>
          <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
            <SignInForm next={safeNext(sp.next)} reason={sp.reason === "reference" ? "reference" : null} />
          </main>
        </div>

        {/* Brand panel (desktop): placeholder render in the v2 palette, never presented as model output. */}
        <aside aria-hidden className="relative hidden overflow-hidden p-3 lg:block">
          <div className="relative h-full overflow-hidden rounded-[28px] border border-white/[0.08] bg-raised">
            <Image src={MEDIA.torus.src} alt="" fill sizes="50vw" className="object-cover object-[50%_40%]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(15_18_18/0.92)_8%,rgb(15_18_18/0.2)_55%,transparent)]" />
            <ConceptTag className="absolute top-5 left-5" />
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
