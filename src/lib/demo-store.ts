"use client";

import { useSyncExternalStore } from "react";
import type { Settings, ToolId } from "./catalog";
import type { MediaKey } from "./media";
import { PACKS } from "./packs";

/**
 * Browser-only DEMO store for the design preview.
 *
 * It simulates the customer-facing behaviour described in the design guide
 * (draft preservation, quotes, credit reservation, job phases, payment
 * verification) so each state can be reviewed. It is NOT an API client:
 * production must replace it with authenticated server records. Nothing here
 * leaves the visitor's browser.
 */

export type Draft = {
  tool: ToolId;
  prompt: string;
  settings: Settings;
  referenceName?: string;
  referenceSample?: boolean;
  source: "composer" | "example" | "studio";
  exampleId?: string;
  updatedAt: number;
};

export type JobOutcome = "success" | "delayed" | "failed" | "unknown";

export type Job = {
  id: string;
  tool: ToolId;
  title: string;
  prompt: string;
  settings: Settings;
  credits: number;
  createdAt: number;
  outcome: JobOutcome;
  media: MediaKey;
  referenceMedia?: MediaKey;
  cancelledAt?: number;
  settled?: "charged" | "returned";
  favorite?: boolean;
  shareUrl?: string;
  expired?: boolean;
  removed?: boolean;
  failureReason?: string;
};

export type LedgerEntry = {
  id: string;
  at: number;
  kind: "purchase" | "reserve" | "charge" | "return" | "grant";
  credits: number;
  ref: string;
  note: string;
};

export type PaymentOutcome = "confirmed" | "late" | "failed";

export type Payment = {
  id: string;
  packId: string;
  credits: number;
  priceLabel: string;
  createdAt: number;
  outcome: PaymentOutcome;
  settled?: boolean;
};

export type DemoState = {
  v: 2;
  hydrated: boolean;
  signedIn: boolean;
  email: string;
  available: number;
  reserved: number;
  usedThisPeriod: number;
  draft: Draft | null;
  jobs: Job[];
  ledger: LedgerEntry[];
  payments: Payment[];
  partnerStatus: "none" | "submitted" | "accepted";
  quotes: Partial<Record<ToolId, Quote>>;
  subscription: "active" | "cancelling";
  adminRole: AdminRole;
  adminActions: AdminAction[];
  payoutDecisions: Record<string, "approved" | "held">;
};

export type AdminRole = "operations" | "support" | "finance";

export type AdminAction = {
  id: string;
  jobId: string;
  kind: "return-credits" | "reconcile";
  credits: number;
  reason: string;
  note: string;
  actor: AdminRole;
  at: number;
};

export type Quote = { key: string; credits: number; issuedAt: number; readyAt: number };

const KEY = "genlixs-preview-v3";
const DAY = 86_400_000;
// Fixed reference time so server and client seed identical records.
const SEED_NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
export const SEED_TIME = SEED_NOW;

const seedJobs: Job[] = [
  {
    id: "J-7Q2KD",
    tool: "image",
    title: "Neon drive-thru at night",
    prompt: "A witch-themed drive-thru at night under a neon cauldron sign, a server in a navy uniform hands a green drink to a driver, cinematic wide frame",
    settings: { modelId: "img-standard", ratio: "16:9", quality: "High" },
    credits: 6,
    createdAt: SEED_NOW - 2 * 3_600_000,
    outcome: "success",
    media: "driveThru",
    settled: "charged",
    favorite: true,
  },
  {
    id: "J-7Q1ZT",
    tool: "edit",
    title: "Midday reference → dusk",
    prompt: "Change the scene to a warm dusk with a low sun; keep the dune shapes",
    settings: { modelId: "edit-reference", ratio: "Original", quality: "Standard" },
    credits: 6,
    createdAt: SEED_NOW - 5 * 3_600_000,
    outcome: "success",
    media: "dunesDusk",
    referenceMedia: "dunesNoon",
    settled: "charged",
  },
  {
    id: "J-7PZ8M",
    tool: "video",
    title: "Pup knight in the fog",
    prompt: "A wolf pup in silver armour holds a long sword in a foggy meadow, the camera pulls back to reveal an armoured knight behind it, slow pace",
    settings: { modelId: "vid-short", ratio: "16:9", duration: 10, resolution: "720p" },
    credits: 80,
    createdAt: SEED_NOW - 1 * DAY,
    outcome: "success",
    media: "knightClip",
    settled: "charged",
    shareUrl: "https://genlixs.example/s/k4n2-knight",
  },
  {
    id: "J-7PY3C",
    tool: "image",
    title: "Sleeping bag on the summit",
    prompt: "A red and green down sleeping bag on a foam mat at a snowy summit at sunrise, outdoor product shot, no logos",
    settings: { modelId: "img-detail", ratio: "4:5", quality: "High" },
    credits: 12,
    createdAt: SEED_NOW - 2 * DAY,
    outcome: "success",
    media: "summitBag",
    settled: "charged",
  },
  {
    id: "J-7PX0R",
    tool: "video",
    title: "Stars over the tent",
    prompt: "Stars wheel slowly over a glowing tent on a frosty ridge, fixed camera, time-lapse feel",
    settings: { modelId: "vid-short", ratio: "9:16", duration: 10, resolution: "1080p" },
    credits: 100,
    createdAt: SEED_NOW - 3 * DAY,
    outcome: "failed",
    media: "milkyTent",
    settled: "returned",
    failureReason: "The video service could not complete this request.",
  },
  {
    id: "J-7NB4W",
    tool: "image",
    title: "Garden portrait for stories",
    prompt: "A red-haired woman in a white cotton dress stands in a rose garden, soft daylight, vertical frame",
    settings: { modelId: "img-standard", ratio: "9:16", quality: "Standard" },
    credits: 4,
    createdAt: SEED_NOW - 6 * DAY,
    outcome: "success",
    media: "garden",
    settled: "charged",
  },
  {
    id: "J-6ZK9P",
    tool: "image",
    title: "Old-world study",
    prompt: "A dark wood-panelled study with painted wallpaper and a leather armchair, tall window light",
    settings: { modelId: "img-standard", ratio: "2:3", quality: "Standard" },
    credits: 4,
    createdAt: SEED_NOW - 64 * DAY,
    outcome: "success",
    media: "library",
    settled: "charged",
    expired: true,
  },
];

const seedLedger: LedgerEntry[] = [
  { id: "L-1009", at: SEED_NOW - 2 * 3_600_000, kind: "charge", credits: -6, ref: "J-7Q2KD", note: "Image · Standard image" },
  { id: "L-1008", at: SEED_NOW - 5 * 3_600_000, kind: "charge", credits: -6, ref: "J-7Q1ZT", note: "Edit · Reference edit" },
  { id: "L-1007", at: SEED_NOW - 1 * DAY, kind: "charge", credits: -80, ref: "J-7PZ8M", note: "Video · Short video" },
  { id: "L-1006", at: SEED_NOW - 3 * DAY, kind: "return", credits: 100, ref: "J-7PX0R", note: "Reserved credits returned — job failed" },
  { id: "L-1005", at: SEED_NOW - 3 * DAY, kind: "reserve", credits: -100, ref: "J-7PX0R", note: "Reserved for video job" },
  { id: "L-1004", at: SEED_NOW - 2 * DAY, kind: "charge", credits: -12, ref: "J-7PY3C", note: "Image · High-detail image" },
  { id: "L-1001", at: SEED_NOW - 9 * DAY, kind: "purchase", credits: 200, ref: "P-30418", note: "Starter pack · lot expires 13 Apr 2027" },
];

const DEFAULTS: DemoState = {
  v: 2,
  hydrated: false,
  signedIn: false,
  email: "",
  available: 120,
  reserved: 0,
  usedThisPeriod: 104,
  draft: null,
  jobs: seedJobs,
  ledger: seedLedger,
  payments: [],
  partnerStatus: "none",
  quotes: {},
  subscription: "active",
  adminRole: "operations",
  adminActions: [],
  payoutDecisions: {},
};

let state: DemoState = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  let next: DemoState = { ...DEFAULTS, hydrated: true };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DemoState>;
      if (parsed && parsed.v === 2) next = { ...next, ...parsed, hydrated: true };
    }
  } catch {
    // Storage can be unavailable (private mode); the preview still works in memory.
  }
  state = next;
}

function persist() {
  try {
    const { hydrated: _h, ...rest } = state;
    void _h;
    window.localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Ignore quota/private-mode failures.
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function setDemo(updater: (s: DemoState) => DemoState) {
  load();
  const next = updater(state);
  if (next === state) return;
  state = next;
  persist();
  emit();
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => {
  load();
  return state;
};
const getServerSnapshot = () => DEFAULTS;

export function useDemo(): DemoState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function saveDraft(draft: Omit<Draft, "updatedAt">) {
  setDemo((s) => ({ ...s, draft: { ...draft, updatedAt: Date.now() } }));
}

/** DEMO quote issue: production requests an authenticated, versioned server quote. */
export function issueQuote(tool: ToolId, key: string, credits: number) {
  const at = Date.now();
  setDemo((s) => ({ ...s, quotes: { ...s.quotes, [tool]: { key, credits, issuedAt: at, readyAt: at + 450 } } }));
}

export function recordAdminAction(a: Omit<AdminAction, "id" | "at">) {
  setDemo((s) => ({ ...s, adminActions: [{ ...a, id: newId("ADJ"), at: Date.now() }, ...s.adminActions] }));
}

export function resetDemo() {
  setDemo(() => ({ ...DEFAULTS, hydrated: true }));
}

/* ------------------------------------------------------------------ clock */

let now = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(l: () => void) {
  clockListeners.add(l);
  if (!clockTimer) {
    now = Date.now();
    // 250ms keeps quote refresh and phase changes responsive; elapsed text still reads in seconds.
    clockTimer = setInterval(() => {
      now = Date.now();
      clockListeners.forEach((c) => c());
    }, 250);
  }
  return () => {
    clockListeners.delete(l);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Current time, ticking every 250ms on the client; 0 during SSR. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => now || Date.now(),
    () => 0,
  );
}

/* ------------------------------------------------------------- job model */

export type JobPhase = "waiting" | "submitting" | "checking" | "generating" | "saving" | "ready" | "failed" | "cancelled";

export const PHASE_LABEL: Record<JobPhase, string> = {
  waiting: "Waiting",
  submitting: "Submitting",
  checking: "Confirming",
  generating: "Generating",
  saving: "Saving",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const genMs = (tool: ToolId) => (tool === "video" ? 9000 : tool === "edit" ? 5500 : 5000);

type Segment = { phase: JobPhase; ms: number };

function timeline(job: Job): Segment[] {
  const g = genMs(job.tool);
  const segs: Segment[] = [
    { phase: "waiting", ms: 1500 },
    { phase: "submitting", ms: 1400 },
  ];
  if (job.outcome === "unknown") segs.push({ phase: "checking", ms: 7000 });
  if (job.outcome === "failed") {
    segs.push({ phase: "generating", ms: Math.round(g * 0.6) });
    return segs;
  }
  segs.push({ phase: "generating", ms: job.outcome === "delayed" ? g + 16000 : g });
  segs.push({ phase: "saving", ms: 1400 });
  return segs;
}

export const expectedMs = (tool: ToolId) => 1500 + 1400 + genMs(tool) + 1400;

export function jobPhase(job: Job, at: number): JobPhase {
  if (job.cancelledAt) return "cancelled";
  if (job.settled === "charged") return "ready";
  if (job.settled === "returned") return "failed";
  if (!at) return "waiting";
  let t = at - job.createdAt;
  for (const seg of timeline(job)) {
    if (t < seg.ms) return seg.phase;
    t -= seg.ms;
  }
  return job.outcome === "failed" ? "failed" : "ready";
}

export const isTerminal = (p: JobPhase) => p === "ready" || p === "failed" || p === "cancelled";

/** Delayed = still running well past the expected duration (guide §08). */
export const isDelayed = (job: Job, at: number) =>
  !isTerminal(jobPhase(job, at)) && at - job.createdAt > expectedMs(job.tool) + 4000;

let seq = 0;
const newId = (prefix: string) => `${prefix}-${(Date.now() + seq++).toString(36).slice(-5).toUpperCase()}`;

export function submitJob(input: Omit<Job, "id" | "createdAt">): Job | null {
  let created: Job | null = null;
  setDemo((s) => {
    if (s.available < input.credits) return s;
    const job: Job = { ...input, id: newId("J"), createdAt: Date.now() };
    created = job;
    return {
      ...s,
      available: s.available - input.credits,
      reserved: s.reserved + input.credits,
      jobs: [job, ...s.jobs],
      ledger: [
        { id: newId("L"), at: Date.now(), kind: "reserve", credits: -input.credits, ref: job.id, note: `Reserved for ${input.tool} job` },
        ...s.ledger,
      ],
    };
  });
  return created;
}

export function cancelJob(id: string) {
  setDemo((s) => {
    const job = s.jobs.find((j) => j.id === id);
    if (!job || job.settled || jobPhase(job, Date.now()) !== "waiting") return s;
    return {
      ...s,
      available: s.available + job.credits,
      reserved: s.reserved - job.credits,
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, cancelledAt: Date.now(), settled: "returned" } : j)),
      ledger: [
        { id: newId("L"), at: Date.now(), kind: "return", credits: job.credits, ref: job.id, note: "Reserved credits returned — cancelled before submission" },
        ...s.ledger,
      ],
    };
  });
}

export function updateJob(id: string, patch: Partial<Job>) {
  setDemo((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
}

/* --------------------------------------------------------------- payments */

export { PACKS } from "./packs";

export const paymentState = (p: Payment, at: number): "verifying" | "confirmed" | "failed" => {
  if (p.settled) return p.outcome === "failed" ? "failed" : "confirmed";
  const wait = p.outcome === "late" ? 15000 : 4500;
  if (!at || at - p.createdAt < wait) return "verifying";
  return p.outcome === "failed" ? "failed" : "confirmed";
};

export function startPayment(packId: string, outcome: PaymentOutcome): Payment | null {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return null;
  const payment: Payment = { id: newId("P"), packId, credits: pack.credits, priceLabel: pack.priceLabel, createdAt: Date.now(), outcome };
  setDemo((s) => ({ ...s, payments: [payment, ...s.payments] }));
  return payment;
}

/** Applies server-like settlement once a simulated job/payment reaches a terminal state. */
export function settleDemo() {
  const at = Date.now();
  setDemo((s) => {
    let changed = false;
    let { available, reserved, usedThisPeriod } = s;
    const ledger = [...s.ledger];
    const jobs = s.jobs.map((j) => {
      if (j.settled) return j;
      const p = jobPhase(j, at);
      if (p === "ready") {
        changed = true;
        reserved -= j.credits;
        usedThisPeriod += j.credits;
        ledger.unshift({ id: newId("L"), at, kind: "charge", credits: -j.credits, ref: j.id, note: `${j.tool === "edit" ? "Edit" : j.tool === "video" ? "Video" : "Image"} · charged on saved output` });
        return { ...j, settled: "charged" as const };
      }
      if (p === "failed") {
        changed = true;
        reserved -= j.credits;
        available += j.credits;
        ledger.unshift({ id: newId("L"), at, kind: "return", credits: j.credits, ref: j.id, note: "Reserved credits returned — job failed" });
        return { ...j, settled: "returned" as const, failureReason: "The generation service could not complete this request." };
      }
      return j;
    });
    const payments = s.payments.map((p) => {
      if (p.settled) return p;
      const st = paymentState(p, at);
      if (st === "verifying") return p;
      changed = true;
      if (st === "confirmed") {
        available += p.credits;
        ledger.unshift({ id: newId("L"), at, kind: "purchase", credits: p.credits, ref: p.id, note: "Payment confirmed — credits added" });
      }
      return { ...p, settled: true };
    });
    if (!changed) return s;
    return { ...s, available, reserved, usedThisPeriod, jobs, payments, ledger };
  });
}
