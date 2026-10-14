"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/live/account";
import { browserClient } from "@/lib/supabase/client";
import { money, units, type Product } from "@/lib/live/types";
import { cn, fmtNum } from "@/lib/format";
import { LIVE } from "@/lib/config";

/** Published credit packs from the database; nothing is shown as a price until the owner publishes it. */
export function LivePricing() {
  const plans = useApi<Product[]>("/api/plans");
  const packs = (plans.data ?? []).filter((p) => p.kind === "credit_pack");
  if (plans.loading && !plans.data) return <p className="mt-5 text-sm text-muted">Loading prices…</p>;
  if (!packs.length)
    return (
      <p className="mt-5 rounded-[24px] border border-white/[0.08] bg-raised p-6 text-[15px] text-muted">
        Credit packs and prices are published here once they are approved. Until then nothing can be bought or charged.
      </p>
    );
  return (
    <ul className="mt-5 grid gap-4 sm:grid-cols-3">
      {packs.map((p, i) => (
        <li
          key={p.key}
          className={cn(
            "relative flex flex-col overflow-hidden rounded-[24px] border p-6",
            i === 1 ? "border-brand-blue bg-[radial-gradient(120%_80%_at_50%_0%,rgb(37_63_246/0.35),transparent_70%)] bg-raised" : "border-white/[0.08] bg-raised",
          )}
        >
          <p className="text-sm font-semibold text-muted">{p.name}</p>
          <p className="font-display mt-3 text-[2.5rem] leading-none font-extrabold text-ink tabular">{fmtNum(units(p.credits))}</p>
          <p className="mt-1 text-sm text-muted">credits</p>
          <p className="mt-6 text-xl font-semibold text-ink tabular">{money(p.amountMinor, p.currency)}</p>
          <p className="mt-1 text-xs text-muted">One-time purchase{p.creditExpiryDays ? ` · credits valid ${p.creditExpiryDays} days` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

/** Display-only session hint for navigation (authorization always happens on the server). */
export function useLiveSignedIn(): { hydrated: boolean; signedIn: boolean } {
  const [state, setState] = useState({ hydrated: false, signedIn: false });
  useEffect(() => {
    if (!LIVE) return;
    const client = browserClient();
    let active = true;
    client.auth.getSession().then(({ data }) => active && setState({ hydrated: true, signedIn: Boolean(data.session) }));
    const { data: sub } = client.auth.onAuthStateChange((_e, session) => active && setState({ hydrated: true, signedIn: Boolean(session) }));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}

const readConsent = () => (typeof document === "undefined" ? "unknown" : (/(?:^|;\s*)gx_consent=([01])/.exec(document.cookie)?.[1] ?? "none"));
const subscribe = () => () => {};

/**
 * Referral consent prompt (§18.2): shown only to visitors who arrived through a partner link and have not decided.
 * Accepting re-opens the link with consent so a signed first-party attribution cookie is set; declining stores nothing else.
 */
export function ReferralConsent() {
  const params = useSearchParams();
  const via = params.get("via");
  const decided = useSyncExternalStore(subscribe, readConsent, () => "unknown");
  const [hidden, setHidden] = useState(false);
  if (!via || !/^[A-Za-z0-9_-]{3,40}$/.test(via) || decided !== "none" || hidden) return null;
  const decide = (yes: boolean) => {
    document.cookie = `gx_consent=${yes ? 1 : 0}; Max-Age=${365 * 24 * 3600}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setHidden(true);
    // /r/<slug> is a route handler that sets the cookie and redirects: a full navigation is required.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (yes) window.location.assign(`/r/${encodeURIComponent(via)}?consent=1`);
  };
  return (
    <div role="dialog" aria-label="Referral cookie" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-2xl border border-white/15 bg-elevated p-4 shadow-[var(--shadow-pop)]">
      <p className="text-sm text-ink">
        You arrived through a partner link. May we store one first-party cookie for 30 days so the partner is credited if you sign up? It holds no personal data.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => decide(true)}>
          Accept
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide(false)}>
          No thanks
        </Button>
      </div>
    </div>
  );
}
