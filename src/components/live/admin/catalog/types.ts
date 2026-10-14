/** Shapes returned by the admin catalog RPCs (numbers from Postgres numeric arrive as JSON numbers). */

export type OptionSpec = { label: string; values: (string | number)[]; default: string | number; labels?: Record<string, string> };
export type CapabilitySpec = {
  jobKind: string;
  prompt: { min: number; max: number };
  options: Record<string, OptionSpec>;
  references: { min: number; max: number; mime?: string[]; maxBytes?: number };
  output: { kind: "image" | "video"; count: number; mime: string[]; maxBytes: number };
  fixed?: Record<string, string> | null;
};

export type Check = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  fix?: "set_price" | "publish_draft" | "edit_cost" | "run_test" | null;
  warning?: boolean;
  draftPriceVersionId?: string | null;
};
export type Readiness = { checks: Check[]; blocking: number; capabilityVersionId: string };

export type CostInfo = {
  versionId: string;
  version: number;
  unit: "output" | "second";
  sourceKind: "documented" | "manual" | "observed";
  sourceUrl: string | null;
  checkedAt: string;
  usdPerCredit: number;
  stale: boolean;
  note: string | null;
};
export type CostSummary = CostInfo & { minCredits: number | null; maxCredits: number | null; complete: boolean; lossConfigsUplift: number | null };

export type PriceRef = { id: string; version: number; source: string; effectiveAt?: string | null; currentCapability: boolean } | null;
export type PriceRules =
  | { format: "table"; dims: string[]; units: Record<string, number>; perExtraReference?: { free: number; units: number } }
  | { base: number; add?: Record<string, Record<string, number>> };

export type AvailabilityState = "enabled" | "experimental" | "maintenance" | "disabled";
export type VerificationStatus = "untested" | "verified_by_test" | "manual_evidence" | "test_failed";

export type AdminModel = {
  id: string;
  tool: "image" | "edit" | "video";
  category: "image" | "video";
  name: string;
  family: string | null;
  variant: string | null;
  badges: string[];
  purpose: string;
  providerModelId: string;
  adapter: string;
  adapterVersion: number;
  adapterImplemented: boolean;
  state: AvailabilityState;
  note: string | null;
  enableBasis: "verified_test" | "manual_evidence" | "documented_cost" | null;
  verificationStatus: VerificationStatus;
  verifiedCurrent: boolean | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  docsUrl: string | null;
  pricingUrl: string | null;
  sourceCheckedAt: string | null;
  capability: { id: string; version: number; spec: CapabilitySpec };
  prices: { id: string; version: number; state: string; rules: PriceRules; source: string; effectiveAt: string | null; currentCapability: boolean }[];
  pricing: { published: PriceRef; draft: PriceRef; minUnits: number | null; maxUnits: number | null; configCount: number };
  cost: CostSummary | null;
  lastTest: { status: string; at: string; ref: string; jobId: string } | null;
  readiness: Readiness;
};

export type Access = {
  canSeeCosts: boolean;
  canPrice: boolean;
  canPublish: boolean;
  canOperate: boolean;
  canTest: boolean;
  canReadProvider: boolean;
  canManageSettings?: boolean;
};
export type Runtime = { submitsEnabled: boolean; kieKeyPresent: boolean; fakeProvider: boolean; balanceReadable: boolean; adaptersInCode: string[] };

export type Contribution = { revenueUsd: number; direct: number; affiliateBase: number; affiliateUplift: number; excludes: string[] } | null;
export type ConfigRow = {
  key: string;
  options: Record<string, string | number>;
  supplierCredits: number | null;
  supplierUsd: number | null;
  currentUnits: number | null;
  draftUnits: number | null;
  targetUsd: number | null;
  proposedUnits: number | null;
  contribution: Contribution;
  currentContribution: Contribution;
};
export type PriceTable = {
  modelId: string;
  name: string;
  tool: AdminModel["tool"];
  category: "image" | "video";
  state: AvailabilityState;
  capabilityVersionId: string;
  capabilityVersion: number;
  status: "ok" | "missing_cost" | "incomplete_cost" | "no_revenue_basis" | "manual_override";
  selectable: boolean;
  override: boolean;
  currentSource: string | null;
  cost: CostInfo | null;
  published: PriceRef;
  draft: PriceRef;
  configs: ConfigRow[];
  configCount: number;
  missingCost: number;
  summary: {
    minSupplierCredits: number | null;
    maxSupplierCredits: number | null;
    minUnits: number | null;
    maxUnits: number | null;
    worstUpliftContribution: number | null;
    lossConfigsUplift: number;
    lossConfigsDirect: number;
  };
  proposedRules: PriceRules | null;
  perExtraReferenceUnits: number | null;
};

export type BasisProduct = {
  key: string;
  name: string;
  kind: string;
  version: number;
  state: string;
  productVersionId: string;
  currency: string;
  amountMinor: string;
  credits: string;
  revenuePerCredit: number;
  overridden: boolean;
};
export type RevenueBasis = {
  source: "published" | "draft" | "none";
  currency: "USD";
  minRevenuePerCredit: number | null;
  conservative: BasisProduct | null;
  products: BasisProduct[];
  excluded: { key: string; name: string; reason: string }[];
  note: string;
};
export type Assumptions = {
  usdPerKieCredit: number | null;
  paymentFeeBps: number | null;
  paymentFixedFeeUsd: number | null;
  operatingCostUsdPerJob: number | null;
  staleDays: number;
  affiliate: { source: string; version: number | null; baseBps: number; upliftBps: number; threshold: number };
};

export type Preview = {
  revision: string;
  markupBps: number;
  includeOverrides: boolean;
  basis: RevenueBasis;
  assumptions: Assumptions;
  models: PriceTable[];
  generatedAt: string;
  scope: string;
};

export type ProductRow = {
  id: string;
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
  state: "draft" | "published" | "retired";
  gatewayMapping: Record<string, unknown>;
  effectiveAt: string | null;
  createdAt: string;
};

export type CatalogData = {
  models: AdminModel[];
  products: ProductRow[];
  agreements: Record<string, unknown>[];
  settings: Record<string, unknown>;
  economics: { basis: RevenueBasis; assumptions: Assumptions } | null;
  access: Access;
  runtime: Runtime;
};

export type TestRun = {
  jobId: string;
  ref: string;
  jobState: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  requestedBy: string | null;
  prompt: string;
  options: Record<string, string | number>;
  capabilityVersion: number;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  taskId: string | null;
  estimatedSupplierCredits: number | null;
  observedSupplierCredits: number | null;
  costProvenance: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  outputs: { assetId: string; mime: string; width: number | null; height: number | null; durationMs: number | null; bytes: string }[];
  events: { message: string; at: string }[];
};

export type PriceVersionRow = {
  id: string;
  version: number;
  state: "draft" | "published" | "retired";
  source: string;
  rules: PriceRules;
  effectiveAt: string | null;
  createdAt: string;
  publishedBy: string | null;
  createdBy: string | null;
  markupBps: number | null;
  batchRef: string | null;
  restoredFromVersion: number | null;
  evidence: string | null;
  capabilityVersion: number;
  currentCapability: boolean;
};

export type CostVersionRow = {
  id: string;
  version: number;
  schedule: { unit: "output" | "second"; dims: string[]; rates: Record<string, number>; durationOption?: string; extraReference?: { free: number; credits: number } };
  usdPerCredit: number;
  sourceKind: string;
  sourceUrl: string | null;
  checkedAt: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type ModelDetail = {
  model: Omit<AdminModel, "prices" | "pricing" | "cost" | "lastTest" | "readiness" | "adapterImplemented">;
  readiness: Readiness;
  table: PriceTable | null;
  costVersions: CostVersionRow[] | null;
  prices: PriceVersionRow[];
  tests: TestRun[];
  evidence: { kind: string; outcome: string; note: string | null; taskId: string | null; recordedBy: string | null; at: string }[];
  activity: { action: string; reason: string | null; actor: string | null; at: string; targetKind: string; targetId: string; before: unknown; after: unknown }[];
  access: Access;
  runtime: Runtime;
};

export type Batch = {
  id: string;
  ref: string;
  kind: string;
  action: "draft" | "publish";
  markupBps: number | null;
  includeOverrides: boolean;
  actor: string | null;
  createdAt: string;
  minRevenuePerCredit: number | null;
  items: { modelId: string; name: string; oldVersion: number | null; newVersion: number; newState: string; newPriceVersionId: string; summary: PriceTable["summary"] | null }[];
};

export type ProviderSummary = {
  generatedAt: string;
  configured: boolean;
  refreshed?: boolean;
  balance: {
    credits: number | null;
    observedAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    threshold: number | null;
    low: boolean;
    paused: boolean;
    usdPerCredit: number | null;
    approxUsd: number | null;
  };
  history: { ok: boolean; credits: number | null; error: string | null; source: string; at: string }[];
  spend: {
    timezone: string;
    today: SpendBucket;
    days7: SpendBucket;
    days30: SpendBucket;
    byModel30d: { modelId: string; name: string | null; customerCredits: number; testCredits: number; jobs: number; unmeasuredJobs: number }[];
  };
  jobs: Record<"queued" | "submitting" | "running" | "delayed" | "review" | "failed24h" | "succeeded24h" | "failed7d" | "succeeded7d" | "tests7d", number>;
  processing7d: { modelId: string; name: string | null; succeeded: number; failed: number; successRate: number | null; p50Seconds: number | null; p95Seconds: number | null }[];
  committed: { jobs: number; estimatedCredits: number; unknownCostJobs: number; note: string };
  billingUrl: string;
};
export type SpendBucket = { customerCredits: number; testCredits: number; unmeasuredJobs: number };
