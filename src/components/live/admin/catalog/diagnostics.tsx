"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, CircleX, ExternalLink, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { LiveReferenceUploader, type LiveReference } from "@/components/live/studio/live-reference";
import { api, errorMessage, newIdempotencyKey } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { scheduleKeys } from "./math";
import { configLabel, day, Empty, Field, fmtKie, fmtUsd4, inputCls, ModelBadges, Notice, STATE_INFO, Tabs, unitLabel, VerificationBadge, when } from "./shared";
import type { AvailabilityState, ModelDetail, TestRun } from "./types";

export type DiagnosticsSection = "status" | "test" | "cost" | "activity" | "advanced";

/**
 * Optional diagnostics for one model, kept out of the everyday On/Off and pricing work: readiness, special states
 * (maintenance, experimental label), private paid tests, the KIE cost source, activity and technical details.
 */
export function Diagnostics({
  modelId,
  section,
  onSection,
  onClose,
  onChanged,
}: {
  modelId: string;
  section: DiagnosticsSection;
  onSection: (s: DiagnosticsSection) => void;
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
      title={m ? `${m.name}: details` : "Loading model…"}
      description={
        m ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge surface="light" tone={STATE_INFO[m.state].tone}>
              {STATE_INFO[m.state].label}
            </Badge>
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
          <Tabs<DiagnosticsSection>
            label="Detail sections"
            value={section}
            onChange={onSection}
            tabs={[
              { id: "status", label: "Status" },
              { id: "test", label: "Private test", count: d.data.tests.length || undefined },
              { id: "cost", label: "KIE cost" },
              { id: "activity", label: "Activity" },
              { id: "advanced", label: "Advanced" },
            ]}
          />
          {section === "status" ? <StatusSection d={d.data} onChanged={reloadAll} /> : null}
          {section === "test" ? <TestSection d={d.data} onChanged={reloadAll} /> : null}
          {section === "cost" ? <CostSection d={d.data} onChanged={reloadAll} /> : null}
          {section === "activity" ? <ActivitySection d={d.data} /> : null}
          {section === "advanced" ? <AdvancedSection d={d.data} /> : null}
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ status

const SPECIAL: { state: AvailabilityState; label: string; detail: string }[] = [
  { state: "enabled", label: "On", detail: "Customers can choose it and generate." },
  { state: "experimental", label: "On, labelled experimental", detail: "Customers can use it; it shows an Experimental label." },
  { state: "maintenance", label: "Paused for maintenance", detail: "Visible but unavailable, with your note. No new requests." },
  { state: "disabled", label: "Off", detail: "Hidden. New requests are refused; running jobs finish." },
];

function StatusSection({ d, onChanged }: { d: ModelDetail; onChanged: () => void }) {
  const m = d.model;
  const [state, setState] = useState<AvailabilityState>(m.state);
  const [note, setNote] = useState(m.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const checks = [
    ...d.readiness.checks,
    {
      key: "credentials",
      ok: d.runtime.submitsEnabled,
      warning: false,
      label: "Server can reach KIE",
      detail: d.runtime.submitsEnabled ? "This deployment can send work to KIE." : "KIE_API_KEY is missing here (or paid calls are disabled outside production).",
    },
  ];
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/catalog/models/${m.id}/availability`, {
        body: { state, note: state === "maintenance" || state === "experimental" ? note.trim() || null : null },
      });
      setMsg({ tone: "success", text: "Saved." });
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <section aria-labelledby="ready-h">
        <h3 id="ready-h" className="text-sm font-semibold text-ink-dark">
          What switching on needs
        </h3>
        <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {c.ok ? (
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" />
              ) : c.warning ? (
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-dark" />
              ) : (
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-error-text" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-dark">
                  {c.label} <span className="sr-only">{c.ok ? "(met)" : c.warning ? "(optional)" : "(not met)"}</span>
                </p>
                <p className="text-muted-dark">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-dark">
          Test status: <VerificationBadge model={m} /> A private test is optional; it never blocks switching a model on.
        </p>
      </section>

      <section aria-labelledby="state-h" className="space-y-3">
        <h3 id="state-h" className="text-sm font-semibold text-ink-dark">
          Special states
        </h3>
        <p className="text-sm text-muted-dark">The switch on Models &amp; pricing covers On and Off. Use these only for a maintenance pause or an experimental label.</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Availability</legend>
          {SPECIAL.map((s) => (
            <label key={s.state} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm", state === s.state ? "border-brand-blue bg-info-tint" : "border-rule")}>
              <input type="radio" name="availability" checked={state === s.state} onChange={() => setState(s.state)} disabled={!d.access.canOperate} className="mt-0.5 size-4 accent-brand-blue" />
              <span>
                <span className="block font-semibold text-ink-dark">{s.label}</span>
                <span className="text-muted-dark">{s.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {state === "maintenance" || state === "experimental" ? (
          <Field label="Note shown to customers (optional)" hint="For example: “Back later today”.">
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
        ) : null}
        {d.access.canOperate ? (
          <Button busy={busy} disabled={state === m.state && (note.trim() || null) === (m.note || null)} onClick={() => void save()}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-muted-dark">Your role can view but not change availability.</p>
        )}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </section>

      {d.access.canPublish ? <DisplayEditor d={d} onChanged={onChanged} /> : null}
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
      <summary className="cursor-pointer text-sm font-semibold text-ink-dark">Name, description and badges shown to customers</summary>
      <div className="mt-3 grid gap-3">
        <Field label="Display name">
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Short description" hint="Shown under the model name. Describe what it is good at.">
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
            Save
          </Button>
        </div>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </div>
    </details>
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
        Optional, private and staff-only: the model may stay off for customers. The test uses the normal pipeline (queue, KIE task tracking, safe import and
        private storage). It charges no customer wallet, creates no order and earns no commission. Only a delivered, validated file marks this entry “Tested”.
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
  const rate = d.table?.cost?.usdPerCredit ?? current.usdPerCredit;
  const usd = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? fmtUsd4(Number(v) * rate) : "—");
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
      setMsg({ tone: "success", text: `KIE price list v${r.version} recorded. The customer price follows it under the global pricing policy.` });
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
        new version here (it keeps the old ones). Rates are KIE credits {unitLabel(current.schedule.unit, spec.output.kind)} ({fmtUsd4(rate)} per KIE credit).
        This is the KIE reference of the model&apos;s price: recording a new version re-prices the model at once under the global pricing policy. Quotes
        already taken are re-checked before a job starts; accepted jobs keep their price.
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

