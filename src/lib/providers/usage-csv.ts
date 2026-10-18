/**
 * Sanitized CSV of the supplier cost ledger: no prompts, no media or signed URLs, no keys, no e-mail addresses, and no
 * cell that a spreadsheet would run as a formula. Amounts stay decimal text; unknown stays empty (never 0).
 */
export type UsageRow = {
  at: string;
  jobRef: string;
  purpose: string;
  userId: string;
  provider: string;
  modelId: string;
  upstreamModelId: string | null;
  attempt: number;
  attemptState: string;
  state: string;
  unit: string | null;
  estimatedNative: number | string | null;
  estimatedUsd: number | string | null;
  confirmedNative: number | string | null;
  confirmedUsd: number | string | null;
  options: Record<string, unknown> | null;
};

const COLUMNS: [string, (r: UsageRow) => unknown][] = [
  ["time_utc", (r) => r.at],
  ["job", (r) => r.jobRef],
  ["purpose", (r) => r.purpose],
  ["user_id", (r) => r.userId],
  ["provider", (r) => r.provider],
  ["model", (r) => r.modelId],
  ["provider_model", (r) => r.upstreamModelId],
  ["attempt", (r) => r.attempt],
  ["attempt_state", (r) => r.attemptState],
  ["cost_state", (r) => r.state],
  ["unit", (r) => r.unit],
  ["estimated_native", (r) => r.estimatedNative],
  ["estimated_usd_funded", (r) => r.estimatedUsd],
  ["confirmed_native", (r) => r.confirmedNative],
  ["confirmed_usd_funded", (r) => r.confirmedUsd],
  ["settings", (r) => settings(r.options)],
];

function settings(o: Record<string, unknown> | null): string {
  if (!o) return "";
  return Object.entries(o)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** One CSV cell: quoted when needed; a leading = + - @ (or tab/CR) is neutralised so it is never a formula. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v).replace(/https?:\/\/\S+/g, "<url>").slice(0, 500);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function usageCsv(rows: UsageRow[]): string {
  const lines = [COLUMNS.map(([h]) => h).join(",")];
  for (const r of rows) lines.push(COLUMNS.map(([, f]) => csvCell(f(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}
