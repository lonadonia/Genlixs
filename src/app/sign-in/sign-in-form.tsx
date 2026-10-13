"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOLS, settingsSummary } from "@/lib/catalog";
import { setDemo, useDemo } from "@/lib/demo-store";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm({ next, reason }: { next: string | null; reason: "reference" | null }) {
  const router = useRouter();
  const { draft, hydrated } = useDemo();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const destination = next ?? (draft ? TOOLS[draft.tool].href : "/studio");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!EMAIL.test(email.trim())) nextErrors.email = "Enter an email address like name@example.com.";
    if (password.length < 8) nextErrors.password = "Use at least 8 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(nextErrors.email ? "email" : "password")?.focus();
      return;
    }
    setBusy(true);
    // Preview only: no credentials leave the browser. Production uses the real auth service.
    window.setTimeout(() => {
      setDemo((s) => ({ ...s, signedIn: true, email: email.trim() }));
      router.push(destination);
    }, 600);
  };

  const continueDemo = () => {
    setDemo((s) => ({ ...s, signedIn: true, email: "demo.creator@example.com" }));
    router.push(destination);
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-[1.875rem] leading-[1.08] font-extrabold">{mode === "sign-in" ? "Sign in to Genlixs" : "Create your Genlixs account"}</h1>
      <p className="mt-2 text-muted">
        {reason === "reference"
          ? "Sign in to upload your reference image. Your instruction and settings are saved."
          : "Your studio, library and credits in one place."}
      </p>

      {hydrated && draft && draft.prompt ? (
        <section aria-label="Saved draft" className="mt-6 rounded-[24px] border border-white/[0.08] bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText aria-hidden className="size-4 text-brand-blue-bright" />
            Your draft is saved
          </p>
          <p className="mt-2 line-clamp-2 text-sm text-muted">“{draft.prompt}”</p>
          <p className="mt-2 text-xs text-muted">
            {TOOLS[draft.tool].label} · {settingsSummary(draft.settings)}
          </p>
          <p className="mt-2 text-xs text-muted">After you sign in, it opens in the {TOOLS[draft.tool].studioTitle.toLowerCase()}. Nothing is generated until you choose Generate.</p>
        </section>
      ) : null}

      <form noValidate onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            className="mt-1.5 block h-12 w-full rounded-2xl border border-line-strong bg-raised px-3.5 text-base text-ink aria-invalid:border-error-on-dark"
          />
          {errors.email ? (
            <p id="email-error" className="mt-1.5 text-sm text-error-on-dark">
              {errors.email}
            </p>
          ) : null}
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="block text-sm font-semibold">
              Password
            </label>
            {mode === "sign-in" ? (
              <Link href="/help#account" className="text-sm font-semibold text-link hover:underline">
                Forgot password?
              </Link>
            ) : null}
          </div>
          <input
            id="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : "password-hint"}
            className="mt-1.5 block h-12 w-full rounded-2xl border border-line-strong bg-raised px-3.5 text-base text-ink aria-invalid:border-error-on-dark"
          />
          {errors.password ? (
            <p id="password-error" className="mt-1.5 text-sm text-error-on-dark">
              {errors.password}
            </p>
          ) : (
            <p id="password-hint" className="mt-1.5 text-xs text-muted">
              At least 8 characters.
            </p>
          )}
        </div>
        <Button type="submit" size="lg" busy={busy} className="w-full">
          {busy ? "Signing in…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-white/[0.08] bg-surface p-3 text-sm text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-link" />
        <p>
          Preview mode: no account is created and nothing is sent. Any valid-looking email works, or{" "}
          <button type="button" onClick={continueDemo} className="font-semibold text-link underline underline-offset-2">
            continue with the demo account
          </button>
          .
        </p>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "sign-in" ? "New to Genlixs? " : "Already have an account? "}
        <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} className="font-semibold text-link hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
