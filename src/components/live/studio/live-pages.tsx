"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Clapperboard, ImagePlus, Star, Trash2, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TOOLS, TOOL_ORDER } from "@/lib/catalog";
import { api, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { STATE_LABEL, money, units, type Catalog, type Job, type Product } from "@/lib/live/types";
import { cn, fmtCredits, fmtNum } from "@/lib/format";
import { LiveJobPanel } from "./live-workspace";
import { DownloadButton, OutputPreview } from "./media";

const ICON = { image: ImagePlus, edit: WandSparkles, video: Clapperboard };
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

function Page({ title, sub, children, actions }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] leading-tight font-extrabold">{title}</h1>
          {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}

function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-white/[0.08] bg-surface p-4 sm:p-5">
      {title ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-2xl border border-dashed border-line-strong p-5 text-center text-sm text-muted">{children}</p>;
const Err = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-sm text-error-on-dark">
    {children}
  </p>
);

// ------------------------------------------------------------------ overview

export function LiveOverview() {
  const acct = useAccount();
  const jobs = useApi<Job[]>("/api/generations?limit=6");
  const catalog = useApi<Catalog>("/api/catalog");
  const openTools = new Set((catalog.data?.models ?? []).filter((m) => m.priced && (m.state === "enabled" || m.state === "experimental")).map((m) => m.tool));
  return (
    <Page title={acct.me?.displayName ? `Welcome back, ${acct.me.displayName}` : "Your studio"} sub="Create, find your files and manage credits.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-muted">Available credits</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular">{fmtNum(units(acct.wallet?.availableUnits))}</p>
          <p className="mt-1 text-xs text-muted">{fmtNum(units(acct.wallet?.reservedUnits))} reserved for running jobs</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Used this month</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular">{fmtNum(units(acct.wallet?.periodSpentUnits))}</p>
          <p className="mt-1 text-xs text-muted">Charged only for saved files</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Next expiry</p>
          <p className="font-display mt-1 text-xl font-extrabold">
            {acct.wallet?.nearestExpiry ? `${fmtNum(units(acct.wallet.nearestExpiry.units))} on ${date(acct.wallet.nearestExpiry.at)}` : "None"}
          </p>
          <Link href="/studio/credits" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
            Credits and statement <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      </div>
      <Card title="Start something new">
        <div className="grid gap-3 sm:grid-cols-3">
          {TOOL_ORDER.map((id) => {
            const Icon = ICON[id];
            const open = openTools.has(id);
            return (
              <Link key={id} href={TOOLS[id].href} className="rounded-2xl border border-white/[0.08] bg-raised p-4 hover:border-white/25">
                <Icon aria-hidden className="size-5 text-brand-blue-bright" />
                <p className="mt-2 font-semibold text-ink">{TOOLS[id].label}</p>
                <p className="text-xs text-muted">{catalog.loading ? "Checking availability…" : open ? TOOLS[id].summary : "Not available yet"}</p>
              </Link>
            );
          })}
        </div>
      </Card>
      <Card title="Recent jobs" action={<ButtonLink href="/studio/library" variant="ghost" size="sm">Library</ButtonLink>}>
        {jobs.error ? <Err>{jobs.error.message}</Err> : null}
        {jobs.data && !jobs.data.length ? <Empty>No jobs yet. Pick a tool above to start.</Empty> : null}
        <ul className="divide-y divide-white/[0.06]">
          {(jobs.data ?? []).map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <Link href={`/studio/library?job=${j.id}`} className="min-w-0 truncate font-medium text-ink hover:underline">
                {j.title}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {j.ref} · {STATE_LABEL[j.state] ?? j.state}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

// ------------------------------------------------------------------- library

export function LiveLibrary() {
  const params = useSearchParams();
  const [tool, setTool] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [favorites, setFavorites] = useState(false);
  const [pages, setPages] = useState<Job[][]>([]);
  const [selected, setSelected] = useState<string | null>(params.get("job"));
  const qs = new URLSearchParams({ limit: "24", ...(tool ? { tool } : {}), ...(state ? { state } : {}), ...(favorites ? { favorites: "1" } : {}) });
  const first = useApi<Job[]>(`/api/generations?${qs}`);
  const [more, setMore] = useState<{ busy: boolean; done: boolean }>({ busy: false, done: false });
  const all = [...(first.data ?? []), ...pages.flat()];

  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last) return;
    setMore({ busy: true, done: false });
    const next = await api<Job[]>(`/api/generations?${qs}&before=${encodeURIComponent(last.createdAt)}`).catch(() => []);
    setPages((p) => [...p, next]);
    setMore({ busy: false, done: next.length < 24 });
  };
  const resetPaging = () => {
    setPages([]);
    setMore({ busy: false, done: false });
  };

  return (
    <Page title="Library" sub="Every job you started, with its saved files. Files are kept for 90 days.">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Tool" value={tool} onChange={(e) => (setTool(e.target.value), resetPaging())} className="h-10 rounded-full border border-line-strong bg-raised px-3 text-sm">
          <option value="">All tools</option>
          {TOOL_ORDER.map((t) => (
            <option key={t} value={t}>
              {TOOLS[t].label}
            </option>
          ))}
        </select>
        <select aria-label="State" value={state} onChange={(e) => (setState(e.target.value), resetPaging())} className="h-10 rounded-full border border-line-strong bg-raised px-3 text-sm">
          <option value="">Any state</option>
          <option value="ready">Ready</option>
          <option value="running">Running</option>
          <option value="failed">Failed or cancelled</option>
        </select>
        <label className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-raised px-3 text-sm">
          <input type="checkbox" checked={favorites} onChange={(e) => (setFavorites(e.target.checked), resetPaging())} className="accent-brand-blue" /> Favourites
        </label>
      </div>
      {selected ? (
        <Card title="Job details" action={<Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>}>
          <LibraryDetail jobId={selected} onChanged={first.reload} />
        </Card>
      ) : null}
      {first.error ? <Err>{first.error.message}</Err> : null}
      {first.data && !all.length ? <Empty>Nothing here yet.</Empty> : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((j) => (
          <li key={j.id}>
            <button
              type="button"
              onClick={() => setSelected(j.id)}
              aria-current={selected === j.id ? "true" : undefined}
              className={cn("w-full rounded-2xl border bg-surface p-4 text-left", selected === j.id ? "border-brand-blue-bright" : "border-white/[0.08] hover:border-white/25")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-ink">{j.title}</span>
                {j.favorite ? <Star aria-label="Favourite" className="size-4 shrink-0 fill-brand-lime text-brand-lime" /> : null}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {TOOLS[j.tool].label} · {j.ref} · {date(j.createdAt)}
              </span>
              <span className="mt-2 block">
                <Badge tone={j.state === "succeeded" ? "success" : j.state === "failed" ? "error" : j.state === "cancelled" ? "neutral" : "info"}>
                  {STATE_LABEL[j.state] ?? j.state}
                </Badge>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {all.length >= 24 && !more.done ? (
        <div className="text-center">
          <Button variant="secondary" busy={more.busy} onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </Page>
  );
}

function LibraryDetail({ jobId, onChanged }: { jobId: string; onChanged: () => void }) {
  const job = useApi<Job>(`/api/generations/${jobId}`);
  const [share, setShare] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      job.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (!job.data) return job.error ? <Err>{job.error.message}</Err> : <p className="text-sm text-muted">Loading…</p>;
  const j = job.data;
  if (j.state !== "succeeded") return <LiveJobPanel jobId={jobId} onSettled={onChanged} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">“{j.prompt}”</p>
      {j.outputs.map((o) => (
        <div key={o.assetId} className="space-y-3">
          <OutputPreview output={o} alt={j.title} />
          <div className="flex flex-wrap items-start gap-2">
            <DownloadButton assetId={o.assetId} />
            <Button
              variant="secondary"
              busy={busy === "share"}
              onClick={() => act("share", async () => setShare(await api(`/api/assets/${o.assetId}/shares`, { body: { expiresInDays: 7 } })))}
            >
              Create share link
            </Button>
            <Button variant="ghost" busy={busy === "fav"} icon={<Star aria-hidden className="size-4" />} onClick={() => act("fav", () => api(`/api/generations/${j.id}`, { method: "PATCH", body: { favorite: !j.favorite } }))}>
              {j.favorite ? "Remove favourite" : "Favourite"}
            </Button>
            <Button
              variant="ghost"
              busy={busy === "del"}
              icon={<Trash2 aria-hidden className="size-4" />}
              onClick={() => {
                if (window.confirm("Delete this file? Access ends now and it cannot be recovered.")) void act("del", () => api(`/api/assets/${o.assetId}`, { method: "DELETE" }));
              }}
            >
              Delete file
            </Button>
          </div>
        </div>
      ))}
      {share ? (
        <div className="rounded-2xl border border-white/10 bg-raised p-3 text-sm">
          <p className="text-muted">Anyone with this link can view the file until {date(share.expiresAt)}. It is shown only once.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-canvas px-2 py-1.5 text-xs">{share.url}</code>
            <CopyButton value={share.url} />
          </div>
        </div>
      ) : null}
      {error ? <Err>{error}</Err> : null}
      <p className="text-xs text-muted">
        {j.ref} · {j.modelName} · {fmtCredits(units(j.units))} charged · kept until {date(j.outputs[0]?.retentionUntil)}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- credits

type StatementRow = { eventKey: string; type: string; at: string; available: string; reserved: string; spent: string; expired: string; revoked: string; jobRef: string | null; note: string | null };

export function LiveCredits() {
  const acct = useAccount();
  const products = useApi<Product[]>("/api/plans");
  const statement = useApi<StatementRow[]>("/api/wallet/ledger?limit=50");
  const packs = (products.data ?? []).filter((p) => p.kind === "credit_pack");
  return (
    <Page title="Credits" sub="Credits are reserved when a job starts and charged only when its file is saved.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-muted">Available</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular">{fmtNum(units(acct.wallet?.availableUnits))}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Reserved</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular">{fmtNum(units(acct.wallet?.reservedUnits))}</p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Charged in total</p>
          <p className="font-display mt-1 text-3xl font-extrabold tabular">{fmtNum(units(acct.wallet?.spentUnits))}</p>
        </Card>
      </div>
      <Card title="Buy credits">
        {products.error ? <Err>{products.error.message}</Err> : null}
        {products.data && !packs.length ? <Empty>Credit packs are not on sale yet. Prices are published after final checks.</Empty> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          {packs.map((p) => (
            <CheckoutCard key={p.key} product={p} />
          ))}
        </div>
      </Card>
      <Card title="Credit lots">
        {acct.wallet && !acct.wallet.lots.length ? <Empty>No credits yet.</Empty> : null}
        <ul className="divide-y divide-white/[0.06] text-sm">
          {(acct.wallet?.lots ?? []).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="font-medium text-ink capitalize">{l.kind.replace("_", " ")}</span>
              <span className="text-muted tabular">
                {fmtNum(units(l.availableUnits))} of {fmtNum(units(l.grantedUnits))} left{l.expiresAt ? ` · expires ${date(l.expiresAt)}` : ""}
                {l.restricted ? " · on hold" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Statement">
        {statement.error ? <Err>{statement.error.message}</Err> : null}
        {statement.data && !statement.data.length ? <Empty>No credit activity yet.</Empty> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Event</th>
                <th className="py-2 font-medium">Reference</th>
                <th className="py-2 text-right font-medium">Available</th>
                <th className="py-2 text-right font-medium">Reserved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {(statement.data ?? []).map((r) => (
                <tr key={r.eventKey}>
                  <td className="py-2 text-muted">{date(r.at)}</td>
                  <td className="py-2 capitalize">{r.type.replace(/_/g, " ")}</td>
                  <td className="py-2 text-muted">{r.jobRef ?? r.note ?? "—"}</td>
                  <td className="py-2 text-right tabular">{signed(r.available)}</td>
                  <td className="py-2 text-right tabular">{signed(r.reserved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

const signed = (v: string) => {
  const n = units(v);
  return n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : "0";
};

function CheckoutCard({ product }: { product: Product }) {
  const [key] = useState(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ checkoutUrl: string }>("/api/billing/checkout", { body: { productKey: product.key }, idempotencyKey: key });
      window.location.assign(r.checkoutUrl);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-raised p-4">
      <p className="font-semibold text-ink">{product.name}</p>
      <p className="font-display mt-1 text-2xl font-extrabold">{money(product.amountMinor, product.currency)}</p>
      <p className="text-sm text-muted">
        {fmtCredits(units(product.credits))}
        {product.creditExpiryDays ? ` · valid ${product.creditExpiryDays} days` : ""}
      </p>
      <Button className="mt-3 w-full" busy={busy} onClick={buy}>
        Buy
      </Button>
      {error ? <p className="mt-2 text-sm text-error-on-dark">{error}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------- billing

type Overview = {
  paymentsAvailable: boolean;
  orders: { id: string; ref: string; product: string; amountMinor: string; currency: string; credits: string; state: string; createdAt: string; paidAt: string | null }[];
  subscription: { status: string; product: string; credits: string; amountMinor: string; currency: string; periodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
};

const ORDER_STATE: Record<string, string> = {
  pending: "Started",
  checkout_created: "Awaiting payment",
  paid: "Paid — credits added",
  failed: "Payment failed",
  refund_pending: "Refund in progress",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  disputed: "Disputed",
};

export function LiveBilling() {
  const params = useSearchParams();
  const o = useApi<Overview>("/api/billing/overview");
  const returned = params.get("order");
  return (
    <Page title="Billing" sub="Your payments and plan. Credits are added only after the payment is confirmed by the payment provider.">
      {returned ? (
        <p role="status" className="rounded-2xl border border-white/10 bg-surface p-3 text-sm text-muted">
          {params.get("cancelled") ? "Checkout was cancelled. Nothing was charged." : "Thanks — we add your credits as soon as the payment provider confirms the payment. This page updates on refresh."}
        </p>
      ) : null}
      {o.error ? <Err>{o.error.message}</Err> : null}
      {o.data && !o.data.paymentsAvailable ? <Empty>Payments are not available yet. We will announce when credit packs and plans go on sale.</Empty> : null}
      <Card title="Plan">
        {o.data?.subscription ? (
          <p className="text-sm">
            <span className="font-semibold text-ink">{o.data.subscription.product}</span> · {o.data.subscription.status.replace(/_/g, " ")} ·{" "}
            {fmtCredits(units(o.data.subscription.credits))} per cycle
            {o.data.subscription.periodEnd ? ` · renews ${date(o.data.subscription.periodEnd)}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted">No plan. You can buy credit packs from Credits.</p>
        )}
      </Card>
      <Card title="Payments">
        {o.data && !o.data.orders.length ? <Empty>No payments yet.</Empty> : null}
        <ul className="divide-y divide-white/[0.06] text-sm">
          {(o.data?.orders ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className="font-medium text-ink">{r.product}</span> <span className="text-muted">· {r.ref} · {date(r.createdAt)}</span>
              </span>
              <span className="text-muted">
                {money(r.amountMinor, r.currency)} · {ORDER_STATE[r.state] ?? r.state}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

// ------------------------------------------------------------------- support

type Ticket = { id: string; ref: string; subject: string; category: string; status: string; jobRef: string | null; updatedAt: string; messages: { role: string; body: string; at: string }[] };

export function LiveSupport() {
  const tickets = useApi<Ticket[]>("/api/support/tickets");
  const [form, setForm] = useState({ subject: "", category: "generation", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ref?: string }>("/api/support/tickets", { body: form });
      setSent(r.ref ?? "sent");
      setForm({ subject: "", category: "generation", body: "" });
      tickets.reload();
    } catch (er) {
      setError(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="Support" sub="Ask about a job, a payment or your account. Replies appear here.">
      <Card title="New request">
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            Subject
            <input required minLength={3} maxLength={140} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="h-11 rounded-2xl border border-line-strong bg-raised px-3 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Topic
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-11 rounded-2xl border border-line-strong bg-raised px-3 font-normal">
              <option value="generation">A generation</option>
              <option value="billing">Billing or credits</option>
              <option value="account">My account</option>
              <option value="partner">Partner programme</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Message
            <textarea required maxLength={5000} rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="rounded-2xl border border-line-strong bg-raised px-3 py-2 font-normal" />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" busy={busy}>
              Send request
            </Button>
            {sent ? <span role="status" className="text-sm text-muted">Request {sent !== "sent" ? sent : ""} received.</span> : null}
          </div>
          {error ? <Err>{error}</Err> : null}
        </form>
      </Card>
      <Card title="Your requests">
        {tickets.data && !tickets.data.length ? <Empty>No requests yet.</Empty> : null}
        <ul className="space-y-3">
          {(tickets.data ?? []).map((t) => (
            <li key={t.id}>
              <TicketThread ticket={t} onReplied={tickets.reload} />
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function TicketThread({ ticket, onReplied }: { ticket: Ticket; onReplied: () => void }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="rounded-2xl border border-white/[0.08] bg-raised p-3">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-ink">
          {ticket.subject} <span className="font-normal text-muted">· {ticket.ref}</span>
        </span>
        <Badge tone={ticket.status === "resolved" ? "success" : ticket.status === "waiting_for_customer" ? "attention" : "info"}>{ticket.status.replace(/_/g, " ")}</Badge>
      </summary>
      <ol className="mt-3 space-y-2 text-sm">
        {ticket.messages.map((m, i) => (
          <li key={i} className={cn("rounded-xl p-2.5", m.role === "staff" ? "bg-[rgb(37_63_246/0.14)]" : "bg-surface")}>
            <p className="text-xs text-muted">
              {m.role === "staff" ? "Genlixs support" : "You"} · {date(m.at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-ink">{m.body}</p>
          </li>
        ))}
      </ol>
      {ticket.status !== "resolved" ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api(`/api/support/tickets/${ticket.id}/messages`, { body: { body: reply } });
              setReply("");
              onReplied();
            } catch (er) {
              setError(errorMessage(er));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="sr-only" htmlFor={`r-${ticket.id}`}>
            Reply
          </label>
          <input id={`r-${ticket.id}`} required value={reply} onChange={(e) => setReply(e.target.value)} className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-surface px-3 text-sm" placeholder="Add a reply" />
          <Button type="submit" size="sm" className="h-10" busy={busy}>
            Send
          </Button>
        </form>
      ) : null}
      {error ? <Err>{error}</Err> : null}
    </details>
  );
}
