import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { PreviewBanner } from "@/components/preview-banner";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const sp = await searchParams;
  return (
    <>
      <PreviewBanner />
      <div className="flex min-h-[calc(100dvh-33px)] flex-col">
        <header className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center px-4 sm:px-6 lg:px-10">
          <Logo width={160} className="-ml-2" />
        </header>
        <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
          <SignInForm next={safeNext(sp.next)} reason={sp.reason === "reference" ? "reference" : null} />
        </main>
      </div>
    </>
  );
}
