"use client";

import { useState, type FormEvent } from "react";
import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { ReasonAction } from "./live-admin";

type Settings = {
  settings: { key: string; value: unknown; description: string | null; updatedAt: string }[];
  agreements: { id: string; version: number; state: string; baseBps: number; upliftBps: number; threshold: number; publishedAt: string | null }[];
  access: { canOperate: boolean; canManageSettings: boolean; canPublish: boolean };
};

/** Plain-language names for the operational settings the server lets staff change. */
const LABELS: Record<string, { label: string; unit?: string }> = {
  generation_paused: { label: "Pause all new generations" },
  quote_ttl_seconds: { label: "A price check stays valid for", unit: "seconds" },
  reservation_deadline_hours: { label: "Held credits are released after", unit: "hours" },
  delayed_after_minutes: { label: "A job counts as delayed after", unit: "minutes" },
  max_active_jobs_per_user: { label: "Running jobs per customer", unit: "jobs" },
  max_quotes_per_minute: { label: "Price checks per customer per minute", unit: "checks" },
  provider_create_budget_per_10s: { label: "KIE submissions per 10 seconds", unit: "tasks" },
  output_retention_days: { label: "Generated files are kept for", unit: "days" },
  reference_retention_days: { label: "Uploaded reference images are kept for", unit: "days" },
  promo_credit_days: { label: "Promotional credits expire after", unit: "days" },
  signup_promo_units: { label: "Sign-up bonus", unit: "credits" },
};

/** Operational settings (Overview). Each change needs a reason because it affects every customer. */
export function ServiceSettingsPanel() {
  const s = useApi<Settings>("/api/admin/settings");
  if (s.error) return null;
  return (
    <Panel title="Service settings" id="service-settings-h">
      {!s.data ? (
        <p className="text-sm text-muted-dark">Loading…</p>
      ) : (
        <ul className="divide-y divide-rule text-sm">
          {s.data.settings.map((x) => (
            <SettingRow
              key={x.key}
              item={x}
              canChange={x.key === "generation_paused" ? s.data!.access.canOperate : s.data!.access.canManageSettings}
              onDone={s.reload}
            />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-dark">Changes apply to every customer and are recorded in the audit log with your reason.</p>
    </Panel>
  );
}

function SettingRow({ item, canChange, onDone }: { item: Settings["settings"][number]; canChange: boolean; onDone: () => void }) {
  const meta = LABELS[item.key] ?? { label: item.key };
  const isBool = typeof item.value === "boolean";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(isBool ? String(item.value) : String(item.value ?? ""));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = isBool ? (item.value ? "On" : "Off") : `${String(item.value)}${meta.unit ? ` ${meta.unit}` : ""}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/settings/${item.key}`, { body: { value: isBool ? value === "true" : Number(value), reason } });
      setOpen(false);
      setReason("");
      onDone();
    } catch (er) {
      setErr(errorMessage(er));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-ink-dark">{meta.label}</span>
        <span className="font-semibold tabular text-ink-dark">{shown}</span>
        {canChange && !open ? (
          <Button size="sm" variant="ghost-light" onClick={() => setOpen(true)} aria-label={`Change: ${meta.label}`}>
            Change
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-paper p-3">
          <label className="grid gap-1 text-xs font-semibold">
            New value
            {isBool ? (
              <select value={value} onChange={(e) => setValue(e.target.value)} className="h-9 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal">
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
            ) : (
              <input required inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))} className="h-9 w-28 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal tabular" />
            )}
          </label>
          <label className="grid min-w-56 flex-1 gap-1 text-xs font-semibold">
            Reason (recorded in the audit log)
            <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 rounded-lg border border-rule-strong bg-sheet px-2 text-sm font-normal" />
          </label>
          <Button type="submit" size="sm" busy={busy}>
            Save
          </Button>
          <Button size="sm" variant="ghost-light" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {err ? <p className="w-full text-sm text-error-text">{err}</p> : null}
        </form>
      ) : null}
    </li>
  );
}

/** Partner commission terms (Partners). Publishing a version is an owner decision; partners keep the version they accepted. */
export function PartnerTermsPanel() {
  const s = useApi<Settings>("/api/admin/settings");
  if (s.error || !s.data) return null;
  const { agreements, access } = s.data;
  return (
    <Panel title="Partner commission terms" id="partner-terms-h">
      {agreements.length === 0 ? (
        <p className="text-sm text-muted-dark">No partner terms yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {agreements.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Version {a.version}</span>
              <Badge surface="light" tone={a.state === "published" ? "success" : "neutral"} icon="none">
                {a.state === "published" ? "In use" : a.state === "draft" ? "Draft" : "Earlier"}
              </Badge>
              <span className="text-muted-dark">
                {a.baseBps / 100} % commission, {a.upliftBps / 100} % after {a.threshold} paying customers
              </span>
              {a.state === "draft" && access.canPublish ? (
                <ReasonAction label="Publish terms" variant="primary" path={`/api/admin/agreements/${a.id}/publish`} onDone={s.reload} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-dark">Partners keep the version they accepted. Approving partners requires published terms.</p>
    </Panel>
  );
}
