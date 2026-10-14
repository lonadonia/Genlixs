"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOLS, settingsSummary } from "@/lib/catalog";
import { setDemo, useDemo } from "@/lib/demo-store";
import { LIVE } from "@/lib/config";
import { api, errorMessage } from "@/lib/live/api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "sign-in" | "sign-up" | "reset";

export function SignInForm({ next, reason, initialMode = "sign-in" }: { next: string | null; reason: "reference" | "link" | null; initialMode?: Mode }) {
  const router = useRouter();
  const { draft, hydrated } = useDemo();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [notice, setNotice] = useState<string | null>(reason === "link" ? "That link is invalid or has expired. Sign in, or request a new link." : null);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const destination = next ?? (draft ? TOOLS[draft.tool].href : "/studio");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (!EMAIL.test(email.trim())) nextErrors.email = "Enter an email address like name@example.com.";
    if (mode !== "reset" && password.length < 8) nextErrors.password = "Use at least 8 characters.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(nextErrors.email ? "email" : "password")?.focus();
      return;
    }
    setBusy(true);
    if (LIVE) {
      void liveSubmit();
      return;
    }
    // Preview only: no credentials leave the browser. Production uses the real auth service.
    window.setTimeout(() => {
      setDemo((s) => ({ ...s, signedIn: true, email: email.trim() }));
      router.push(destination);
    }, 600);
  };

  // Real authentication: the server sets the session cookies; nothing is stored in the browser by us.
  const liveSubmit = async () => {
    setFormError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        await api("/api/auth/reset", { body: { email: email.trim() } });
        setNotice("If an account exists for that email, we sent a link to choose a new password.");
      } else if (mode === "sign-up") {
        const r = await api<{ signedIn: boolean; checkEmail: boolean }>("/api/auth/sign-up", { body: { email: email.trim(), password, next: destination } });
        if (r.signedIn) {
          router.push(destination);
          router.refresh();
          return;
        }
        setNotice("Check your email to confirm your account. The link opens your studio.");
      } else {
        await api("/api/auth/sign-in", { body: { email: email.trim(), password } });
        router.push(destination);
        router.refresh();
        return;
      }
    } catch (e) {
      setFormError(errorMessage(e));
    }
    setBusy(false);
  };

  const continueDemo = () => {
    setDemo((s) => ({ ...s, signedIn: true, email: "demo.creator@example.com" }));
    router.push(destination);
  };

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-[1.875rem] leading-[1.08] font-extrabold">
        {mode === "sign-in" ? "Sign in to Genlixs" : mode === "sign-up" ? "Create your Genlixs account" : "Reset your password"}
      </h1>
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

      {notice ? (
        <p role="status" className="mt-6 rounded-2xl border border-[rgb(37_63_246/0.5)] bg-[rgb(37_63_246/0.14)] p-3 text-sm text-ink">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="mt-6 rounded-2xl border border-[rgb(239_68_68/0.4)] bg-[rgb(239_68_68/0.12)] p-3 text-sm text-error-on-dark">
          {formError}
        </p>
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
        {mode === "reset" ? null : (
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="block text-sm font-semibold">
              Password
            </label>
            {mode === "sign-in" ? (
              LIVE ? (
                <button type="button" onClick={() => setMode("reset")} className="text-sm font-semibold text-link hover:underline">
                  Forgot password?
                </button>
              ) : (
                <Link href="/help#account" className="text-sm font-semibold text-link hover:underline">
                  Forgot password?
                </Link>
              )
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
        )}
        <Button type="submit" size="lg" busy={busy} className="w-full">
          {busy ? "One moment…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Send reset link"}
        </Button>
      </form>

      {LIVE ? null : (
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
      )}

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "sign-in" ? "New to Genlixs? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setNotice(null);
            setFormError(null);
          }}
          className="font-semibold text-link hover:underline"
        >
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
