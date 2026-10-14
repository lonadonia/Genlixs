"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";

export function TestCheckout({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (outcome: "paid" | "failed") => {
    setBusy(outcome);
    setError(null);
    try {
      await api(`/api/billing/test-checkout/${orderId}`, { body: { outcome } });
      router.push(`/studio/billing?order=${orderId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };
  return (
    <div className="mt-6 grid gap-2">
      <Button size="lg" busy={busy === "paid"} disabled={Boolean(busy)} onClick={() => send("paid")}>
        Simulate a settled payment
      </Button>
      <Button size="lg" variant="secondary" busy={busy === "failed"} disabled={Boolean(busy)} onClick={() => send("failed")}>
        Simulate a failed payment
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-error-on-dark">
          {error}
        </p>
      ) : null}
    </div>
  );
}
