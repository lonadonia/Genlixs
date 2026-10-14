"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";

export function ResetForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/update-password", { body: { password } });
      setDone(true);
    } catch (er) {
      setError(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="mt-6 text-sm text-ink">
        Your password was changed.{" "}
        <Link href="/studio" className="font-semibold text-link hover:underline">
          Open your studio
        </Link>
      </p>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-4">
      <div>
        <label htmlFor="new-password" className="block text-sm font-semibold">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "new-password-error" : undefined}
          className="mt-1.5 block h-12 w-full rounded-2xl border border-line-strong bg-raised px-3.5 text-base text-ink"
        />
        {error ? (
          <p id="new-password-error" role="alert" className="mt-1.5 text-sm text-error-on-dark">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" busy={busy} className="w-full">
        Save new password
      </Button>
    </form>
  );
}
