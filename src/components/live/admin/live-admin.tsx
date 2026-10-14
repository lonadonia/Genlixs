"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHead, Panel, StatTile } from "@/components/console/parts";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { api, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useAccount, useApi } from "@/lib/live/account";
import { STATE_LABEL, money } from "@/lib/live/types";
import { fmtNum } from "@/lib/format";

/* Live admin console (§19.3). Every action goes to an allowlisted, audited RPC that re-checks the staff capability. */

type AdminMe = { userId: string; email: string; roles: string[]; capabilities: string[] };
type Row = Record<string, unknown>;

const Wrap = ({ children }: { children: ReactNode }) => <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">{children}</div>;
const Err = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-sm text-error-text">
    {children}
  </p>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-rule-strong p-5 text-center text-sm text-muted-dark">{children}</p>;
const when = (iso: unknown) => (typeof iso === "string" ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function useAdminMe() {
  const acct = useAccount();
  return useApi<AdminMe>(acct.me ? "/api/admin/me" : null, [acct.me?.id]);
}

export function LiveAdminBadge() {
  const me = useAdminMe();
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(225_255_1/0.35)] bg-[rgb(225_255_1/0.08)] px-2.5 py-1 text-xs font-semibold text-brand-lime">
      <ShieldCheck aria-hidden className="size-3.5" /> Admin · {me.data?.roles.join(", ") || "—"}
    </p>
  );
}

export function LiveAdminGate({ children }: { children: ReactNode }) {
  const acct = useAccount();
  const me = useAdminMe();
  if (!acct.hydrated || (acct.me && me.loading && !me.data)) return <Wrap>Loading…</Wrap>;
  if (!acct.me)
    return (
      <Wrap>
        <Panel title="Staff sign-in required">
          <ButtonLink href="/sign-in?next=/admin">Sign in</ButtonLink>
        </Panel>
      </Wrap>
    );
  if (!me.data?.capabilities.includes("admin.access"))
    return (
      <Wrap>
        <Panel title="No staff access">
          <p className="text-sm text-muted-dark">This account has no admin role. Roles are granted by the owner and recorded in the audit log.</p>
        </Panel>
      </Wrap>
    );
  return <>{children}</>;
}

/** Action with a mandatory reason; posts once, shows the server answer, then refreshes. */
export function ReasonAction({
  label,
  path,
  body = {},
  onDone,
  variant = "secondary-light",
  extra,
  needsReason = true,
  idempotent,
}: {
  label: string;
  path: string;
  body?: Record<string, unknown>;
  onDone?: () => void;
  variant?: "primary" | "secondary-light" | "danger";
  extra?: { name: string; label: string; placeholder?: string }[];
  needsReason?: boolean;
  idempotent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [key] = useState(() => newIdempotencyKey());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, parseField(k, v)]));
      await api(path, { body: { ...body, ...parsed }, idempotencyKey: idempotent ? key : undefined });
      setOpen(false);
      setValues({});
      onDone?.();
    } catch (er) {
      setMsg(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-rule bg-paper p-3">
      {(extra ?? []).map((f) => (
        <label key={f.name} className="grid gap-1 text-xs font-semibold">
          {f.label}
          <input required value={values[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className="h-9 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal" />
        </label>
      ))}
      {needsReason ? (
        <label className="grid min-w-56 flex-1 gap-1 text-xs font-semibold">
          Reason (recorded in the audit log)
          <input required minLength={3} value={values.reason ?? ""} onChange={(e) => setValues({ ...values, reason: e.target.value })} className="h-9 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal" />
        </label>
      ) : null}
      <Button type="submit" size="sm" variant={variant === "danger" ? "danger" : "primary"} busy={busy}>
        Confirm {label.toLowerCase()}
      </Button>
      <Button size="sm" variant="ghost-light" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {msg ? <p className="w-full text-sm text-error-text">{msg}</p> : null}
    </form>
  );
}

/** Numeric fields become numbers and setting values are JSON; everything else stays text. */
function parseField(name: string, v: string): unknown {
  if ((name === "units" || name === "amountMinor") && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  if (name === "value") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function Table({ cols, rows, empty }: { cols: { key: string; label: string; render?: (r: Row) => ReactNode; right?: boolean }[]; rows: Row[] | null; empty: string }) {
  if (rows && !rows.length) return <div className="p-5"><Empty>{empty}</Empty></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-paper text-xs text-muted-dark">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.right ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {(rows ?? []).map((r, i) => (
            <tr key={String(r.id ?? r.userId ?? i)} className="align-top">
              {cols.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 ${c.right ? "text-right tabular" : ""}`}>
                  {c.render ? c.render(r) : str(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const jobTone = (s: unknown): Tone =>
  s === "succeeded" ? "success" : s === "failed" ? "error" : s === "cancelled" ? "neutral" : ["review_required", "submission_unknown", "processing_delayed"].includes(String(s)) ? "attention" : "info";

// ------------------------------------------------------------------ overview

type Overview = {
  service: { generationPaused: boolean; watchdogHeartbeat: string | null; queues: { queue: string; length: number; oldestSeconds: number | null }[]; oldestDueWorkSeconds: number | null; deadLetters: number; providerBalance: { value: number | null; observedAt: string | null; paused: boolean } | null; models: { id: string; state: string; verifiedAt: string | null }[] };
  jobs24h: { total: number; succeeded: number; failed: number; running: number; delayed: number; unknownSubmissions: number; reviewRequired: number; p50Seconds: number | null; p95Seconds: number | null };
  actionQueue: Record<string, number>;
  finance: null | { collected30d: Record<string, string>; refunded30d: Record<string, string>; commissionsOutstanding: Record<string, string>; commissionsPaid: Record<string, string>; supplierCredits30d: { measured: number; unknownCount: number }; creditsConsumed30d: string; note: string };
  recentActivity: { action: string; targetKind: string; targetId: string; reason: string | null; at: string }[];
};

const moneyMap = (m: Record<string, string> | undefined) => (m && Object.keys(m).length ? Object.entries(m).map(([c, v]) => money(v, c)).join(" · ") : "—");

export function LiveAdminOverview() {
  const o = useApi<Overview>("/api/admin/overview");
  const rec = useApi<Record<string, unknown[]>>("/api/admin/reconciliation");
  if (o.error) return <Wrap><Err>{o.error.message}</Err></Wrap>;
  const d = o.data;
  const recIssues = rec.data ? Object.values(rec.data).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0) : null;
  return (
    <Wrap>
      <PageHead title="Operations overview" sub={d ? `Updated ${when(new Date().toISOString())}` : "Loading…"} actions={<Button variant="secondary-light" size="sm" onClick={o.reload}>Refresh</Button>} />
      {d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Jobs (24 h)" value={fmtNum(d.jobs24h.total)} sub={`${d.jobs24h.succeeded} ready · ${d.jobs24h.failed} failed · ${d.jobs24h.running} running`} href="/admin/jobs" />
            <StatTile label="Needs attention" value={fmtNum(d.actionQueue.reviewJobs ?? 0)} sub="Unknown submissions and reviews" href="/admin/jobs?state=attention" />
            <StatTile label="Oldest due work" value={d.service.oldestDueWorkSeconds ? `${d.service.oldestDueWorkSeconds}s` : "None"} sub={`${d.service.deadLetters} dead letters`} />
            <StatTile
              label="Provider balance"
              value={d.service.providerBalance?.value !== null && d.service.providerBalance?.value !== undefined ? fmtNum(d.service.providerBalance.value) : "Unknown"}
              sub={d.service.providerBalance?.observedAt ? `Observed ${when(d.service.providerBalance.observedAt)}` : "No observation yet"}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Service">
              <ul className="space-y-1.5 text-sm">
                <li>Intake: {d.service.generationPaused ? <Badge tone="attention" surface="light">Paused</Badge> : <Badge tone="success" surface="light">Open</Badge>}</li>
                <li>Watchdog heartbeat: {when(d.service.watchdogHeartbeat)}</li>
                {d.service.queues.map((q) => (
                  <li key={q.queue}>
                    Queue {q.queue}: {q.length} waiting{q.oldestSeconds ? ` · oldest ${q.oldestSeconds}s` : ""}
                  </li>
                ))}
                <li>Models: {d.service.models.map((m) => `${m.id} (${m.state})`).join(", ")}</li>
                <li>Wallet reconciliation: {recIssues === null ? (rec.error ? "not permitted for this role" : "checking…") : recIssues === 0 ? "no mismatches" : `${recIssues} issue(s) — investigate`}</li>
              </ul>
            </Panel>
            <Panel title="Action queue">
              <ul className="space-y-1.5 text-sm">
                <li><Link className="text-info-text hover:underline" href="/admin/jobs?state=attention">Jobs to review: {d.actionQueue.reviewJobs}</Link></li>
                <li><Link className="text-info-text hover:underline" href="/admin/affiliates?state=applied">Partner applications: {d.actionQueue.pendingAffiliateApplications}</Link></li>
                <li><Link className="text-info-text hover:underline" href="/admin/support">Open support requests: {d.actionQueue.openTickets}</Link></li>
                <li>Billing receipts waiting / failed: {d.actionQueue.unprocessedBillingReceipts} / {d.actionQueue.failedBillingReceipts}</li>
                <li><Link className="text-info-text hover:underline" href="/admin/payouts">Open payout batches: {d.actionQueue.payoutBatchesOpen}</Link></li>
              </ul>
            </Panel>
          </div>
          {d.finance ? (
            <Panel title="Finance (30 days)">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <dt className="text-muted-dark">Collected</dt>
                <dd>{moneyMap(d.finance.collected30d)}</dd>
                <dt className="text-muted-dark">Refunded</dt>
                <dd>{moneyMap(d.finance.refunded30d)}</dd>
                <dt className="text-muted-dark">Commissions outstanding / paid</dt>
                <dd>
                  {moneyMap(d.finance.commissionsOutstanding)} / {moneyMap(d.finance.commissionsPaid)}
                </dd>
                <dt className="text-muted-dark">Supplier credits measured</dt>
                <dd>
                  {fmtNum(d.finance.supplierCredits30d.measured)} ({d.finance.supplierCredits30d.unknownCount} jobs without measurement)
                </dd>
                <dt className="text-muted-dark">Customer credits consumed</dt>
                <dd>{fmtNum(Number(d.finance.creditsConsumed30d))}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-dark">{d.finance.note}</p>
            </Panel>
          ) : null}
          <Panel title="Recent staff activity">
            {d.recentActivity.length ? (
              <ul className="space-y-1 text-sm">
                {d.recentActivity.map((a, i) => (
                  <li key={i}>
                    {when(a.at)} · {a.action} · {a.targetKind} {a.targetId} {a.reason ? `— ${a.reason}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No staff actions yet.</Empty>
            )}
          </Panel>
        </>
      ) : null}
    </Wrap>
  );
}

// ---------------------------------------------------------------------- jobs

export function LiveAdminJobs() {
  const sp = useSearchParams();
  const router = useRouter();
  const state = sp.get("state") ?? "";
  const q = sp.get("q") ?? "";
  const params = new URLSearchParams({ limit: "100", ...(state ? { state } : {}), ...(q ? { q } : {}) });
  const jobs = useApi<Row[]>(`/api/admin/jobs?${params}`);
  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    router.replace(`/admin/jobs?${n}`);
  };
  return (
    <Wrap>
      <PageHead title="Jobs" sub="Newest first. Search by job reference, provider task id or customer email." />
      <div className="flex flex-wrap gap-2">
        <select aria-label="State" value={state} onChange={(e) => setFilter("state", e.target.value)} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-2 text-sm">
          <option value="">All states</option>
          <option value="attention">Needs attention</option>
          {Object.keys(STATE_LABEL).map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
          }}
        >
          <input name="q" defaultValue={q} aria-label="Search" placeholder="Reference, task id or email" className="h-10 w-72 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-sm" />
        </form>
      </div>
      <Panel bodyClass="p-0">
        {jobs.error ? <div className="p-5"><Err>{jobs.error.message}</Err></div> : null}
        <Table
          rows={jobs.data}
          empty="No jobs match."
          cols={[
            { key: "ref", label: "Job", render: (r) => <Link className="font-semibold text-info-text hover:underline" href={`/admin/jobs/${r.id}`}>{str(r.ref)}</Link> },
            { key: "customer", label: "Customer" },
            { key: "modelId", label: "Model" },
            { key: "state", label: "State", render: (r) => <Badge tone={jobTone(r.state)} surface="light">{STATE_LABEL[String(r.state)] ?? str(r.state)}</Badge> },
            { key: "settlementState", label: "Credits" },
            { key: "units", label: "Units", right: true },
            { key: "waitSeconds", label: "Age (s)", right: true },
            { key: "createdAt", label: "Created", render: (r) => when(r.createdAt) },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

type JobDetail = {
  job: Row & { ref: string; state: string; settlementState: string; units: string; title: string; prompt?: string; outputs: Row[]; events: Row[] };
  customer: { userId: string; email: string; status: string } | null;
  reservation: Row | null;
  attempts: Row[];
  observations: Row[];
  work: Row[];
  canOperate: boolean;
};

export function LiveAdminJobDetail({ id }: { id: string }) {
  const d = useApi<JobDetail>(`/api/admin/jobs/${encodeURIComponent(id)}`);
  if (d.error) return <Wrap><Err>{d.error.message}</Err></Wrap>;
  if (!d.data) return <Wrap>Loading…</Wrap>;
  const { job } = d.data;
  const terminal = ["succeeded", "failed", "cancelled"].includes(job.state);
  const jobId = String(job.id);
  return (
    <Wrap>
      <PageHead
        title={`Job ${job.ref}`}
        sub={<Badge tone={jobTone(job.state)} surface="light">{STATE_LABEL[job.state] ?? job.state}</Badge>}
        actions={<ButtonLink href="/admin/jobs" variant="secondary-light" size="sm">All jobs</ButtonLink>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Summary">
          <dl className="grid grid-cols-[10rem_1fr] gap-1.5 text-sm">
            <dt className="text-muted-dark">Customer</dt>
            <dd>{d.data.customer ? `${d.data.customer.email} (${d.data.customer.status})` : "—"}</dd>
            <dt className="text-muted-dark">Model</dt>
            <dd>{str(job.modelId)}</dd>
            <dt className="text-muted-dark">Units</dt>
            <dd>{job.units} · {job.settlementState}</dd>
            <dt className="text-muted-dark">Reservation</dt>
            <dd>{d.data.reservation ? `${str(d.data.reservation.state)}${d.data.reservation.reason ? ` — ${str(d.data.reservation.reason)}` : ""}` : "—"}</dd>
            <dt className="text-muted-dark">Failure</dt>
            <dd>{str(job.failureCode)}</dd>
            <dt className="text-muted-dark">Prompt</dt>
            <dd className="whitespace-pre-wrap">{job.prompt ?? "Restricted to operators"}</dd>
          </dl>
        </Panel>
        <Panel title="Operations">
          {d.data.canOperate && !terminal ? (
            <div className="flex flex-wrap gap-2">
              <ReasonAction label="Recheck status" path={`/api/admin/jobs/${jobId}/recheck`} onDone={d.reload} />
              {["importing", "review_required"].includes(job.state) ? <ReasonAction label="Retry import" path={`/api/admin/jobs/${jobId}/retry_import`} onDone={d.reload} /> : null}
              {["submission_unknown", "review_required"].includes(job.state) ? (
                <ReasonAction label="Attach verified task" path={`/api/admin/jobs/${jobId}/attach_task`} extra={[{ name: "taskId", label: "Provider task id" }]} onDone={d.reload} />
              ) : null}
              <ReasonAction label="Release credits (no delivery)" variant="danger" path={`/api/admin/jobs/${jobId}/release`} onDone={d.reload} />
            </div>
          ) : (
            <p className="text-sm text-muted-dark">{terminal ? "This job is settled. Late provider results are kept as evidence only." : "Your role can view but not operate jobs."}</p>
          )}
          <p className="mt-3 text-xs text-muted-dark">An attached task id is verified against the stored attempt correlation before binding. None of these actions creates a new generation or a second charge.</p>
        </Panel>
      </div>
      <Panel title="Provider attempts" bodyClass="p-0">
        <Table rows={d.data.attempts} empty="No attempts yet." cols={[{ key: "ordinal", label: "#" }, { key: "state", label: "State" }, { key: "taskId", label: "Task id" }, { key: "errorCode", label: "Error" }, { key: "submittedAt", label: "Sent", render: (r) => when(r.submittedAt) }]} />
      </Panel>
      <Panel title="Status observations" bodyClass="p-0">
        <Table rows={d.data.observations} empty="No observations yet." cols={[{ key: "at", label: "When", render: (r) => when(r.at) }, { key: "source", label: "Source" }, { key: "state", label: "Provider state" }, { key: "normalized", label: "Normalized" }, { key: "creditsConsumed", label: "Supplier credits", right: true }, { key: "failCode", label: "Fail code" }]} />
      </Panel>
      <Panel title="Work items" bodyClass="p-0">
        <Table rows={d.data.work} empty="No work items." cols={[{ key: "kind", label: "Kind" }, { key: "state", label: "State" }, { key: "attempts", label: "Tries", right: true }, { key: "dueAt", label: "Due", render: (r) => when(r.dueAt) }, { key: "lastError", label: "Last error" }]} />
      </Panel>
      <Panel title="Customer-visible events">
        <ul className="space-y-1 text-sm">
          {job.events.map((e, i) => (
            <li key={i}>
              {when(e.at)} · {str(e.message)}
            </li>
          ))}
        </ul>
      </Panel>
    </Wrap>
  );
}

// --------------------------------------------------------------- customers

export function LiveAdminUsers() {
  const [q, setQ] = useState("");
  const users = useApi<Row[]>(`/api/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <Wrap>
      <PageHead title="Customers" sub="Account status and credit adjustments. Adjustments add a separate journal entry; history is never edited." />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(String(new FormData(e.currentTarget).get("q") ?? "").trim());
        }}
      >
        <input name="q" aria-label="Search customers" placeholder="Email starts with…" className="h-10 w-72 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-sm" />
      </form>
      <Panel bodyClass="p-0">
        {users.error ? <div className="p-5"><Err>{users.error.message}</Err></div> : null}
        <Table
          rows={users.data}
          empty="No customers yet."
          cols={[
            { key: "email", label: "Email" },
            { key: "status", label: "Status" },
            { key: "availableUnits", label: "Available", right: true },
            { key: "reservedUnits", label: "Reserved", right: true },
            { key: "jobs", label: "Jobs", right: true },
            { key: "plan", label: "Plan" },
            { key: "joinedAt", label: "Joined", render: (r) => when(r.joinedAt) },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <div className="flex max-w-md flex-wrap gap-2">
                  <ReasonAction
                    label={r.status === "suspended" ? "Reactivate" : "Suspend"}
                    variant={r.status === "suspended" ? "secondary-light" : "danger"}
                    path={`/api/admin/users/${r.userId}/status`}
                    body={{ status: r.status === "suspended" ? "active" : "suspended" }}
                    onDone={users.reload}
                  />
                  <ReasonAction
                    label="Adjust credits"
                    path="/api/admin/credits/adjustments"
                    body={{ userId: r.userId }}
                    extra={[
                      { name: "units", label: "Units (+/−)", placeholder: "e.g. 20 or -5" },
                      { name: "category", label: "Category", placeholder: "goodwill | correction | promotion | support" },
                    ]}
                    idempotent
                    onDone={users.reload}
                  />
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

// ---------------------------------------------------------------- payments

export function LiveAdminPayments() {
  const p = useApi<Row[]>("/api/admin/payments?limit=100");
  return (
    <Wrap>
      <PageHead title="Payments" sub="Orders, gateway references and refunds. Refunds go through the gateway and reverse unused credits and commissions." />
      <Panel bodyClass="p-0">
        {p.error ? <div className="p-5"><Err>{p.error.message}</Err></div> : null}
        <Table
          rows={p.data}
          empty="No payments yet."
          cols={[
            { key: "ref", label: "Order" },
            { key: "customer", label: "Customer" },
            { key: "product", label: "Product" },
            { key: "amountMinor", label: "Amount", right: true, render: (r) => money(String(r.amountMinor), String(r.currency)) },
            { key: "refundedMinor", label: "Refunded", right: true, render: (r) => money(String(r.refundedMinor), String(r.currency)) },
            { key: "state", label: "State" },
            { key: "gatewayPaymentId", label: "Gateway ref" },
            {
              key: "refund",
              label: "",
              render: (r) =>
                ["paid", "partially_refunded"].includes(String(r.state)) ? (
                  <ReasonAction label="Refund" variant="danger" path="/api/admin/billing/refunds" body={{ orderId: r.id }} extra={[{ name: "amountMinor", label: "Amount (minor units)" }]} idempotent onDone={p.reload} />
                ) : null,
            },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

// -------------------------------------------------------------- affiliates

export function LiveAdminAffiliates() {
  const sp = useSearchParams();
  const state = sp.get("state") ?? "";
  const a = useApi<Row[]>(`/api/admin/affiliates${state ? `?state=${state}` : ""}`);
  return (
    <Wrap>
      <PageHead title="Partners" sub="Applications, tiers and payout destinations. Approval requires a published agreement." />
      <Panel bodyClass="p-0">
        {a.error ? <div className="p-5"><Err>{a.error.message}</Err></div> : null}
        <Table
          rows={a.data}
          empty="No partners yet."
          cols={[
            { key: "email", label: "Account" },
            { key: "state", label: "State" },
            { key: "tier", label: "Tier" },
            { key: "qualifyingCustomers", label: "Paying customers", right: true },
            { key: "application", label: "Application", render: (r) => <code className="block max-w-xs truncate text-xs">{JSON.stringify(r.application)}</code> },
            {
              key: "destination",
              label: "Payout details",
              render: (r) => {
                const d = r.destination as { method: string; hint: string; verified: boolean } | null;
                return d ? `${d.method} · ${d.hint} · ${d.verified ? "verified" : "unverified"}` : "—";
              },
            },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <div className="flex max-w-md flex-wrap gap-2">
                  {r.state === "applied" || r.state === "rejected" ? <ReasonAction label="Approve" variant="primary" path={`/api/admin/affiliates/${r.id}/review`} body={{ decision: "approve" }} onDone={a.reload} /> : null}
                  {r.state === "applied" ? <ReasonAction label="Reject" variant="danger" path={`/api/admin/affiliates/${r.id}/review`} body={{ decision: "reject" }} onDone={a.reload} /> : null}
                  {r.state === "active" ? <ReasonAction label="Suspend" variant="danger" path={`/api/admin/affiliates/${r.id}/review`} body={{ decision: "suspend" }} onDone={a.reload} /> : null}
                  {r.state === "suspended" ? <ReasonAction label="Reactivate" path={`/api/admin/affiliates/${r.id}/review`} body={{ decision: "reactivate" }} onDone={a.reload} /> : null}
                  {(r.destination as { verified?: boolean } | null)?.verified === false ? <ReasonAction label="Verify payout details" path={`/api/admin/affiliates/${r.id}/verify-destination`} onDone={a.reload} /> : null}
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

// ----------------------------------------------------------------- payouts

export function LiveAdminPayouts() {
  const b = useApi<Row[]>("/api/admin/payout-batches");
  return (
    <Wrap>
      <PageHead
        title="Payouts"
        sub="Prepare → review (a second person) → submitting → paid with bank reference. An uncertain transfer stays reserved until confirmed."
        actions={<ReasonAction label="Prepare USD batch" variant="primary" needsReason={false} path="/api/admin/payout-batches" body={{ currency: "USD" }} onDone={b.reload} />}
      />
      <Panel bodyClass="p-0">
        {b.error ? <div className="p-5"><Err>{b.error.message}</Err></div> : null}
        <Table
          rows={b.data}
          empty="No payout batches yet."
          cols={[
            { key: "ref", label: "Batch" },
            { key: "state", label: "State" },
            { key: "totalMinor", label: "Total", right: true, render: (r) => money(String(r.totalMinor), String(r.currency)) },
            { key: "items", label: "Payees", right: true, render: (r) => String(Array.isArray(r.items) ? r.items.length : 0) },
            { key: "preparedBy", label: "Prepared by" },
            { key: "approvedBy", label: "Reviewed by" },
            { key: "reference", label: "Bank reference" },
            {
              key: "actions",
              label: "Actions",
              render: (r) => {
                const s = String(r.state);
                const path = (a: string) => `/api/admin/payout-batches/${r.id}/${a}`;
                return (
                  <div className="flex max-w-md flex-wrap gap-2">
                    {s === "draft" ? <ReasonAction label="Review" variant="primary" path={path("review")} onDone={b.reload} /> : null}
                    {s === "reviewed" ? <ReasonAction label="Mark submitting" path={path("submitting")} onDone={b.reload} /> : null}
                    {s === "submitting" ? <ReasonAction label="Mark outcome unknown" path={path("unknown")} onDone={b.reload} /> : null}
                    {["submitting", "submission_unknown"].includes(s) ? (
                      <ReasonAction label="Mark paid" variant="primary" path={path("paid")} extra={[{ name: "reference", label: "Bank reference" }, { name: "evidence", label: "Evidence" }]} onDone={b.reload} />
                    ) : null}
                    {["submitting", "submission_unknown"].includes(s) ? <ReasonAction label="Mark failed" variant="danger" path={path("failed")} onDone={b.reload} /> : null}
                    {["draft", "reviewed"].includes(s) ? <ReasonAction label="Cancel" variant="danger" path={path("cancel")} onDone={b.reload} /> : null}
                  </div>
                );
              },
            },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

// ----------------------------------------------------------------- support

export function LiveAdminSupport() {
  const t = useApi<(Row & { messages: { role: string; body: string; at: string }[] })[]>("/api/admin/tickets");
  return (
    <Wrap>
      <PageHead title="Support" sub="Customer requests with safe job and payment references." />
      {t.error ? <Err>{t.error.message}</Err> : null}
      {t.data && !t.data.length ? <Empty>No requests.</Empty> : null}
      <div className="space-y-3">
        {(t.data ?? []).map((x) => (
          <Panel key={String(x.id)} title={`${str(x.ref)} · ${str(x.subject)}`} action={<Badge surface="light" tone={x.status === "resolved" ? "success" : "info"}>{str(x.status)}</Badge>}>
            <p className="text-xs text-muted-dark">
              {str(x.customer)} · {str(x.category)} {x.jobId ? <Link className="text-info-text hover:underline" href={`/admin/jobs/${x.jobId}`}>· job {str(x.jobRef)}</Link> : null} {x.orderRef ? `· order ${str(x.orderRef)}` : ""}
            </p>
            <ol className="mt-2 space-y-1.5 text-sm">
              {x.messages.map((m, i) => (
                <li key={i} className={m.role === "staff" ? "rounded-lg bg-info-tint p-2" : "rounded-lg bg-paper p-2"}>
                  <span className="text-xs text-muted-dark">{m.role} · {when(m.at)}</span>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-3">
              <ReplyForm ticketId={String(x.id)} onDone={t.reload} />
            </div>
          </Panel>
        ))}
      </div>
    </Wrap>
  );
}

function ReplyForm({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("waiting_for_customer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api(`/api/admin/tickets/${ticketId}/reply`, { body: { body, status } });
          setBody("");
          onDone();
        } catch (er) {
          setErr(errorMessage(er));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid min-w-64 flex-1 gap-1 text-xs font-semibold">
        Reply
        <textarea required rows={2} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-lg border border-rule-strong bg-sheet px-2 py-1 text-sm font-normal" />
      </label>
      <label className="grid gap-1 text-xs font-semibold">
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal">
          <option value="waiting_for_customer">Waiting for customer</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="open">Open</option>
        </select>
      </label>
      <Button type="submit" size="sm" busy={busy}>
        Send reply
      </Button>
      {err ? <p className="w-full text-sm text-error-text">{err}</p> : null}
    </form>
  );
}

// ------------------------------------------------------------ audit, staff

export function LiveAdminAudit() {
  const a = useApi<Row[]>("/api/admin/audit?limit=200");
  return (
    <Wrap>
      <PageHead title="Audit log" sub="Append-only record of staff actions, with reasons and before/after state." />
      <Panel bodyClass="p-0">
        {a.error ? <div className="p-5"><Err>{a.error.message}</Err></div> : null}
        <Table
          rows={a.data}
          empty="No entries yet."
          cols={[
            { key: "at", label: "When", render: (r) => when(r.at) },
            { key: "actor", label: "Staff" },
            { key: "action", label: "Action" },
            { key: "target", label: "Target", render: (r) => `${str(r.targetKind)} ${str(r.targetId)}` },
            { key: "reason", label: "Reason" },
            { key: "after", label: "Change", render: (r) => <code className="block max-w-xs truncate text-xs">{JSON.stringify(r.after ?? null)}</code> },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

export function LiveAdminStaff() {
  const s = useApi<Row[]>("/api/admin/staff");
  return (
    <Wrap>
      <PageHead
        title="Staff"
        sub="Owner-only. Requires a sign-in within the last 10 minutes (and two-factor verification when enrolled)."
        actions={
          <ReasonAction
            label="Grant or change role"
            variant="primary"
            path="/api/admin/staff/role"
            body={{ active: true }}
            extra={[
              { name: "email", label: "Account email" },
              { name: "role", label: "Role", placeholder: "support | operations | finance | owner" },
            ]}
            onDone={s.reload}
          />
        }
      />
      <Panel bodyClass="p-0">
        {s.error ? <div className="p-5"><Err>{s.error.message}</Err></div> : null}
        <Table
          rows={s.data}
          empty="No staff yet."
          cols={[
            { key: "email", label: "Account" },
            { key: "role", label: "Role" },
            { key: "active", label: "Active", render: (r) => (r.active ? "Yes" : "No") },
            { key: "since", label: "Since", render: (r) => when(r.since) },
            {
              key: "actions",
              label: "",
              render: (r) =>
                r.active ? <ReasonAction label="Revoke" variant="danger" path="/api/admin/staff/role" body={{ email: r.email, role: r.role, active: false }} onDone={s.reload} /> : null,
            },
          ]}
        />
      </Panel>
    </Wrap>
  );
}

export function LiveOnlyNotice() {
  return (
    <Wrap>
      <Panel title="Available in the live console">
        <p className="text-sm text-muted-dark">This screen works with real data once the backend is configured. The design preview has no sample data for it.</p>
      </Panel>
    </Wrap>
  );
}
