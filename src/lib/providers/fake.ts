import "server-only";
import { sha256Hex } from "@/lib/server/crypto";
import type { GenerationProvider, SubmitOutcome, SubmitRequest, TaskDetail } from "./types";

/**
 * Deterministic fake provider for local and preview testing (guide §25.1). It is selected only when
 * GENLIXS_FAKE_PROVIDER=1 is set explicitly AND the deployment is not production — never as a fallback
 * for a missing key. Scenarios are chosen with prompt markers:
 *   [reject] terminal rejection · [busy] retryable rejection · [unknown] lost create response
 *   [fail] task fails · anything else succeeds with a bundled sample file.
 */
export const FAKE_RESULT_PREFIX = "fake://";

export class FakeProvider implements GenerationProvider {
  readonly name = "fake";

  async submit({ context }: SubmitRequest): Promise<SubmitOutcome> {
    const p = context.job.prompt;
    if (p.includes("[reject]")) {
      return { kind: "rejected_terminal", code: "FAKE_422", message: "fake rejection", publicCode: "INVALID_REQUEST",
        publicMessage: "The generation service did not accept this prompt or these settings." };
    }
    if (p.includes("[busy]")) return { kind: "rejected_retryable", code: "FAKE_429", message: "fake rate limit" };
    if (p.includes("[unknown]")) return { kind: "unknown", code: "FAKE_TIMEOUT", message: "fake lost response" };
    const scenario = p.includes("[fail]") ? "fail" : "ok";
    const kind = context.output.kind === "video" ? "video" : "image";
    return { kind: "accepted", taskId: `fake-${scenario}-${kind}-${sha256Hex(context.job.id + context.attempt?.id).slice(0, 16)}` };
  }

  async getTask(taskId: string): Promise<TaskDetail> {
    const m = /^fake-(ok|fail)-(image|video)-[0-9a-f]{16}$/.exec(taskId);
    if (!m) return { taskId, providerState: null, normalized: "unknown", resultUrls: [], notFound: true };
    if (m[1] === "fail") {
      return { taskId, providerState: "fail", normalized: "fail", resultUrls: [], failCode: "FAKE", failMsg: "fake failure" };
    }
    return { taskId, providerState: "success", normalized: "success", resultUrls: [`${FAKE_RESULT_PREFIX}${m[2]}`], creditsConsumed: null };
  }

  async balance() {
    return null;
  }
}

/** Bundled sample files the fake importer reads from /public (local `next start` only). */
export const FAKE_SAMPLES: Record<string, string> = {
  image: "media/client/beach-pink.webp",
  video: "media/client/alley-cats.mp4",
};
