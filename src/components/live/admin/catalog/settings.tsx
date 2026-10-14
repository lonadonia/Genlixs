"use client";

import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { ReasonAction } from "../live-admin";
import type { CatalogData } from "./types";

/** Settings the admin_set_setting RPC accepts; other keys are shown read-only (pricing assumptions live under Packages). */
const EDITABLE = new Set([
  "generation_paused",
  "quote_ttl_seconds",
  "reservation_deadline_hours",
  "delayed_after_minutes",
  "max_active_jobs_per_user",
  "max_quotes_per_minute",
  "provider_create_budget_per_10s",
  "output_retention_days",
  "reference_retention_days",
  "promo_credit_days",
  "signup_promo_units",
]);
const HIDDEN = new Set(["watchdog_heartbeat", "pricing_payment_fee_bps", "pricing_payment_fixed_fee_usd", "pricing_operating_cost_usd_per_job"]);

/** Partner terms and operational settings (unchanged behaviour; partner terms are published only by the owner). */
export function SettingsTab({ data, reload }: { data: CatalogData; reload: () => void }) {
  return (
    <div className="space-y-5">
      <Panel title="Partner agreement">
        <ul className="space-y-2 text-sm">
          {data.agreements.map((a) => (
            <li key={String(a.id)} className="flex flex-wrap items-center gap-2">
              Version {String(a.version)} ·{" "}
              <Badge surface="light" tone={a.state === "published" ? "success" : "neutral"}>
                {String(a.state)}
              </Badge>{" "}
              base {Number(a.base_rate_bps) / 100} % → {Number(a.uplift_rate_bps) / 100} % after {String(a.uplift_threshold)} distinct paying customers
              {a.state === "draft" && data.access.canPublish ? (
                <ReasonAction label="Publish agreement" variant="primary" path={`/api/admin/agreements/${a.id}/publish`} onDone={reload} />
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-dark">Publishing partner terms is a separate owner decision; partners keep the version they accepted.</p>
      </Panel>
      <Panel title="Operational settings">
        <ul className="space-y-2 text-sm">
          {Object.entries(data.settings)
            .filter(([k]) => !HIDDEN.has(k))
            .map(([k, v]) => (
              <li key={k} className="flex flex-wrap items-center gap-2">
                <code>{k}</code> = <code>{JSON.stringify(v)}</code>
                {EDITABLE.has(k) ? (
                  <ReasonAction label="Change" path={`/api/admin/settings/${k}`} extra={[{ name: "value", label: "New value (JSON)" }]} onDone={reload} />
                ) : (
                  <span className="text-xs text-muted-dark">read-only here</span>
                )}
              </li>
            ))}
        </ul>
        <p className="mt-3 text-xs text-muted-dark">Values are JSON: numbers as 30, booleans as true/false. Changes need a reason because they affect every customer.</p>
      </Panel>
    </div>
  );
}
