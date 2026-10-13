/**
 * SAMPLE operational and financial records for the admin console and partner
 * portal layouts. Every value is invented for layout review; production reads
 * these from the blueprint-defined services (jobs, ledger, payments, payouts).
 */
import type { ToolId } from "./catalog";

const BASE = Date.UTC(2026, 9, 13, 9, 0, 0);
const MIN = 60_000;

export type AdminJobStatus = "queued" | "generating" | "delayed" | "importing" | "ready" | "failed" | "unconfirmed";

export type AdminJob = {
  id: string;
  tool: ToolId;
  model: string;
  customer: string;
  customerId: string;
  createdAt: number;
  durationS: number | null;
  credits: number;
  supplierCostUsd: number;
  importState: "not started" | "importing" | "imported" | "failed";
  status: AdminJobStatus;
  attempts: number;
  providerTask: string;
  priceVersion: string;
  settlement: "reserved" | "charged" | "returned";
};

const customers = [
  ["C-10482", "m•••a@studio.example"],
  ["C-10377", "j•••n@brand.example"],
  ["C-10291", "a•••i@mail.example"],
  ["C-10155", "r•••o@agency.example"],
  ["C-10022", "s•••h@shop.example"],
  ["C-09871", "k•••e@mail.example"],
] as const;

const models: Record<ToolId, string[]> = {
  image: ["Standard image", "High-detail image"],
  edit: ["Reference edit"],
  video: ["Short video", "Cinematic video"],
};

const statuses: AdminJobStatus[] = [
  "delayed", "ready", "ready", "generating", "ready", "failed", "ready", "unconfirmed", "ready", "importing", "ready", "ready",
  "queued", "ready", "failed", "ready", "ready", "generating", "ready", "ready", "ready", "delayed", "ready", "ready",
  "ready", "failed", "ready", "ready", "ready", "ready", "ready", "ready",
];

const tools: ToolId[] = ["video", "image", "edit", "image", "video", "video", "image", "video", "edit", "image", "image", "video"];

export const ADMIN_JOBS: AdminJob[] = statuses.map((status, i) => {
  const tool = tools[i % tools.length];
  const m = models[tool][i % models[tool].length];
  const [cid, email] = customers[i % customers.length];
  const credits = tool === "video" ? (i % 3 === 0 ? 100 : 40) : tool === "edit" ? 6 : i % 2 ? 8 : 4;
  const cost = tool === "video" ? credits * 0.0105 : credits * 0.0062;
  const running = status === "queued" || status === "generating" || status === "delayed" || status === "unconfirmed" || status === "importing";
  return {
    id: `J-${(9_000_000 - i * 7919).toString(36).toUpperCase()}`,
    tool,
    model: m,
    customer: email,
    customerId: cid,
    createdAt: BASE - (i * 23 + (i % 5) * 7) * MIN,
    durationS: running ? null : tool === "video" ? 74 + ((i * 13) % 40) : 9 + ((i * 7) % 12),
    credits,
    supplierCostUsd: Math.round(cost * 1000) / 1000,
    importState: status === "ready" ? "imported" : status === "importing" ? "importing" : status === "failed" ? "failed" : "not started",
    status,
    attempts: status === "failed" ? 2 : status === "delayed" ? 1 : 1,
    providerTask: `prov_${(733_000 + i * 911).toString(16)}`,
    priceVersion: "PV-2026-10-01 (sample)",
    settlement: running ? "reserved" : status === "failed" ? "returned" : "charged",
  };
});

export const STATUS_META: Record<AdminJobStatus, { label: string; tone: "success" | "info" | "warning" | "error" | "neutral" | "violet" }> = {
  queued: { label: "Queued", tone: "neutral" },
  generating: { label: "Generating", tone: "info" },
  delayed: { label: "Delayed", tone: "warning" },
  importing: { label: "Importing", tone: "violet" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "error" },
  unconfirmed: { label: "Unconfirmed", tone: "warning" },
};

export function jobEvents(j: AdminJob) {
  const t = j.createdAt;
  const ev: { at: number; title: string; detail: string; tone?: "error" | "warning" | "success" }[] = [
    { at: t, title: "Quote accepted", detail: `${j.credits} credits · ${j.priceVersion}` },
    { at: t + 2_000, title: "Credits reserved", detail: `${j.credits} credits moved from available to reserved` },
    { at: t + 4_000, title: "Submitted to provider", detail: `Task ${j.providerTask} · attempt 1` },
  ];
  if (j.status === "unconfirmed") {
    ev.push({ at: t + 40_000, title: "Provider response missing", detail: "No acknowledgement received. Reconciliation check scheduled; do not resubmit.", tone: "warning" });
    return ev;
  }
  if (j.status === "failed") {
    ev.push({ at: t + 30_000, title: "Provider error", detail: "Attempt 1 failed: upstream timeout", tone: "error" });
    ev.push({ at: t + 45_000, title: "Retried", detail: "Attempt 2 submitted automatically" });
    ev.push({ at: t + 90_000, title: "Provider error", detail: "Attempt 2 failed: content could not be generated", tone: "error" });
    ev.push({ at: t + 92_000, title: "Credits returned", detail: `${j.credits} reserved credits returned to customer`, tone: "success" });
    return ev;
  }
  if (j.status === "queued") return ev.slice(0, 2);
  ev.push({ at: t + 8_000, title: "Generating", detail: "Provider reports processing" });
  if (j.status === "delayed") {
    ev.push({ at: t + 6 * MIN, title: "Delay threshold passed", detail: "Exceeded the observed p95 for this model. Customer sees “taking longer than usual”.", tone: "warning" });
    return ev;
  }
  if (j.status === "generating") return ev;
  ev.push({ at: t + (j.durationS ?? 60) * 1000, title: "Output received", detail: "Provider returned a result file" });
  if (j.status === "importing") {
    ev.push({ at: t + (j.durationS ?? 60) * 1000 + 3_000, title: "Importing to storage", detail: "Copying the file into customer storage" });
    return ev;
  }
  ev.push({ at: t + (j.durationS ?? 60) * 1000 + 4_000, title: "Saved to library", detail: "File imported and checksum verified", tone: "success" });
  ev.push({ at: t + (j.durationS ?? 60) * 1000 + 5_000, title: "Credits charged", detail: `${j.credits} reserved credits settled`, tone: "success" });
  return ev;
}

export const MODEL_PERFORMANCE = [
  { model: "Standard image", tool: "Image", jobs: 1284, success: 98.6, medianS: 11 },
  { model: "High-detail image", tool: "Image", jobs: 412, success: 97.1, medianS: 19 },
  { model: "Reference edit", tool: "Edit", jobs: 538, success: 96.4, medianS: 14 },
  { model: "Short video", tool: "Video", jobs: 301, success: 91.2, medianS: 86 },
  { model: "Cinematic video", tool: "Video", jobs: 64, success: 84.4, medianS: 142 },
];

export const OVERVIEW_METRICS = [
  { key: "sales", label: "Sales", value: "$4,812", delta: "+6.1% vs previous 7 days", def: "Confirmed customer payments, net of refunds, before tax.", href: "/admin/jobs" },
  { key: "cost", label: "Supplier cost", value: "$1,206", delta: "+3.4% vs previous 7 days", def: "Provider charges for jobs submitted in the period.", href: "/admin/jobs" },
  { key: "commission", label: "Partner commission", value: "$318", delta: "Pending + available, not yet paid", def: "Commission accrued on eligible referred payments.", href: "/admin/payouts" },
  { key: "success", label: "Job success rate", value: "96.8%", delta: "2,599 jobs settled", def: "Ready ÷ (ready + failed) for jobs settled in the period.", href: "/admin/jobs?status=failed" },
];

export const SERVICE_HEALTH = [
  { name: "Image provider", state: "Operational", tone: "success" as const },
  { name: "Video provider", state: "Slower than p95", tone: "warning" as const },
  { name: "Payments webhook", state: "Operational", tone: "success" as const },
  { name: "Storage import", state: "Operational", tone: "success" as const },
];

export const AUDIT = [
  { at: BASE - 12 * MIN, actor: "finance.approver", action: "Approved payout batch PB-0912 (3 payees)", ref: "PB-0912" },
  { at: BASE - 48 * MIN, actor: "ops.lead", action: "Returned 40 credits to C-10291 — duplicate submission", ref: "ADJ-2209" },
  { at: BASE - 95 * MIN, actor: "system", action: "Payment P-30552 refunded by provider; credit grant reversed", ref: "P-30552" },
  { at: BASE - 180 * MIN, actor: "pricing.admin", action: "Published price version PV-2026-10-01", ref: "PV-2026-10-01" },
];

/* ------------------------------------------------------------- partner */

export const PARTNER = {
  code: "aurora-studio",
  name: "Aurora Studio",
  since: "1 Sep 2026",
  agreement: "Partner agreement v1.2 (sample) · accepted 1 Sep 2026",
  link: "https://genlixs.example/r/aurora-studio",
};

export const PARTNER_WEEKS = [
  { week: "Aug 25", registrations: 12 },
  { week: "Sep 1", registrations: 18 },
  { week: "Sep 8", registrations: 15 },
  { week: "Sep 15", registrations: 24 },
  { week: "Sep 22", registrations: 21 },
  { week: "Sep 29", registrations: 29 },
  { week: "Oct 6", registrations: 26 },
  { week: "Oct 13", registrations: 9 },
];

export const PARTNER_COUNTS = { clicks: 1462, registrations: 154, paying: 23 };

export const PARTNER_BALANCES = [
  { key: "pending", label: "Pending", value: 86.4, note: "In the holding period. Becomes available after the eligibility date." },
  { key: "available", label: "Available", value: 41.2, note: "Eligible and not yet requested." },
  { key: "reserved", label: "Reserved", value: 58.0, note: "Held in a payout under review or with an unconfirmed transfer." },
  { key: "paid", label: "Paid", value: 132.6, note: "Transferred, with a transfer reference." },
];

export const CAMPAIGNS = [
  { name: "YouTube tutorial", platform: "YouTube", dest: "/", label: "yt-oct", clicks: 812, regs: 88, paying: 14 },
  { name: "Newsletter", platform: "Email", dest: "/#pricing", label: "nl-sep", clicks: 401, regs: 47, paying: 7 },
  { name: "Instagram bio", platform: "Instagram", dest: "/", label: "ig-bio", clicks: 249, regs: 19, paying: 2 },
];

export type Commission = {
  id: string;
  referral: string;
  sourcePayment: string;
  base: number;
  rate: string;
  agreement: string;
  status: "pending" | "available" | "reserved" | "paid" | "held" | "reversed";
  eligibleOn: string;
  note?: string;
};

export const COMMISSIONS: Commission[] = [
  { id: "CM-4410", referral: "R-••3f9", sourcePayment: "P-30611", base: 24, rate: "sample rate", agreement: "v1.2", status: "pending", eligibleOn: "12 Nov 2026" },
  { id: "CM-4402", referral: "R-••a71", sourcePayment: "P-30587", base: 54, rate: "sample rate", agreement: "v1.2", status: "pending", eligibleOn: "9 Nov 2026" },
  { id: "CM-4391", referral: "R-••c02", sourcePayment: "P-30540", base: 9, rate: "sample rate", agreement: "v1.2", status: "held", eligibleOn: "—", note: "Held: payment dispute opened 10 Oct 2026; review by 24 Oct 2026." },
  { id: "CM-4377", referral: "R-••3f9", sourcePayment: "P-30498", base: 24, rate: "sample rate", agreement: "v1.2", status: "available", eligibleOn: "8 Oct 2026" },
  { id: "CM-4360", referral: "R-••77e", sourcePayment: "P-30455", base: 24, rate: "sample rate", agreement: "v1.2", status: "reserved", eligibleOn: "2 Oct 2026" },
  { id: "CM-4351", referral: "R-••b18", sourcePayment: "P-30431", base: 9, rate: "sample rate", agreement: "v1.1", status: "reversed", eligibleOn: "—", note: "Reversed: source payment refunded 28 Sep 2026." },
  { id: "CM-4302", referral: "R-••a71", sourcePayment: "P-30302", base: 54, rate: "sample rate", agreement: "v1.1", status: "paid", eligibleOn: "18 Sep 2026" },
];

export const PAYOUTS = [
  { id: "PO-0418", requested: "6 Oct 2026", amount: 58.0, method: "Bank transfer ••21", state: "unconfirmed" as const, ref: "—", note: "Transfer sent; bank confirmation not received. Amount stays reserved until resolved." },
  { id: "PO-0377", requested: "15 Sep 2026", amount: 74.1, method: "Bank transfer ••21", state: "paid" as const, ref: "TRF-88120431" },
  { id: "PO-0341", requested: "1 Sep 2026", amount: 58.5, method: "Bank transfer ••21", state: "paid" as const, ref: "TRF-88019377" },
];

export const PAYOUT_RULES = { threshold: 50, currency: "USD" };

/* -------------------------------------------------------- admin payouts */

export type BatchItem = { payee: string; partnerId: string; method: string; methodVerified: boolean; items: number; amount: number; fee: number };

export const PAYOUT_BATCH = {
  id: "PB-0913",
  preparedBy: "finance.preparer",
  preparedAt: BASE - 70 * MIN,
  currency: "USD",
  items: [
    { payee: "Aurora Studio", partnerId: "PT-0042", method: "Bank transfer ••21", methodVerified: true, items: 3, amount: 41.2, fee: 0.5 },
    { payee: "Line & Light", partnerId: "PT-0058", method: "Bank transfer ••07", methodVerified: true, items: 5, amount: 96.75, fee: 0.5 },
    { payee: "Frame Lab", partnerId: "PT-0061", method: "Payout account (unverified)", methodVerified: false, items: 2, amount: 33.0, fee: 0.5 },
  ] as BatchItem[],
};

export const TRANSFERS = [
  { id: "PO-0418", payee: "Aurora Studio", amount: 58.0, state: "unconfirmed" as const, sentAt: "6 Oct 2026", ref: "Awaiting bank reference" },
  { id: "PO-0409", payee: "Line & Light", amount: 112.4, state: "paid" as const, sentAt: "6 Oct 2026", ref: "TRF-88200117" },
  { id: "PO-0402", payee: "Studio North", amount: 64.0, state: "failed" as const, sentAt: "6 Oct 2026", ref: "Returned by bank — account closed" },
];
