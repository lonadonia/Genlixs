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

export type OptionSpec = {
  label: string;
  values: (string | number)[];
  default: string | number;
  labels?: Record<string, string>;
  /** Computed by the server from the media (for example billable seconds); never chosen or sent by the client. */
  derived?: boolean;
};

export type InputKind = "image" | "video" | "audio" | "job";

/** One typed input slot of a model (start frame, reference images, video to edit, motion video, source job…). */
export type InputSlotSpec = {
  kind: InputKind;
  label: string;
  min: number;
  max: number;
  mime?: string[];
  maxBytes?: number;
  minSeconds?: number;
  maxSeconds?: number;
  totalMaxSeconds?: number;
  minSide?: number;
  maxSide?: number;
  minPixels?: number;
  maxPixels?: number;
  aspectMin?: number;
  aspectMax?: number;
  fpsMin?: number;
  fpsMax?: number;
  needs?: string[];
  hides?: string[];
  group?: string;
  mention?: string;
  families?: string[];
  maxAgeDays?: number;
  hint?: string;
};

export type InputMode = { id: string; label?: string; uses: string[]; requires?: string[]; allowed?: Record<string, (string | number)[]>; allowedMessage?: string };
export type InputRule = { when: Record<string, string | number>; slot: string; maxSeconds?: number; message?: string };

export type Operation = "create" | "edit" | "motion" | "extend" | "avatar";

export type CatalogModel = {
  id: string;
  tool: "image" | "edit" | "video";
  category?: "image" | "video";
  operation?: Operation | null;
  name: string;
  family?: string | null;
  variant?: string | null;
  badges?: string[];
  purpose: string | null;
  state: "enabled" | "experimental" | "maintenance" | "disabled";
  note: string | null;
  options: Record<string, OptionSpec>;
  prompt: { min: number; max: number; optional?: boolean };
  references: { min: number; max: number; mime?: string[]; maxBytes?: number };
  inputs?: Record<string, InputSlotSpec> | null;
  modes?: InputMode[] | null;
  rules?: InputRule[] | null;
  /**
   * Options the server computes from the inputs: "seconds" (default, length of the first file of a slot), "present"
   * ("yes" when a listed slot has a file) or "billed_seconds" (the "plus" option + the listed slots' total length).
   */
  derived?: Record<string, { from: string | string[]; kind?: "seconds" | "present" | "billed_seconds"; plus?: string }> | null;
  /** Setting combinations the model does not offer (each entry: option → value); never priced, refused at the quote. */
  exclude?: Record<string, string | number>[] | null;
  excludeMessage?: string | null;
  output: { kind: "image" | "video"; count: number };
  fixed: Record<string, string> | null;
  priced: boolean;
  priceRules?: { format?: string; dims?: string[]; units?: Record<string, number> } | null;
  /** Staff test catalog only. */
  adapterImplemented?: boolean;
  costSchedule?: { unit: "output" | "second"; dims: string[]; rates: Record<string, number>; durationOption?: string; secondsFactor?: number } | null;
};

export type Catalog = { generationPaused: boolean; tools: { id: string; label: string; enabled: boolean }[]; models: CatalogModel[] };

export type Quote = {
  quoteId: string;
  creditUnits: string;
  expiresAt: string;
  availableUnits: string;
  options: Record<string, string | number>;
  mode?: string | null;
  inputs?: Record<string, string[]> | null;
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
  // Present since the generation-reliability release (older API responses may omit them).
  stage?: string | null;
  purpose?: "customer" | "staff_test";
  operation?: Operation | null;
  mode?: string | null;
  inputs?: Record<string, { id: string; kind: InputKind | null; mime: string | null }[]> | null;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  generatedAt?: string | null;
  lastCheckedAt?: string | null;
  nextActionAt?: string | null;
  providerProgress?: { value: number | string; at: string } | null;
  outputKind?: "image" | "video" | null;
  timing?: { generateSeconds?: number | null; generateP80Seconds?: number | null; saveSeconds?: number | null; samples?: number; basis?: "history" | "typical" } | null;
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
