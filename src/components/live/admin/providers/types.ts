/* Shapes returned by the provider/routing admin endpoints (see the multi-provider migration). Amounts are numbers for
   display only; every sum is computed in the database. null always means unknown, never zero. */

export type Num = number | null;

export type ProviderAccount = {
  id: string;
  provider: string;
  label: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  sortOrder: number;
  credential: { source: "vault" | "environment" | "none"; version: number; hint: string | null; setAt: string | null; environmentName: string | null };
  connection: { state: "untested" | "ok" | "failed" | "unauthorized" | "unsupported"; checkedAt: string | null; message: string | null };
  nativeUnit: string;
  funding: { feeBps: number; bonusBps: number; note: string | null; version: number };
  dailySpendCapUsd: Num;
  walletGroup: string | null;
  lowBalanceThreshold: Num;
  balance: {
    total: Num;
    available: Num;
    held: Num;
    unit: string;
    scope: "wallet" | "key" | null;
    source: "api" | "manual" | null;
    unlimitedKeyQuota: boolean | null;
    note: string | null;
    observedAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
    lastAttemptAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    usdApprox: Num;
    low: boolean;
  };
  circuit: { blockedUntil: string | null; code: string | null; since: string | null };
  offers: { total: number; mapped: number; eligible: number; routing: number; winning: number; dominated: number; unresolved: number };
  spend: {
    todayConfirmedUsd: number;
    todayEstimatedUsd: number;
    monthConfirmedUsd: number;
    monthEstimatedUsd: number;
    pendingUsd: number;
    pendingJobs: number;
    unknownCostJobs: number;
  };
  failures24h: number;
  staleBalance: boolean;
};

export type CostUnit = { unit: string; label: string; unitsPerUsd: number; basis: string; version: number; sourceUrl: string | null; checkedAt: string; note: string | null };

export type ProvidersOverview = {
  generatedAt: string;
  timezone: string;
  canManage: boolean;
  accounts: ProviderAccount[];
  totals: {
    todayConfirmedUsd: number;
    todayEstimatedUsd: number;
    monthConfirmedUsd: number;
    monthEstimatedUsd: number;
    pendingUsd: number;
    submissionUnknownJobs: number;
    failedToday: number;
  };
  notices: { stalePrices: number; eligibleWithoutRouting: number; modelsWithoutRoute: number };
  units: CostUnit[];
  policy: { fallbackMaxPct: Num; fallbackMaxUsd: Num; priceStaleDays: number; balanceStaleMinutes: Num };
  runtime: {
    paidSubmissionsAllowed: boolean;
    kieEnvironmentKey: boolean;
    fakeProvider: boolean;
    providers: Record<string, { adapters: string[]; resultHosts: string[]; balance: "api" | "none"; usage: boolean }>;
  };
  refreshed?: { accountId: string; skipped?: boolean; ok?: boolean; state?: string }[];
};

export type OfferPrice = {
  kind: "offer" | "supplier_cost";
  id: string;
  version: number;
  unit: string;
  schedule: Schedule;
  confidence: "authoritative" | "documented" | "estimate" | "conflicting" | "unverified";
  sourceKind: string;
  sourceUrl: string | null;
  checkedAt: string;
  effectiveAt?: string | null;
  expiresAt: string | null;
  assumptions: string | null;
  promotion?: boolean;
};

export type Schedule = {
  basis: "output" | "request" | "output_second" | "io_second";
  dims: string[];
  rates: Record<string, number | string>;
  seconds?: { option?: string; fixed?: number };
  minSeconds?: number;
  roundSeconds?: "ceil";
  secondsFactor?: number;
  inputSeconds?: { slots: string[]; round?: "ceil" };
  extraImages?: { slots: string[]; free: number; rate: number | string | null };
  roundDecimals?: number;
};

export type OfferStatus = "discovered" | "pricing_unverified" | "capabilities_unverified" | "configured" | "eligible" | "disabled" | "stale" | "unavailable";
export type Decision = "eligible" | "dominated" | "incompatible" | "unavailable" | "unresolved";

export type Offer = {
  id: string;
  accountId: string;
  provider: string;
  providerName: string;
  modelId: string | null;
  productKey: string;
  productLabel: string;
  tool: string | null;
  operation: string;
  upstreamModelId: string | null;
  adapter: string | null;
  capabilities: Record<string, unknown>;
  status: OfferStatus;
  decision: Decision;
  decisionReason: string | null;
  decidedAt: string | null;
  blocker: string | null;
  routingEnabled: boolean;
  legacy: boolean;
  sourceUrl: string | null;
  docsUrl: string | null;
  verificationNote: string | null;
  verifiedAt: string | null;
  priceOverrideUntil: string | null;
  sortOrder: number;
  price: OfferPrice | null;
  accountReady: boolean;
  /** Evidence that lets the offer serve: a real succeeded test job, or the owner's documented activation (no live test). */
  verificationBasis?: EvidenceBasis | null;
  liveTestJob?: { id: string; ref: string; state: string } | null;
  /** An open question in the supplier documentation; it blocks documented activation. */
  documentationGap?: string | null;
  /** Set when the safety stop switched a documented-only offer off (first refusal or failed job). */
  autoPausedAt?: string | null;
  autoPausedReason?: string | null;
  activation?: { basis: "documented"; activatedAt: string; activatedBy: string; reason: string } | null;
};

export type EvidenceBasis = "live_test" | "documented";

/** Every check of documented activation, evaluated now by the database. */
export type Readiness = {
  offerId: string;
  qualifies: boolean;
  checks: { key: string; label: string; ok: boolean; detail: string }[];
  configs: number;
  compatible: number;
  cheaper: number;
  maxSavingPct: Num;
  cheapestNative: Num;
  cheapestUsd: Num;
  unit: string | null;
  balance: { available: Num; pending: Num; unit: string | null; observedAt: string | null; fresh: boolean };
  checkedAt: string;
};

export type Candidate = {
  offerId: string;
  accountId: string;
  provider: string;
  providerLabel: string;
  adapter: string | null;
  upstreamModelId: string | null;
  legacy: boolean;
  native: Num;
  unit: string | null;
  unitsPerUsd: Num;
  feeBps: Num;
  bonusBps: Num;
  nominalUsd: Num;
  effectiveUsd: Num;
  price: { kind: string; id: string; version: number; confidence: string; checkedAt: string; sourceUrl: string | null } | null;
  credentialSource: string;
  excluded: string | null;
  health: string | null;
};

export type RouteChoice = {
  status: "ok" | "blocked" | "unavailable";
  chosen: Candidate | null;
  candidates: Candidate[];
  explanation: string;
  cheapestUsd: Num;
  ceilingUsd: Num;
  decidedAt: string;
};

export type Quantities = { outputs: number; counts: Record<string, number>; seconds: Record<string, number>; promptChars: number };

export type RoutingModel = {
  id: string;
  name: string;
  tool: string;
  family: string | null;
  state: string;
  publicVisible: boolean;
  spec: {
    options: Record<string, { values?: (string | number)[]; default?: string | number; label?: string; labels?: Record<string, string>; derived?: boolean }> | null;
    modes: { id: string; label: string; uses: string[]; requires?: string[] }[] | null;
    inputs: Record<string, { kind: string; label: string; min?: number; max?: number; minSeconds?: number; maxSeconds?: number }> | null;
    references: { min?: number; max?: number } | null;
    derived: Record<string, { from: string }> | null;
  };
  example: { options: Record<string, string | number>; mode: string | null; quantities: Quantities };
  route: { status: RouteChoice["status"]; explanation: string; chosen: Candidate | null; kieBaselineUsd: Num; candidates: Candidate[] };
  offers: Offer[];
};

export type RoutingModels = { generatedAt: string; models: RoutingModel[]; inventory: Offer[] };

export type RoutePreview = RouteChoice & {
  modelId: string;
  options: Record<string, string | number>;
  mode: string | null;
  quantities: Quantities;
  kieBaselineUsd: Num;
  savingVsKieUsd: Num;
};

export type ReviewProposal = {
  offerId: string;
  modelId: string | null;
  productKey?: string;
  provider: string;
  providerName: string;
  productLabel: string;
  status: OfferStatus;
  routingEnabled: boolean;
  currentDecision: Decision;
  proposedDecision: Decision;
  reason: string;
  configs: number | null;
  compatible?: number | null;
  priced: number | null;
  wins: number | null;
  mapped: boolean;
  canActivate: boolean;
};
export type RoutingReview = {
  revision: string;
  proposals: ReviewProposal[];
  providers: { provider: string; name: string; enabled: boolean; winningOffers: number; activeAfterApply: boolean }[];
};

export type OfferDetail = Offer & {
  prices: (Omit<OfferPrice, "kind"> & { createdAt: string; accountTier: string | null })[];
  history: { at: string; action: string; reason: string | null; after: unknown }[];
  recentJobs: { jobId: string; ref: string; state: string; purpose: string; at: string; estimatedUsd: Num; confirmedUsd: Num; ledgerState: string | null }[];
};

export type UsageRow = {
  id: string;
  at: string;
  jobId: string;
  jobRef: string;
  jobState: string;
  purpose: string;
  userId: string;
  userEmail: string | null;
  provider: string;
  providerName: string;
  modelId: string;
  modelName: string;
  upstreamModelId: string | null;
  attempt: number;
  attemptState: string;
  options: Record<string, unknown> | null;
  quantities: Quantities | null;
  unit: string | null;
  estimatedNative: Num;
  estimatedUsd: Num;
  confirmedNative: Num;
  confirmedUsd: Num;
  state: string;
  source: string;
  note: string | null;
  funding: { feeBps?: number; bonusBps?: number; version?: number } | null;
  priceRef: { kind?: string; version?: number; confidence?: string } | null;
};

export type Usage = {
  from: string;
  to: string;
  timezone: string;
  totals: {
    entries: number;
    confirmedUsd: number;
    estimatedAwaitingUsd: number;
    pendingUsd: number;
    estimateOfConfirmedUsd: number;
    notChargedOrFailed: number;
    unknownCost: number;
    historicalUnknown: number;
    byProvider: { provider: string; name: string; entries: number; confirmedUsd: number; estimatedAwaitingUsd: number; pendingUsd: number }[];
    byModel: { modelId: string; entries: number; confirmedUsd: number; estimatedAwaitingUsd: number }[];
  } | null;
  adjustments: { id: string; provider: string; kind: string; nativeAmount: number; unit: string; usd: Num; at: string; note: string }[];
  accountReported: { provider: string; scope: string; from: string; to: string; timezone: string; amountUsd: Num; nativeAmount: Num; unit: string | null; requests: Num; fetchedAt: string }[];
  rows: UsageRow[];
};

export type JobRoute = {
  jobId: string;
  attempts: {
    attemptId: string;
    ordinal: number;
    state: string;
    provider: string;
    offerId: string | null;
    credentialVersion: number | null;
    submittedAt: string;
    respondedAt: string | null;
    errorCode: string | null;
    route: Record<string, unknown> | null;
    ledger: { state: string; unit: string | null; estimatedNative: Num; estimatedUsd: Num; confirmedNative: Num; confirmedUsd: Num; note: string | null } | null;
  }[];
};
