import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="console-frame w-full max-w-md p-8">
        <Logo width={140} href="/" />
        <h1 className="font-display mt-6 text-2xl font-extrabold">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">Use at least 8 characters. You stay signed in on this device.</p>
        <ResetForm />
      </div>
    </main>
  );
}
