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

/** Transient read failure: retry later, never interpret as a generation failure. */
export class TransientProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientProviderError";
  }
}
