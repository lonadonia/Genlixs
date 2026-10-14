/** Shapes returned by the Genlixs API (projections built by the database RPCs). Units are decimal strings. */

export type Me = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  locale: string;
  accountStatus: "active" | "suspended" | "deleted";
  marketingOptIn: boolean;
  emailNotifications: boolean;
  capabilities: string[];
  isStaff: boolean;
};

export type Wallet = {
  availableUnits: string;
  reservedUnits: string;
  spentUnits: string;
  restricted: boolean;
  nearestExpiry: { at: string; units: string } | null;
  lots: {
    id: string;
    kind: string;
    grantedUnits: string;
    availableUnits: string;
    reservedUnits: string;
    spentUnits: string;
    expiredUnits: string;
    revokedUnits: string;
    expiresAt: string | null;
    restricted: boolean;
    createdAt: string;
  }[];
  periodSpentUnits: string;
};

export type Notification = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export type OptionSpec = { label: string; values: (string | number)[]; default: string | number; labels?: Record<string, string> };

export type CatalogModel = {
  id: string;
  tool: "image" | "edit" | "video";
  category?: "image" | "video";
  name: string;
  family?: string | null;
  variant?: string | null;
  badges?: string[];
  purpose: string | null;
  state: "enabled" | "experimental" | "maintenance" | "disabled";
  note: string | null;
  options: Record<string, OptionSpec>;
  prompt: { min: number; max: number };
  references: { min: number; max: number; mime?: string[]; maxBytes?: number };
  output: { kind: "image" | "video"; count: number };
  fixed: Record<string, string> | null;
  priced: boolean;
};

export type Catalog = { generationPaused: boolean; tools: { id: string; label: string; enabled: boolean }[]; models: CatalogModel[] };

export type Quote = {
  quoteId: string;
  creditUnits: string;
  expiresAt: string;
  availableUnits: string;
  options: Record<string, string | number>;
};

export type JobOutput = {
  assetId: string;
  mime: string;
  bytes: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  state: string;
  retentionUntil: string | null;
};

export type Job = {
  id: string;
  ref: string;
  tool: "image" | "edit" | "video";
  modelId: string;
  modelName: string;
  title: string;
  prompt: string;
  options: Record<string, string | number>;
  units: string;
  state: string;
  settlementState: "reserved" | "captured" | "released";
  failureCode: string | null;
  failureMessage: string | null;
  delayedAfterAt: string;
  customerDeadlineAt: string;
  createdAt: string;
  completedAt: string | null;
  favorite: boolean;
  outputs: JobOutput[];
  events: { event: string; message: string; at: string }[];
};

export type Product = {
  key: string;
  version: number;
  kind: "credit_pack" | "subscription";
  name: string;
  description: string | null;
  currency: string;
  amountMinor: string;
  credits: string;
  interval: string | null;
  creditExpiryDays: number | null;
};

export const TERMINAL_STATES = ["succeeded", "failed", "cancelled"];

export const STATE_LABEL: Record<string, string> = {
  queued: "Waiting in queue",
  submitting: "Sending",
  submission_unknown: "Confirming with the service",
  provider_pending: "Generating",
  processing_delayed: "Taking longer than usual",
  importing: "Saving your file",
  succeeded: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  review_required: "Being checked by our team",
};

export const units = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const money = (minor: string | number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(minor) / 100);
