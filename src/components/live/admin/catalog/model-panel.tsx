"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleX, ExternalLink, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LiveReferenceUploader, type LiveReference } from "@/components/live/studio/live-reference";
import { api, ApiClientError, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { useAvailability } from "./availability";
import { contributionOf, scheduleKeys } from "./math";
import {
  configLabel,
  ContributionCells,
  day,
  Empty,
  Field,
  fmtGx,
  fmtKie,
  fmtUsd4,
  inputCls,
  ModelBadges,
  Notice,
  STATE_INFO,
  Tabs,
  unitLabel,
  VerificationBadge,
  when,
} from "./shared";
import type { AvailabilityState, CatalogData, ModelDetail, TestRun } from "./types";

export type PanelSection = "availability" | "pricing" | "test" | "cost" | "activity" | "advanced";

/** One editing panel per model: availability, pricing, private tests, KIE cost, activity and technical details. */
export function ModelPanel({
  modelId,
  section,
  onSection,
  onClose,
  onChanged,
  economics,
}: {
  modelId: string;
  economics: CatalogData["economics"];
  section: PanelSection;
  onSection: (s: PanelSection) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const d = useApi<ModelDetail>(`/api/admin/catalog/models/${modelId}`);
  const reloadAll = () => {
    d.reload();
    onChanged();
  };
  // While a private test is running, its status refreshes on its own.
  const running = d.data?.tests.some((t) => t.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => d.reload(), 5000);
    return () => window.clearInterval(t);
  }, [running, d]);

  const m = d.data?.model;
  return (
    <Dialog
      open
      surface="light"
      size="xl"
      onClose={onClose}
      title={m ? m.name : "Loading model…"}
      description={
        m ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge surface="light" tone={STATE_INFO[m.state].tone}>
              {STATE_INFO[m.state].label}
            </Badge>
            <VerificationBadge model={m} />
            <span>
              {m.family ?? ""} {m.variant ? `· ${m.variant}` : ""} · {m.tool === "video" ? "Video" : m.tool === "edit" ? "Image edit" : "Image"}
            </span>
            <ModelBadges badges={m.badges} />
          </span>
        ) : undefined
      }
    >
      {d.error ? <Notice tone="error">{d.error.message}</Notice> : null}
      {!d.data ? (
        <div role="status" aria-busy="true" aria-label="Loading model" className="h-48 animate-pulse-soft rounded-xl bg-paper" />
      ) : (
        <div className="space-y-5">
          <Tabs<PanelSection>
            label="Model sections"
            value={section}
            onChange={onSection}
            tabs={[
              { id: "availability", label: "Availability" },
              { id: "pricing", label: "Pricing" },
              { id: "test", label: "Test", count: d.data.tests.length || undefined },
              { id: "cost", label: "KIE cost" },
              { id: "activity", label: "Activity" },
              { id: "advanced", label: "Advanced" },
            ]}
          />
          {section === "availability" ? <AvailabilitySection d={d.data} onChanged={reloadAll} go={onSection} /> : null}
          {section === "pricing" ? <PricingSection d={d.data} economics={economics} onChanged={reloadAll} /> : null}
          {section === "test" ? <TestSection d={d.data} onChanged={reloadAll} /> : null}
          {section === "cost" ? <CostSection d={d.data} onChanged={reloadAll} /> : null}
          {section === "activity" ? <ActivitySection d={d.data} /> : null}
          {section === "advanced" ? <AdvancedSection d={d.data} /> : null}
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------ availability

function AvailabilitySection({ d, onChanged, go }: { d: ModelDetail; onChanged: () => void; go: (s: PanelSection) => void }) {
  const m = d.model;
  const [state, setState] = useState<AvailabilityState>(m.state);
  const [note, setNote] = useState(m.note ?? "");
  const avail = useAvailability({ access: d.access, runtime: d.runtime, onChanged, onFix: (_, s) => go(s) });
  const target = { ...m, readiness: d.readiness };
  const checks = [
    ...d.readiness.checks,
    {
      key: "credentials",
      ok: d.runtime.submitsEnabled,
      label: "Server credentials",
      detail: d.runtime.submitsEnabled ? "This deployment can send work to KIE." : "KIE_API_KEY is missing here (or paid calls are disabled outside production).",
    },
  ];
  return (
    <div className="space-y-6">
      <section aria-labelledby="ready-h">
        <h3 id="ready-h" className="text-sm font-semibold text-ink-dark">
          Readiness
        </h3>
        <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule">
          {checks.map((c) => {
            const fix = "fix" in c ? c.fix : null;
            return (
              <li key={c.key} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                {c.ok ? (
                  <CircleCheck aria-hidden className="mt-0.5 size-4 text-success-text" />
                ) : "warning" in c && c.warning ? (
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 text-orange-text" />
                ) : (
                  <CircleX aria-hidden className="mt-0.5 size-4 text-error-text" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-dark">
                    {c.label} <span className="sr-only">{c.ok ? "(passed)" : "warning" in c && c.warning ? "(warning)" : "(not met)"}</span>
                  </p>
                  <p className="text-muted-dark">{c.detail}</p>
                </div>
                {!c.ok && fix ? (
                  <Button size="sm" variant="secondary-light" onClick={() => go(fix === "run_test" ? "test" : fix === "edit_cost" ? "cost" : "pricing")}>
                    {fix === "run_test" ? "Run a test" : fix === "edit_cost" ? "Open KIE cost" : fix === "publish_draft" ? "Review draft" : "Set price"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="state-h" className="space-y-3">
        <h3 id="state-h" className="text-sm font-semibold text-ink-dark">
          Customer availability
        </h3>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Availability state</legend>
          {(["disabled", "maintenance", "experimental", "enabled"] as const).map((s) => (
            <label key={s} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", state === s ? "border-brand-blue bg-info-tint" : "border-rule")}>
              <input type="radio" name="availability" checked={state === s} onChange={() => setState(s)} disabled={!d.access.canOperate} className="mt-0.5 size-4 accent-brand-blue" />
              <span>
                <span className="block font-semibold text-ink-dark">{STATE_INFO[s].label}</span>
                <span className="text-muted-dark">{STATE_INFO[s].customer}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {state === "maintenance" || state === "experimental" ? (
          <Field label="Note shown to customers (optional)" hint="For example: “Back later today” or “Results may vary while we tune this model.”">
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
        ) : null}
        {d.access.canOperate ? (
          <Button
            busy={avail.busy}
            disabled={state === m.state && (note || null) === (m.note || null)}
            onClick={() => avail.request(target, state, state === "maintenance" || state === "experimental" ? note.trim() || null : null)}
          >
            Save availability
          </Button>
        ) : (
          <p className="text-sm text-muted-dark">Your role can view but not change availability.</p>
        )}
        {m.enableBasis === "documented_cost" && (m.state === "enabled" || m.state === "experimental") ? (
          <Notice tone="attention">Enabled by the owner using the documented KIE cost; no successful private test is recorded yet.</Notice>
        ) : null}
      </section>

      {d.access.canPublish ? <DisplayEditor d={d} onChanged={onChanged} /> : null}
      {d.access.canPublish ? <EvidenceForm modelId={m.id} onChanged={onChanged} /> : null}
      {avail.dialog}
    </div>
  );
}

function DisplayEditor({ d, onChanged }: { d: ModelDetail; onChanged: () => void }) {
  const m = d.model;
  const [name, setName] = useState(m.name);
  const [purpose, setPurpose] = useState(m.purpose);
  const [badges, setBadges] = useState<string[]>(m.badges);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/catalog/models/${m.id}/display`, { body: { name, purpose, badges } });
      setMsg({ tone: "success", text: "Saved. Customers see the new name and description." });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-xl border border-rule p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink-dark">Customer-facing name, description and badges</summary>
      <div className="mt-3 grid gap-3">
        <Field label="Display name">
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Short use-case description" hint="Shown under the model name. Describe what it is good at; do not claim it is the best at everything.">
          <textarea value={purpose} maxLength={200} rows={2} onChange={(e) => setPurpose(e.target.value)} className={cn(inputCls, "h-auto py-2")} />
        </Field>
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1 font-semibold text-ink-dark">Badges</legend>
          {["recommended", "premium", "budget", "fast", "long"].map((b) => (
            <label key={b} className="flex items-center gap-1.5">
              <input type="checkbox" checked={badges.includes(b)} onChange={() => setBadges(badges.includes(b) ? badges.filter((x) => x !== b) : [...badges, b])} className="size-4 accent-brand-blue" />
              {b === "long" ? "Longer clips" : b[0].toUpperCase() + b.slice(1)}
            </label>
          ))}
        </fieldset>
        <div>
          <Button size="sm" busy={busy} onClick={() => void save()}>
            Save display
          </Button>
        </div>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </div>
    </details>
  );
}

function EvidenceForm({ modelId, onChanged }: { modelId: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  return (
    <details className="rounded-xl border border-rule p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink-dark">Record manual or imported evidence</summary>
      <p className="mt-2 text-sm text-muted-dark">
        For checks done outside Genlixs (for example a result you verified elsewhere). It is labelled “Manual evidence” and never counts as an integrated test.
      </p>
      <textarea value={text} rows={3} maxLength={1000} onChange={(e) => setText(e.target.value)} aria-label="Evidence" className={cn(inputCls, "mt-2 h-auto w-full py-2")} />
      <Button
        size="sm"
        className="mt-2"
        busy={busy}
        disabled={text.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/admin/catalog/models/${modelId}/evidence`, { body: { evidence: text } });
            setText("");
            setMsg({ tone: "success", text: "Evidence recorded." });
            onChanged();
          } catch (e) {
            setMsg({ tone: "error", text: errorMessage(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Record evidence
      </Button>
      {msg ? <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
    </details>
  );
}

// --------------------------------------------------------------------------------------------- pricing

function PricingSection({ d, economics, onChanged }: { d: ModelDetail; economics: CatalogData["economics"]; onChanged: () => void }) {
  const t = d.table;
  const spec = d.model.capability.spec;
  const [units, setUnits] = useState<Record<string, string>>(() =>
    Object.fromEntries((t?.configs ?? []).map((c) => [c.key, String(c.draftUnits ?? c.currentUnits ?? "")])),
  );
  const [markup, setMarkup] = useState("300");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "attention"; text: string } | null>(null);
  const [lossReason, setLossReason] = useState<string | null>(null);

  if (!t) {
    return (
      <div className="space-y-4">
        <Notice>Your role sees customer prices but not KIE costs or margins.</Notice>
        <PriceHistory d={d} onChanged={onChanged} />
      </div>
    );
  }
  const basis = economics?.basis;
  const a = economics?.assumptions;
  const draft = d.prices.find((p) => p.state === "draft" && p.currentCapability);
  const parsed = Object.fromEntries(Object.entries(units).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));
  const invalid = t.configs.some((c) => {
    const v = parsed[c.key];
    return v === null || v === undefined || !Number.isInteger(v) || v < 1;
  });

  const fill = async () => {
    setBusy("fill");
    setMsg(null);
    try {
      const p = await api<{ models: { configs: { key: string; proposedUnits: number | null }[] }[] }>("/api/admin/catalog/bulk-pricing/preview", {
        body: { scope: "selected", modelIds: [d.model.id], markupPercent: Number(markup) },
      });
      setUnits(Object.fromEntries(p.models[0].configs.map((c) => [c.key, c.proposedUnits === null ? "" : String(c.proposedUnits)])));
      setMsg({ tone: "success", text: `Filled from KIE cost +${markup} %. Review, then save as a draft.` });
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const saveDraft = async () => {
    setBusy("save");
    setMsg(null);
    try {
      await api(`/api/admin/catalog/models/${d.model.id}/prices`, { body: { units: parsed } });
      setMsg({ tone: "success", text: "Draft saved as a new version. Publish it when it is approved." });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const publish = async (reason?: string) => {
    if (!draft) return;
    setBusy("publish");
    setMsg(null);
    try {
      await api(`/api/admin/catalog/prices/${draft.id}/publish`, { body: reason ? { reason } : {} });
      setLossReason(null);
      setMsg({ tone: "success", text: `Price v${draft.version} published. New quotes use it; running jobs keep their quoted price.` });
      onChanged();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "LOSS_REASON_REQUIRED") {
        setLossReason("");
        setMsg({ tone: "attention", text: e.message });
      } else setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {t.status === "incomplete_cost" || t.status === "missing_cost" ? (
        <Notice tone="error" title="KIE cost is missing for some configurations">
          Prices cannot be calculated or published until every configuration has a recorded cost. Open the KIE cost section.
        </Notice>
      ) : null}
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <Info label="KIE cost source" value={t.cost ? `v${t.cost.version} · ${t.cost.sourceKind} · checked ${day(t.cost.checkedAt)}` : "None"} warn={t.cost?.stale} />
        <Info
          label="Lowest revenue per credit"
          value={basis?.minRevenuePerCredit ? `${fmtUsd4(basis.minRevenuePerCredit)} (${basis.conservative?.name ?? ""}${basis.source === "draft" ? ", draft" : ""})` : "No USD package"}
        />
        <Info
          label="Commission scenarios"
          value={a ? `30 % → ${a.affiliate.baseBps / 100} %, 50 % → ${a.affiliate.upliftBps / 100} % (after ${a.affiliate.threshold} paying customers)` : "—"}
        />
      </div>
      {d.access.canPrice ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Markup above KIE cost (%)" hint="Target price = KIE cost × (1 + markup ÷ 100). +100 % = 2× cost, +300 % = 4× cost. Not a profit margin.">
            <input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} className={cn(inputCls, "w-36")} />
          </Field>
          <Button variant="secondary-light" busy={busy === "fill"} onClick={() => void fill()}>
            Fill charges from markup
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-rule">
        <table className="w-full min-w-[920px] text-left text-sm">
          <caption className="sr-only">Credit charge per configuration with KIE cost and estimated contribution</caption>
          <thead className="bg-paper text-xs text-muted-dark">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Configuration</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">KIE cost</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Published</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">New charge (credits)</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Revenue</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Direct</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">30 % partner</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">50 % partner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {t.configs.map((c) => {
              const v = parsed[c.key];
              const contrib = contributionOf(v ?? null, c.supplierUsd, basis, a);
              return (
                <tr key={c.key}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink-dark">
                    {configLabel(spec, c.options)}
                  </th>
                  <td className="px-3 py-2 text-right tabular">
                    {fmtKie(c.supplierCredits)}
                    <span className="block text-xs text-muted-dark">{fmtUsd4(c.supplierUsd)}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtGx(c.currentUnits)}</td>
                  <td className="px-3 py-2 text-right">
                    {d.access.canPrice ? (
                      <input
                        aria-label={`Credits for ${configLabel(spec, c.options)}`}
                        inputMode="numeric"
                        value={units[c.key] ?? ""}
                        onChange={(e) => setUnits({ ...units, [c.key]: e.target.value.replace(/[^0-9]/g, "") })}
                        className={cn(inputCls, "h-9 w-24 text-right tabular", v !== null && v !== undefined && v < 1 && "border-error-text")}
                      />
                    ) : (
                      <span className="tabular">{fmtGx(c.draftUnits)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular">{fmtUsd4(contrib?.revenueUsd)}</td>
                  <ContributionCells c={contrib} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-dark">
        Revenue = credits × the lowest package revenue per credit. Contribution {a && (a.paymentFeeBps === null || a.paymentFixedFeeUsd === null || a.operatingCostUsdPerJob === null) ? "is before unknown payment fees and operating costs (set them under Packages)" : "includes the payment fee and operating cost assumptions"}; it is
        not net profit. Live figures preview an unsaved edit; the server recalculates on save.
      </p>
      {d.access.canPrice || d.access.canPublish ? (
        <div className="flex flex-wrap items-center gap-2">
          {d.access.canPrice ? (
            <Button variant="secondary-light" busy={busy === "save"} disabled={invalid} onClick={() => void saveDraft()}>
              Save as draft
            </Button>
          ) : null}
          {d.access.canPublish && draft ? (
            <Button busy={busy === "publish"} onClick={() => void publish()}>
              Publish draft v{draft.version}
            </Button>
          ) : null}
          {invalid && d.access.canPrice ? <span className="text-xs text-muted-dark">Every configuration needs a whole number of credits (at least 1).</span> : null}
        </div>
      ) : null}
      {lossReason !== null ? (
        <div className="space-y-2 rounded-xl border border-[#f6c4c4] bg-error-tint p-4">
          <Field label="Reason for publishing below KIE cost (recorded in the audit log)">
            <input value={lossReason} onChange={(e) => setLossReason(e.target.value)} className={inputCls} />
          </Field>
          <Button variant="danger" size="sm" disabled={lossReason.trim().length < 3} busy={busy === "publish"} onClick={() => void publish(lossReason)}>
            Publish anyway
          </Button>
        </div>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <PriceHistory d={d} onChanged={onChanged} />
    </div>
  );
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-rule bg-paper px-3 py-2">
      <p className="text-xs font-semibold text-muted-dark">{label}</p>
      <p className="mt-0.5 text-ink-dark">
        {value} {warn ? <Badge surface="light" tone="attention">Stale</Badge> : null}
      </p>
    </div>
  );
}

function PriceHistory({ d, onChanged }: { d: ModelDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section aria-labelledby="hist-h">
      <h3 id="hist-h" className="text-sm font-semibold text-ink-dark">
        Price versions
      </h3>
      <p className="text-xs text-muted-dark">Versions never change once published. Restoring publishes a new version that copies an earlier one.</p>
      {d.prices.length === 0 ? (
        <div className="mt-2">
          <Empty>No price versions yet.</Empty>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule text-sm">
          {d.prices.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <span className="font-semibold">v{p.version}</span>
              <Badge surface="light" tone={p.state === "published" ? "success" : p.state === "draft" ? "info" : "neutral"}>
                {p.state}
              </Badge>
              <span className="text-muted-dark">
                {p.source}
                {p.markupBps !== null ? ` · +${p.markupBps / 100} %` : ""}
                {p.batchRef ? ` · ${p.batchRef}` : ""}
                {p.restoredFromVersion ? ` · copy of v${p.restoredFromVersion}` : ""}
                {p.effectiveAt ? ` · from ${when(p.effectiveAt)}` : ""}
                {p.publishedBy ? ` · ${p.publishedBy}` : ""}
                {!p.currentCapability ? " · older options" : ""}
              </span>
              {d.access.canPublish && p.state === "retired" && p.currentCapability && p.source !== "seed" ? (
                <Button
                  size="sm"
                  variant="ghost-light"
                  className="ml-auto"
                  busy={busy === p.id}
                  onClick={async () => {
                    setBusy(p.id);
                    setErr(null);
                    try {
                      await api(`/api/admin/catalog/prices/${p.id}/restore`, { body: {} });
                      onChanged();
                    } catch (e) {
                      setErr(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Restore as new version
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {err ? <div className="mt-2"><Notice tone="error">{err}</Notice></div> : null}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------- test

function TestSection({ d, onChanged }: { d: ModelDetail; onChanged: () => void }) {
  const spec = d.model.capability.spec;
  const defaults = useMemo(() => Object.fromEntries(Object.entries(spec.options).map(([k, o]) => [k, o.default])), [spec]);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<Record<string, string | number>>(defaults);
  const [reference, setReference] = useState<LiveReference>({ status: "empty" });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  // One idempotency key per test intent: a repeated click or a retried request returns the same job.
  const intent = JSON.stringify([prompt.trim(), options, reference.status === "ready" ? reference.assetId : null]);
  const keys = useRef(new Map<string, string>());

  const needsRef = (spec.references?.min ?? 0) > 0;
  const cost = d.table?.configs.find((c) => Object.entries(c.options).every(([k, v]) => String(options[k]) === String(v)));
  const running = d.tests.find((t) => t.status === "running");

  if (!d.access.canTest) return <Notice>Only the owner and operations staff can run paid tests.</Notice>;
  const run = async () => {
    const key = keys.current.get(intent) ?? newIdempotencyKey();
    keys.current.set(intent, key);
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ job: { ref: string }; replayed: boolean }>(`/api/admin/catalog/models/${d.model.id}/tests`, {
        body: { prompt: prompt.trim(), options, referenceAssetIds: reference.status === "ready" ? [reference.assetId] : [], confirmSpend: true },
        idempotencyKey: key,
      });
      setMsg({ tone: "success", text: r.replayed ? `Already started as ${r.job.ref}; not sent twice.` : `Test ${r.job.ref} queued. Its status updates below.` });
      setConfirmed(false);
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <Notice>
        Private and staff-only: the model may stay disabled for customers. The test uses the normal pipeline (queue, KIE task tracking, safe import and private
        storage). It charges no customer wallet, creates no order and earns no commission. Only a delivered, validated file marks this entry “Verified by test”.
      </Notice>
      {!d.runtime.submitsEnabled ? <Notice tone="attention">This deployment cannot send work to KIE, so tests are disabled here.</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Prompt" hint={`${spec.prompt.min}–${spec.prompt.max} characters.`}>
            <textarea value={prompt} maxLength={spec.prompt.max} rows={4} onChange={(e) => setPrompt(e.target.value)} className={cn(inputCls, "h-auto py-2")} />
          </Field>
          {needsRef ? (
            <div className="rounded-xl bg-canvas p-3 text-ink">
              <LiveReferenceUploader value={reference} onChange={setReference} />
            </div>
          ) : null}
        </div>
        <div className="grid content-start gap-3 sm:grid-cols-2">
          {Object.entries(spec.options).map(([k, o]) => (
            <Field key={k} label={o.label}>
              <select
                value={String(options[k])}
                disabled={o.values.length < 2}
                onChange={(e) => setOptions({ ...options, [k]: typeof o.values[0] === "number" ? Number(e.target.value) : e.target.value })}
                className={inputCls}
              >
                {o.values.map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {o.labels?.[String(v)] ?? (k === "duration" ? `${v} s` : String(v))}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-[#f3d9a8] bg-orange-tint p-4 text-sm text-orange-text">
        <p className="font-semibold">
          Expected KIE cost: {cost ? `${fmtKie(cost.supplierCredits)} (${fmtUsd4(cost.supplierUsd)})` : "unknown for these settings"}
        </p>
        <p className="mt-0.5">Estimate from the documented cost schedule. KIE reports the actual credits per task when the test finishes.</p>
        <label className="mt-3 flex items-start gap-2 font-semibold">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 size-4 accent-brand-blue" />
          I understand this spends credits from the owner’s KIE balance.
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          busy={busy}
          disabled={!confirmed || !d.runtime.submitsEnabled || prompt.trim().length < spec.prompt.min || (needsRef && reference.status !== "ready") || Boolean(running)}
          onClick={() => void run()}
        >
          Run paid test
        </Button>
        {running ? <span className="text-sm text-muted-dark">Test {running.ref} is still running; one test per model at a time.</span> : null}
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <section aria-labelledby="tests-h">
        <h3 id="tests-h" className="text-sm font-semibold text-ink-dark">
          Test results
        </h3>
        {d.tests.length === 0 ? (
          <div className="mt-2">
            <Empty>No tests yet.</Empty>
          </div>
        ) : (
          <ul className="mt-2 space-y-3">
            {d.tests.map((t) => (
              <TestCard key={t.jobId} t={t} spec={spec} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TestCard({ t, spec }: { t: TestRun; spec: ModelDetail["model"]["capability"]["spec"] }) {
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = async (assetId: string) => {
    setErr(null);
    try {
      setPreview(await api<{ url: string; mime: string }>(`/api/admin/catalog/tests/outputs/${assetId}`));
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const tone = t.status === "succeeded" ? "success" : t.status === "failed" ? "error" : t.status === "running" ? "info" : "neutral";
  return (
    <li className="rounded-xl border border-rule p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t.ref}</span>
        <Badge surface="light" tone={tone} icon={t.status === "running" ? "busy" : undefined}>
          {t.status === "running" ? `Running · ${t.jobState.replace(/_/g, " ")}` : t.status}
        </Badge>
        <span className="text-muted-dark">
          {when(t.createdAt)} · {t.requestedBy ?? "staff"} · options v{t.capabilityVersion}
        </span>
      </div>
      <p className="mt-1 text-muted-dark">
        {configLabel(spec, t.options)} · “{t.prompt.slice(0, 120)}
        {t.prompt.length > 120 ? "…" : ""}”
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="inline text-muted-dark">KIE task: </dt>
          <dd className="inline font-mono text-xs">{t.taskId ?? "not assigned yet"}</dd>
        </div>
        <div>
          <dt className="inline text-muted-dark">Cost: </dt>
          <dd className="inline">
            {t.observedSupplierCredits !== null ? `${fmtKie(t.observedSupplierCredits)} reported by KIE` : `${fmtKie(t.estimatedSupplierCredits)} estimated`}
            {t.costProvenance ? <span className="text-xs text-muted-dark"> ({t.costProvenance})</span> : null}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-dark">Finished: </dt>
          <dd className="inline">{when(t.completedAt)}</dd>
        </div>
        {t.failureCode ? (
          <div>
            <dt className="inline text-muted-dark">Failure: </dt>
            <dd className="inline">
              {t.failureCode}
              {t.failureMessage ? ` — ${t.failureMessage}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {t.outputs.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {t.outputs.map((o) => (
            <Button key={o.assetId} size="sm" variant="secondary-light" onClick={() => void open(o.assetId)}>
              Preview output {o.width && o.height ? `(${o.width}×${o.height})` : ""}
            </Button>
          ))}
          {preview ? (
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 self-center text-sm font-semibold text-info-text underline">
              Download <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-rule bg-paper">
          {preview.mime.startsWith("video/") ? (
            <video src={preview.url} controls muted playsInline className="max-h-80 w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private test output
            <img src={preview.url} alt={`Test output for ${t.ref}`} className="max-h-80 w-full object-contain" />
          )}
        </div>
      ) : null}
      {err ? <div className="mt-2"><Notice tone="error">{err}</Notice></div> : null}
      {t.events.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-muted-dark">Timeline</summary>
          <ol className="mt-1 space-y-0.5 text-xs text-muted-dark">
            {t.events.map((e, i) => (
              <li key={i}>
                {when(e.at)} · {e.message}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------------------------------------------- cost

function CostSection({ d, onChanged }: { d: ModelDetail; onChanged: () => void }) {
  const current = d.costVersions?.[0];
  const spec = d.model.capability.spec;
  const keys = current ? scheduleKeys(current.schedule.dims, spec.options) : [];
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k.key, String(current?.schedule.rates[k.key] ?? "")])));
  const [sourceKind, setSourceKind] = useState<"documented" | "manual" | "observed">("documented");
  const [sourceUrl, setSourceUrl] = useState(d.model.pricingUrl ?? "https://kie.ai/pricing");
  const [checkedAt, setCheckedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  if (!d.costVersions) return <Notice>Your role cannot see KIE costs.</Notice>;
  if (!current) return <Notice tone="error">No cost structure is recorded for this model.</Notice>;
  const observed = d.tests.filter((t) => t.observedSupplierCredits !== null);
  const usd = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? fmtUsd4(Number(v) * current.usdPerCredit) : "—");
  const valid = keys.every((k) => {
    const n = Number(rates[k.key]);
    return rates[k.key]?.trim() && Number.isFinite(n) && n > 0;
  });
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ version: number }>(`/api/admin/catalog/models/${d.model.id}/costs`, {
        body: { rates: Object.fromEntries(keys.map((k) => [k.key, Number(rates[k.key])])), sourceKind, sourceUrl: sourceUrl.trim() || null, checkedAt, note: note.trim() || null },
      });
      setMsg({ tone: "success", text: `KIE cost v${r.version} recorded. Re-run the price preview to see its effect.` });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Notice>
        KIE publishes prices on its pricing page; it has no documented price API, so Genlixs never syncs costs automatically. Check the source, then record a
        new version here (it keeps the old ones). Rates are KIE credits {unitLabel(current.schedule.unit, spec.output.kind)}; USD uses KIE’s standard {fmtUsd4(current.usdPerCredit)} per
        credit (larger top-ups add 5–10 % bonus credits, so the amount you actually paid can be lower).
      </Notice>
      <div className="flex flex-wrap gap-3 text-sm">
        {d.model.pricingUrl ? (
          <a href={d.model.pricingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-info-text underline">
            KIE pricing for this model <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
        {d.model.docsUrl ? (
          <a href={d.model.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-info-text underline">
            API documentation <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-rule">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">KIE credit rate per configuration</caption>
          <thead className="bg-paper text-xs text-muted-dark">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Configuration</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Current (v{current.version})</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">New rate (KIE credits)</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">USD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {keys.map((k) => (
              <tr key={k.key}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {configLabel(spec, k.options)}
                </th>
                <td className="px-3 py-2 text-right tabular">{fmtKie(current.schedule.rates[k.key] ?? null)}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    aria-label={`KIE credits for ${configLabel(spec, k.options)}`}
                    inputMode="decimal"
                    value={rates[k.key] ?? ""}
                    disabled={!d.access.canPrice}
                    onChange={(e) => setRates({ ...rates, [k.key]: e.target.value })}
                    className={cn(inputCls, "h-9 w-28 text-right tabular")}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular">{usd(rates[k.key] ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {current.schedule.unit === "second" ? <p className="text-xs text-muted-dark">Per-second rates are multiplied by the clip length for each configuration.</p> : null}
      {d.access.canPrice ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Source">
            <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)} className={inputCls}>
              <option value="documented">KIE pricing page</option>
              <option value="observed">Observed in tests</option>
              <option value="manual">Other (explain in note)</option>
            </select>
          </Field>
          <Field label="Source link">
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Checked on">
            <input type="date" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Note (optional)">
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button busy={busy} disabled={!valid} onClick={() => void save()}>
              Record new cost version
            </Button>
          </div>
        </div>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <section aria-labelledby="obs-h">
        <h3 id="obs-h" className="text-sm font-semibold text-ink-dark">
          Observed in private tests
        </h3>
        {observed.length === 0 ? (
          <p className="mt-1 text-sm text-muted-dark">No test has reported KIE’s per-task credits yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {observed.map((t) => (
              <li key={t.jobId}>
                {t.ref} · {configLabel(spec, t.options)}: KIE reported {fmtKie(t.observedSupplierCredits)} vs {fmtKie(t.estimatedSupplierCredits)} estimated
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="costv-h">
        <h3 id="costv-h" className="text-sm font-semibold text-ink-dark">
          Cost versions
        </h3>
        <ul className="mt-1 divide-y divide-rule rounded-xl border border-rule text-sm">
          {d.costVersions.map((c) => (
            <li key={c.id} className="px-4 py-2.5">
              <span className="font-semibold">v{c.version}</span> · {c.sourceKind} · checked {day(c.checkedAt)}
              {c.createdBy ? ` · ${c.createdBy}` : ""}
              {c.note ? <span className="block text-xs text-muted-dark">{c.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// -------------------------------------------------------------------------------------- activity, advanced

function ActivitySection({ d }: { d: ModelDetail }) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="act-h">
        <h3 id="act-h" className="text-sm font-semibold text-ink-dark">
          Activity
        </h3>
        {d.activity.length === 0 ? (
          <div className="mt-2">
            <Empty>No staff actions recorded for this model yet.</Empty>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule text-sm">
            {d.activity.map((a, i) => (
              <li key={i} className="px-4 py-2.5">
                <p className="font-semibold text-ink-dark">{a.reason ?? a.action}</p>
                <p className="text-xs text-muted-dark">
                  {when(a.at)} · {a.actor ?? "system"} · {a.action}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="ev-h">
        <h3 id="ev-h" className="text-sm font-semibold text-ink-dark">
          Verification evidence
        </h3>
        {d.evidence.length === 0 ? (
          <p className="mt-1 text-sm text-muted-dark">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule text-sm">
            {d.evidence.map((e, i) => (
              <li key={i} className="px-4 py-2.5">
                <Badge surface="light" tone={e.kind === "integrated_test" ? (e.outcome === "passed" ? "success" : "error") : "info"}>
                  {e.kind === "integrated_test" ? `Integrated test · ${e.outcome}` : "Manual evidence"}
                </Badge>
                <p className="mt-1">{e.note}</p>
                <p className="text-xs text-muted-dark">
                  {when(e.at)} · {e.recordedBy ?? "staff"}
                  {e.taskId ? ` · task ${e.taskId}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AdvancedSection({ d }: { d: ModelDetail }) {
  const m = d.model;
  return (
    <details className="rounded-xl border border-rule p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-ink-dark">Technical identifiers and raw data</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[12rem_1fr]">
        <dt className="text-muted-dark">Catalog id</dt>
        <dd className="font-mono text-xs">{m.id}</dd>
        <dt className="text-muted-dark">KIE model</dt>
        <dd className="font-mono text-xs">{m.providerModelId}</dd>
        <dt className="text-muted-dark">Adapter</dt>
        <dd className="font-mono text-xs">
          {m.adapter} v{m.adapterVersion}
        </dd>
        <dt className="text-muted-dark">Option schema</dt>
        <dd>v{m.capability.version}</dd>
      </dl>
      <p className="mt-3 text-xs font-semibold text-muted-dark">Option schema (JSON)</p>
      <pre className="scroll-thin mt-1 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs">{JSON.stringify(m.capability.spec, null, 2)}</pre>
      {d.prices[0] ? (
        <>
          <p className="mt-3 text-xs font-semibold text-muted-dark">Latest price rules v{d.prices[0].version} (JSON)</p>
          <pre className="scroll-thin mt-1 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs">{JSON.stringify(d.prices[0].rules, null, 2)}</pre>
        </>
      ) : null}
      {d.costVersions?.[0] ? (
        <>
          <p className="mt-3 text-xs font-semibold text-muted-dark">KIE cost schedule v{d.costVersions[0].version} (JSON)</p>
          <pre className="scroll-thin mt-1 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs">{JSON.stringify(d.costVersions[0].schedule, null, 2)}</pre>
        </>
      ) : null}
    </details>
  );
}

