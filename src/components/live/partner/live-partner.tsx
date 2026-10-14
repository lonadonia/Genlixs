"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { PageHead, Panel, StatTile } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api, errorMessage } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { money } from "@/lib/live/types";
import { fmtNum } from "@/lib/format";

type Agreement = {
  version: number;
  baseRateBps: number;
  upliftRateBps: number;
  upliftThreshold: number;
  attributionWindowDays: number;
  renewalMonths: number;
  holdDays: number;
  payoutThresholds: Record<string, number>;
  confirmed: Record<string, boolean> | null;
  summary: string | null;
  state: string;
} | null;

type Overview = {
  membership: { id: string; state: string; tier: string; qualifyingCustomers: number; rejectionReason: string | null; payoutCurrency: string; since: string | null } | null;
  agreement: Agreement;
  currentRateBps?: number;
  mainLink?: { slug: string; path: string } | null;
  metrics?: { clicks30d: number; signups: number; payingCustomers: number; eligibleRevenueMinor: string };
  balances?: Record<string, { pendingHold: string; available: string; reserved: string; paid: string; disputed: string; reversed: string; carryForward: string }> | null;
  nextPayoutNote?: string;
};

const pct = (bps?: number) => (bps === undefined ? "—" : `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`);
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const STATE: Record<string, string> = { applied: "Application under review", active: "Approved partner", rejected: "Not accepted", suspended: "Suspended" };

const Wrap = ({ children }: { children: ReactNode }) => <div className="mx-auto w-full max-w-[1200px] space-y-6 p-4 sm:p-6 lg:p-8">{children}</div>;
const Err = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-sm text-error-text">
    {children}
  </p>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-rule-strong p-5 text-center text-sm text-muted-dark">{children}</p>;

/** Shared gate: signed in → membership state decides what the portal shows. */
function useMembership() {
  const acct = useAccount();
  const o = useApi<Overview>(acct.me ? "/api/affiliate/overview" : null, [acct.me?.id]);
  return { acct, o };
}

export function LivePartnerBadge() {
  const { acct, o } = useMembership();
  const m = o.data?.membership;
  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-xs">
      <p className="truncate font-semibold text-ink">{acct.me?.email ?? "Not signed in"}</p>
      <p className="mt-0.5 font-semibold text-brand-lime">{m ? STATE[m.state] ?? m.state : acct.me ? "Not a partner yet" : ""}</p>
    </div>
  );
}

export function LivePartnerGate({ children }: { children: ReactNode }) {
  const acct = useAccount();
  if (!acct.hydrated) return <Wrap>Loading…</Wrap>;
  if (!acct.me)
    return (
      <Wrap>
        <Panel title="Sign in to the partner portal">
          <p className="text-sm text-muted-dark">The partner portal uses your Genlixs account.</p>
          <ButtonLink href="/sign-in?next=/partner" className="mt-4">
            Sign in
          </ButtonLink>
        </Panel>
      </Wrap>
    );
  return <>{children}</>;
}

function NotActive({ o }: { o: Overview | null }) {
  const m = o?.membership;
  if (!m)
    return (
      <Panel title="Join the partner program">
        <p className="text-sm text-muted-dark">Apply with your channel. We review every application by hand.</p>
        <ButtonLink href="/partners/apply" className="mt-4">
          Apply now
        </ButtonLink>
      </Panel>
    );
  return (
    <Panel title={STATE[m.state] ?? m.state}>
      <p className="text-sm text-muted-dark">
        {m.state === "applied"
          ? "We review applications by hand and reply by email. Links and earnings open once you are approved."
          : m.state === "rejected"
            ? `Your application was not accepted.${m.rejectionReason ? ` Reason: ${m.rejectionReason}` : ""}`
            : "Your partner account is suspended. Contact partner support."}
      </p>
    </Panel>
  );
}

export function LivePartnerOverview() {
  const { o } = useMembership();
  if (o.error) return <Wrap><Err>{o.error.message}</Err></Wrap>;
  if (!o.data) return <Wrap>Loading…</Wrap>;
  const d = o.data;
  const m = d.membership;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Wrap>
      <PageHead title="Partner overview" sub={m?.state === "active" ? `Partner since ${date(m.since)}` : undefined} />
      {m?.state !== "active" ? <NotActive o={d} /> : null}
      {m?.state === "active" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Current commission" value={pct(d.currentRateBps)} sub={m.tier === "uplift" ? "Uplift tier" : "Base tier"} />
            <StatTile
              label="Distinct paying customers"
              value={`${fmtNum(m.qualifyingCustomers)} / ${d.agreement?.upliftThreshold ?? 10}`}
              sub={m.tier === "uplift" ? "Uplift reached" : `${pct(d.agreement?.upliftRateBps)} after ${d.agreement?.upliftThreshold ?? 10} distinct paying customers`}
            />
            <StatTile label="Clicks (30 days)" value={fmtNum(d.metrics?.clicks30d ?? 0)} />
            <StatTile label="Sign-ups" value={fmtNum(d.metrics?.signups ?? 0)} sub={`${fmtNum(d.metrics?.payingCustomers ?? 0)} paying`} />
          </div>
          {d.mainLink ? (
            <Panel title="Your main link">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-3 py-2 text-sm">{origin + d.mainLink.path}</code>
                <CopyButton value={origin + d.mainLink.path} surface="light" />
              </div>
            </Panel>
          ) : null}
          <Panel title="Earnings">
            {!d.balances ? <Empty>No commissions yet.</Empty> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(d.balances ?? {}).map(([cur, b]) => (
                <dl key={cur} className="grid grid-cols-2 gap-2 rounded-xl border border-rule p-4 text-sm">
                  <dt className="text-muted-dark">In hold</dt>
                  <dd className="text-right font-semibold tabular">{money(b.pendingHold, cur)}</dd>
                  <dt className="text-muted-dark">Available</dt>
                  <dd className="text-right font-semibold tabular">{money(b.available, cur)}</dd>
                  <dt className="text-muted-dark">In a payout</dt>
                  <dd className="text-right font-semibold tabular">{money(b.reserved, cur)}</dd>
                  <dt className="text-muted-dark">Paid</dt>
                  <dd className="text-right font-semibold tabular">{money(b.paid, cur)}</dd>
                </dl>
              ))}
            </div>
            {d.nextPayoutNote ? <p className="mt-3 text-xs text-muted-dark">{d.nextPayoutNote}</p> : null}
          </Panel>
        </>
      ) : null}
      <AgreementPanel a={d.agreement} />
    </Wrap>
  );
}

function AgreementPanel({ a }: { a: Agreement }) {
  if (!a) return <Panel title="Program terms"><p className="text-sm text-muted-dark">The program terms have not been published yet.</p></Panel>;
  return (
    <Panel title={`Program terms · version ${a.version}`} action={a.state !== "published" ? <Badge tone="attention" surface="light">Draft</Badge> : null}>
      <ul className="grid gap-1.5 text-sm text-ink-dark">
        <li>
          {pct(a.baseRateBps)} of eligible revenue, rising to {pct(a.upliftRateBps)} after {a.upliftThreshold} distinct paying customers.
        </li>
        <li>Attribution window: {a.attributionWindowDays} days. Renewals earn for {a.renewalMonths} months.</li>
        <li>Commissions are held {a.holdDays} days before they become available for payout.</li>
        <li>
          Payout threshold:{" "}
          {Object.entries(a.payoutThresholds ?? {})
            .map(([c, v]) => money(v, c))
            .join(", ") || "—"}
        </li>
      </ul>
      {a.summary ? <p className="mt-3 text-xs text-muted-dark">{a.summary}</p> : null}
    </Panel>
  );
}

// --------------------------------------------------------------------- links

const DESTINATIONS = ["/", "/#create", "/#examples", "/#pricing", "/studio/image", "/studio/edit", "/studio/video", "/help", "/partners/apply"];
type LinkRow = { id: string; path: string; destination: string; campaign: string | null; channel: string | null; subId: string | null; isMain: boolean; archivedAt: string | null; clicks: number; signups: number; payingCustomers: number };

export function LivePartnerLinks() {
  const { o } = useMembership();
  const links = useApi<LinkRow[]>("/api/affiliate/links");
  const [form, setForm] = useState({ destination: "/", campaign: "", channel: "", subId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (o.data && o.data.membership?.state !== "active") return <Wrap><PageHead title="Links" /><NotActive o={o.data} /></Wrap>;
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/affiliate/links", { body: form });
      setForm({ destination: "/", campaign: "", channel: "", subId: "" });
      links.reload();
    } catch (er) {
      setError(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Wrap>
      <PageHead title="Links" sub="Tracked links to allowed Genlixs pages." />
      <Panel title="Create a link">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">
            Page
            <select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 font-normal">
              {DESTINATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          {(["campaign", "channel", "subId"] as const).map((k) => (
            <label key={k} className="grid gap-1 text-sm font-semibold">
              {k === "subId" ? "Sub-ID" : k[0].toUpperCase() + k.slice(1)}
              <input maxLength={60} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 font-normal" />
            </label>
          ))}
          <div className="sm:col-span-4">
            <Button type="submit" busy={busy}>
              Create link
            </Button>
            {error ? <Err>{error}</Err> : null}
          </div>
        </form>
      </Panel>
      <Panel title="Your links" bodyClass="p-0">
        {links.error ? <div className="p-5"><Err>{links.error.message}</Err></div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Link</th>
                <th className="px-3 py-2.5 font-semibold">Page</th>
                <th className="px-3 py-2.5 font-semibold">Campaign</th>
                <th className="px-3 py-2.5 text-right font-semibold">Clicks</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sign-ups</th>
                <th className="px-3 py-2.5 text-right font-semibold">Paying</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {(links.data ?? []).map((l) => (
                <tr key={l.id} className={l.archivedAt ? "opacity-60" : undefined}>
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-2">
                      <code className="truncate">{l.path}</code>
                      <CopyButton value={origin + l.path} surface="light" variant="inline" srLabel="Copy link" />
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{l.destination}</td>
                  <td className="px-3 py-2.5">{l.isMain ? "Main link" : l.campaign ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtNum(l.clicks)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtNum(l.signups)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtNum(l.payingCustomers)}</td>
                  <td className="px-5 py-2.5 text-right">
                    {!l.isMain && !l.archivedAt ? (
                      <Button variant="ghost-light" size="sm" onClick={() => api(`/api/affiliate/links/${l.id}/archive`, { method: "POST", body: {} }).then(links.reload, () => null)}>
                        Archive
                      </Button>
                    ) : l.archivedAt ? (
                      "Archived"
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Wrap>
  );
}

// ------------------------------------------------- referrals / commissions

type Referral = { customerRef: string; signedUpAt: string; firstPaymentAt: string | null; state: string; qualifies: boolean; campaign: string | null };
type Commission = { id: string; customerRef: string; baseMinor: string; currency: string; rateBps: number; agreementVersion: number; amountMinor: string; reversedMinor: string; state: string; holdUntil: string | null; createdAt: string };

export function LivePartnerReferrals() {
  const r = useApi<Referral[]>("/api/affiliate/referrals");
  return (
    <Wrap>
      <PageHead title="Referrals" sub="Customers who signed up through your links. Identities are masked." />
      <Panel bodyClass="p-0">
        {r.error ? <div className="p-5"><Err>{r.error.message}</Err></div> : null}
        {r.data && !r.data.length ? <div className="p-5"><Empty>No referred sign-ups yet.</Empty></div> : null}
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs text-muted-dark">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Customer</th>
              <th className="px-3 py-2.5 font-semibold">Signed up</th>
              <th className="px-3 py-2.5 font-semibold">First payment</th>
              <th className="px-3 py-2.5 font-semibold">Counts toward uplift</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {(r.data ?? []).map((x) => (
              <tr key={x.customerRef + x.signedUpAt}>
                <td className="px-5 py-2.5 font-mono text-xs">{x.customerRef}</td>
                <td className="px-3 py-2.5">{date(x.signedUpAt)}</td>
                <td className="px-3 py-2.5">{date(x.firstPaymentAt)}</td>
                <td className="px-3 py-2.5">{x.qualifies ? "Yes" : "Not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Wrap>
  );
}

const COMMISSION_STATE: Record<string, string> = {
  pending_hold: "In hold",
  eligible: "Available",
  reserved_for_payout: "In a payout",
  paid: "Paid",
  reversed: "Reversed",
  disputed: "Disputed",
};

export function LivePartnerCommissions() {
  const c = useApi<Commission[]>("/api/affiliate/commissions");
  return (
    <Wrap>
      <PageHead title="Commissions" sub="One line per paid customer payment. Refunds reverse commissions proportionally." />
      <Panel bodyClass="p-0">
        {c.error ? <div className="p-5"><Err>{c.error.message}</Err></div> : null}
        {c.data && !c.data.length ? <div className="p-5"><Empty>No commissions yet.</Empty></div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 text-right font-semibold">Eligible revenue</th>
                <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">Commission</th>
                <th className="px-5 py-2.5 font-semibold">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {(c.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td className="px-5 py-2.5">{date(x.createdAt)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{x.customerRef}</td>
                  <td className="px-3 py-2.5 text-right tabular">{money(x.baseMinor, x.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{pct(x.rateBps)}</td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {money(Number(x.amountMinor) - Number(x.reversedMinor), x.currency)}
                    {Number(x.reversedMinor) ? <span className="block text-xs text-muted-dark">−{money(x.reversedMinor, x.currency)} reversed</span> : null}
                  </td>
                  <td className="px-5 py-2.5">
                    {COMMISSION_STATE[x.state] ?? x.state}
                    {x.state === "pending_hold" && x.holdUntil ? <span className="block text-xs text-muted-dark">until {date(x.holdUntil)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Wrap>
  );
}

// ------------------------------------------------------- payouts / settings

type Payouts = {
  destination: { method: string; hint: string; verified: boolean; changedAt: string } | null;
  payouts: { batchRef: string; state: string; currency: string; amountMinor: string; reference: string | null; paidAt: string | null; createdAt: string }[];
};

export function LivePartnerPayouts() {
  const p = useApi<Payouts>("/api/affiliate/payouts");
  return (
    <Wrap>
      <PageHead title="Payouts" sub="Transfers are prepared monthly by our finance team and recorded here with their reference." />
      <DestinationPanel data={p.data} onSaved={p.reload} />
      <Panel title="Transfers" bodyClass="p-0">
        {p.error ? <div className="p-5"><Err>{p.error.message}</Err></div> : null}
        {p.data && !p.data.payouts.length ? <div className="p-5"><Empty>No payouts yet.</Empty></div> : null}
        <ul className="divide-y divide-rule text-sm">
          {(p.data?.payouts ?? []).map((x) => (
            <li key={x.batchRef} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span>
                {x.batchRef} · {date(x.createdAt)}
              </span>
              <span>
                {money(x.amountMinor, x.currency)} · {x.state.replace(/_/g, " ")}
                {x.reference ? ` · ref ${x.reference}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </Wrap>
  );
}

export function LivePartnerSettings() {
  const p = useApi<Payouts>("/api/affiliate/payouts");
  return (
    <Wrap>
      <PageHead title="Settings" />
      <DestinationPanel data={p.data} onSaved={p.reload} />
    </Wrap>
  );
}

function DestinationPanel({ data, onSaved }: { data: Payouts | null; onSaved: () => void }) {
  const [method, setMethod] = useState("bank_transfer");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/affiliate/payout-destination", { method: "PUT", body: { method, displayHint: hint } });
      setMsg("Saved. Our finance team verifies new payout details; transfers resume 48 hours after a change.");
      setHint("");
      onSaved();
    } catch (er) {
      setMsg(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Payout details">
      {data?.destination ? (
        <p className="mb-3 text-sm">
          {data.destination.method.replace("_", " ")} · {data.destination.hint} ·{" "}
          {data.destination.verified ? <Badge tone="success" surface="light">Verified</Badge> : <Badge tone="attention" surface="light">Awaiting verification</Badge>}
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted-dark">No payout details yet.</p>
      )}
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 font-normal">
            <option value="bank_transfer">Bank transfer</option>
            <option value="paypal">PayPal</option>
            <option value="wise">Wise</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Account hint (no full numbers)
          <input required minLength={2} maxLength={60} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. IBAN ending 4821" className="h-10 w-64 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 font-normal" />
        </label>
        <Button type="submit" busy={busy}>
          Save
        </Button>
      </form>
      {msg ? <p className="mt-2 text-sm text-muted-dark">{msg}</p> : null}
      <p className="mt-3 text-xs text-muted-dark">Full account details are collected securely by our finance team when verifying — never type them here.</p>
    </Panel>
  );
}

// ------------------------------------------------------------------ apply

export function LiveApplyForm() {
  const acct = useAccount();
  const o = useApi<Overview>(acct.me ? "/api/affiliate/overview" : null, [acct.me?.id]);
  const [form, setForm] = useState({ name: "", country: "", channel: "", niche: "", method: "", terms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!acct.hydrated) return <p className="text-muted">Loading…</p>;
  if (!acct.me)
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-surface p-6">
        <p className="text-ink">Sign in or create an account to apply. Partners use their normal Genlixs account.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/sign-in?next=/partners/apply">Sign in</ButtonLink>
          <ButtonLink href="/sign-in?mode=sign-up&next=/partners/apply" variant="secondary">
            Create an account
          </ButtonLink>
        </div>
      </div>
    );
  const m = o.data?.membership;
  if (m)
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-surface p-6">
        <p className="font-semibold text-ink">{STATE[m.state] ?? m.state}</p>
        <p className="mt-1 text-sm text-muted">
          {m.state === "active" ? "You are an approved partner." : m.state === "applied" ? "We review applications by hand and reply by email." : "Contact partner support for details."}
        </p>
        <Link href="/partner" className="mt-3 inline-block font-semibold text-link hover:underline">
          Open the partner portal
        </Link>
      </div>
    );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/affiliate/applications", {
        body: { name: form.name, country: form.country, channels: [form.channel], niche: form.niche, method: form.method, termsAccepted: form.terms },
      });
      o.reload();
    } catch (er) {
      setError(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };
  const field = "mt-1.5 block h-12 w-full rounded-2xl border border-line-strong bg-raised px-3.5 text-base text-ink";
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      {!acct.me.emailVerified ? <p className="text-sm text-orange-on-dark">Confirm your email address before applying.</p> : null}
      <label className="block text-sm font-semibold">
        Name or brand
        <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Country
        <input required maxLength={60} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Main channel link
        <input required type="url" maxLength={200} placeholder="https://" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-semibold">
        Main topic
        <input maxLength={120} value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-semibold">
        How would you promote Genlixs?
        <textarea maxLength={600} rows={4} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="mt-1.5 block w-full rounded-2xl border border-line-strong bg-raised px-3.5 py-2 text-base text-ink" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} className="mt-1 size-4 accent-brand-blue" />
        <span>I accept the partner program terms shown on the partner page.</span>
      </label>
      <Button type="submit" size="lg" busy={busy}>
        Submit application
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-error-on-dark">
          {error}
        </p>
      ) : null}
    </form>
  );
}
