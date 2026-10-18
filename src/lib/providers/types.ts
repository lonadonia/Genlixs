/** Provider-neutral contracts used by the workers (guide §12). */

/** Outcome of one create-task POST. Only `accepted` carries a task id. */
export type SubmitOutcome =
  | { kind: "accepted"; taskId: string }
  | { kind: "rejected_retryable"; code: string; message: string }
  | { kind: "rejected_account"; code: string; message: string }
  | { kind: "rejected_terminal"; code: string; message: string; publicCode: string; publicMessage: string }
  | { kind: "unknown"; code: string; message: string };

export type NormalizedState = "pending" | "success" | "fail" | "unknown";

/** Authoritative task detail, normalized. `notFound` is not a failure on its own (§12.4). */
export type TaskDetail = {
  taskId: string;
  providerState: string | null;
  normalized: NormalizedState;
  resultUrls: string[];
  failCode?: string | null;
  failMsg?: string | null;
  creditsConsumed?: string | null;
  costTime?: string | null;
  progress?: string | null;
  /** The callBackUrl recorded with the task, used to verify an unknown submission's binding (§15.2). */
  callBackUrl?: string | null;
  notFound?: boolean;
};

/** One input of a typed slot: a stored asset, or (for extensions) an earlier job with its provider task. */
export type ClaimInput =
  | { assetId: string; bucket: string; path: string; mime: string; durationMs: number | null; width: number | null; height: number | null }
  | { jobId: string; taskId: string | null };

/** Context returned by worker_claim for generation work. */
export type ClaimContext = {
  job: {
    id: string;
    ref: string;
    userId: string;
    state: string;
    tool: "image" | "edit" | "video";
    prompt: string;
    options: Record<string, string | number>;
    units: string;
    /** Input combination chosen by the quote (for example "frames" or "reference"); null for single-input specs. */
    mode?: string | null;
  };
  model: { id: string; providerModelId: string; adapter: string; adapterVersion: number; providerAccountId: string };
  output: { kind: "image" | "video"; mime: string[]; count: number; maxBytes: number };
  references: { assetId: string; bucket: string; path: string; mime: string }[];
  /** Ordered inputs per slot of the capability (empty for specs without slots). */
  inputs?: Record<string, ClaimInput[]>;
  attempt: { id: string; ordinal: number; state: string; taskId: string | null } | null;
};

export type SubmitRequest = {
  context: ClaimContext;
  /** Short-lived signed URLs for reference images, generated just before submission (§12.3). */
  referenceUrls: string[];
  /** Signed URLs per typed input slot, in the customer's order (empty when the spec has no slots). */
  inputUrls?: Record<string, string[]>;
  /** Provider task ids of earlier jobs per "job" slot (video extension). */
  sourceTasks?: Record<string, string[]>;
  callBackUrl: string | null;
};

/** One live balance read: real credits, or an error code. Never a substituted zero. */
export type BalanceRead = { ok: true; credits: number } | { ok: false; error: string };

export interface GenerationProvider {
  readonly name: string;
  submit(req: SubmitRequest): Promise<SubmitOutcome>;
  getTask(taskId: string): Promise<TaskDetail>;
  balance(): Promise<number | null>;
  readBalance(): Promise<BalanceRead>;
}

// ------------------------------------------------------------------ multi-provider routing

export type ProviderName = "kie" | "fake" | "duomi" | "poyo" | "nezhagate" | "cuddler" | "apimart";
export const PROVIDER_NAMES: readonly ProviderName[] = ["kie", "duomi", "poyo", "nezhagate", "cuddler", "apimart"];

/**
 * The route the database chose (worker_begin_submission_v2) or pinned for an attempt (worker_attempt_route).
 * Amounts are decimal text, never binary floats. The key itself is never part of a route.
 */
export type AttemptRoute = {
  attemptId?: string;
  provider: ProviderName;
  accountId: string;
  offerId: string | null;
  legacy?: boolean;
  adapter: string;
  upstreamModelId: string;
  credentialVersion: number;
  credentialSource: "vault" | "environment" | "none";
  secretRef: string | null;
  /** Fixed request parameters of the offer (for example a provider "variant"). */
  request?: Record<string, string | number | boolean> | null;
  unit?: string | null;
  estimate?: { native: string | number | null; nominalUsd: string | number | null; effectiveUsd: string | number | null } | null;
};

/** A submit through a routed provider: the regular request plus the route, its key and an idempotency key. */
export type RoutedSubmit = SubmitRequest & { route: AttemptRoute; key: string; idempotencyKey: string };

/**
 * One balance read. Optional fields stay null when the provider does not report them: unknown is never zero.
 * `scope` separates an account wallet from an API-key allowance; an unlimited key is not an unlimited wallet.
 */
export type ProviderBalance =
  | {
      ok: true;
      total: string | null;
      available: string | null;
      held: string | null;
      unit: string;
      scope: "wallet" | "key";
      unlimited?: boolean;
      note?: string | null;
    }
  | { ok: false; error: string; state: "failed" | "unauthorized" | "unsupported" };

/** Account-level usage reported by a provider (may include other applications on the same account). */
export type UsageReport = {
  scope: "key" | "account";
  from: string;
  to: string;
  timezone: string;
  amountUsd: string | null;
  nativeAmount: string | null;
  nativeUnit: string | null;
  requests: number | null;
};

/** Shared adapter interface around one supplier. Hosts and paths are fixed in code; nothing here is configurable. */
export interface ProviderClient {
  readonly name: ProviderName;
  /** Request builders implemented by this release (must equal the migration's provider_adapters rows). */
  readonly adapters: readonly string[];
  /** Hosts results may be downloaded from (redirects are checked against the same list). */
  readonly resultHosts: readonly string[];
  /** Whether a documented read-only balance call exists (used as the connection test). */
  readonly balanceSupport: "api" | "none";
  submit(req: RoutedSubmit): Promise<SubmitOutcome>;
  getTask(taskId: string, ctx: { route: AttemptRoute; key: string }): Promise<TaskDetail>;
  readBalance(key: string): Promise<ProviderBalance>;
  readUsage?(key: string, range: { from: Date; to: Date }): Promise<UsageReport | null>;
}

/** Transient read failure: retry later, never interpret as a generation failure. */
export class TransientProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientProviderError";
  }
}
