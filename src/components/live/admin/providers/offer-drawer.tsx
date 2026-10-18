"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { Field, inputCls, Notice, Switch, Tabs, when } from "../catalog/shared";
import { DecisionBadge, KV, native, STATUS_INFO, StatusBadge, UNIT_LABEL, usd } from "./parts";
import type { CostUnit, OfferDetail, OfferStatus, RoutingModel, Schedule } from "./types";

type Msg = { tone: "error" | "success" | "attention"; text: string } | null;
type Section = "details" | "price" | "capabilities" | "test";

/** One supplier offer: evidence, verification, routing switch, versioned price and a paid test of exactly this offer. */
export function OfferDrawer({
  offerId,
  model,
  canManage,
  canTest,
  units,
  onClose,
  onChanged,
}: {
  offerId: string;
  model: RoutingModel | null;
  canManage: boolean;
  canTest: boolean;
  units: CostUnit[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const d = useApi<OfferDetail>(`/api/admin/providers/offers/${offerId}`);
  const [section, setSection] = useState<Section>("details");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const o = d.data;

  const update = async (what: string, patch: Record<string, unknown>, reason?: string, ok = "Saved.") => {
    setBusy(what);
    setMsg(null);
    try {
      await api(`/api/admin/providers/offers/${offerId}`, { body: { patch, reason } });
      setMsg({ tone: "success", text: ok });
      d.reload();
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      surface="light"
      size="xl"
      onClose={onClose}
      title={o ? `${o.providerName} · ${o.productLabel}` : "Offer"}
      description={o ? `${o.modelId ? `Serves ${model?.name ?? o.modelId}` : "Not used by a Genlixs model"} · provider model ${o.upstreamModelId ?? "not confirmed"}` : undefined}
    >
      {!o ? (
        d.error ? <Notice tone="error">{d.error.message}</Notice> : <div role="status" aria-busy="true" aria-label="Loading" className="h-40 animate-pulse-soft rounded-xl bg-paper" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={o.status} />
            <DecisionBadge decision={o.decision} />
            {o.legacy ? <span className="text-xs text-muted-dark">Original route of this model (follows its catalog capability and KIE cost)</span> : null}
            <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
              Routing {o.routingEnabled ? "on" : "off"}
              <Switch
                checked={o.routingEnabled}
                label="Use this offer for new jobs"
                disabled={!canManage || !o.modelId}
                busy={busy === "routing"}
                onChange={(v) =>
                  void update("routing", { routingEnabled: v }, undefined, v ? "Routing on: new jobs use this offer when it is the cheapest eligible one." : "Routing off: new jobs no longer use this offer; jobs already sent finish normally.")
                }
              />
            </label>
          </div>
          {o.blocker ? <Notice tone="attention" title="Open issue">{o.blocker}</Notice> : null}
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
          <Tabs<Section>
            label="Offer sections"
            value={section}
            onChange={setSection}
            tabs={[
              { id: "details", label: "Details" },
              { id: "price", label: "Price", count: o.prices.length },
              { id: "capabilities", label: "Capabilities" },
              ...(o.modelId && o.adapter ? [{ id: "test" as const, label: "Test" }] : []),
            ]}
          />
          {section === "details" ? <Details o={o} canManage={canManage} busy={busy} update={update} /> : null}
          {section === "price" ? <PriceSection o={o} canManage={canManage} units={units} onSaved={() => { d.reload(); onChanged(); }} /> : null}
          {section === "capabilities" ? <Capabilities o={o} canManage={canManage} busy={busy === "caps"} update={update} /> : null}
          {section === "test" ? <OfferTest o={o} model={model} canRun={canManage && canTest} /> : null}
        </div>
      )}
    </Dialog>
  );
}

function Details({ o, canManage, busy, update }: { o: OfferDetail; canManage: boolean; busy: string | null; update: (w: string, p: Record<string, unknown>, r?: string, ok?: string) => Promise<void> }) {
  const [status, setStatus] = useState<OfferStatus>(o.status);
  const [note, setNote] = useState(o.verificationNote ?? "");
  const [overrideDays, setOverrideDays] = useState("7");
  const [overrideReason, setOverrideReason] = useState("");
  return (
    <div className="space-y-5">
      <dl>
        <KV k="Operation">{o.operation.replace(/_/g, " ")}</KV>
        <KV k="Integration">{o.adapter ?? "None in this release"}</KV>
        <KV k="Decision">{o.decisionReason ?? "—"}{o.decidedAt ? ` (${when(o.decidedAt)})` : ""}</KV>
        <KV k="Current price">
          {o.price ? `${o.price.kind === "supplier_cost" ? "KIE cost" : "Price"} v${o.price.version} · ${o.price.confidence} · checked ${when(o.price.checkedAt)}` : "None"}
        </KV>
        <KV k="Verified">{o.verifiedAt ? `${when(o.verifiedAt)} — ${o.verificationNote ?? ""}` : "Not verified"}</KV>
        <KV k="Stale-price override">{o.priceOverrideUntil ? `until ${when(o.priceOverrideUntil)}` : "None"}</KV>
        <KV k="Sources">
          {[o.sourceUrl, o.docsUrl].filter(Boolean).map((u) => (
            <a key={u!} href={u!} target="_blank" rel="noopener noreferrer" className="mr-3 inline-flex items-center gap-1 text-info-text underline">
              {new URL(u!).hostname} <ExternalLink aria-hidden className="size-3" />
            </a>
          ))}
        </KV>
      </dl>
      {o.recentJobs.length ? (
        <div>
          <p className="text-sm font-semibold">Recent jobs on this offer</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-dark">
            {o.recentJobs.map((j) => (
              <li key={j.jobId}>
                {when(j.at)} · {j.ref} · {j.purpose === "staff_test" ? "test" : "customer"} · {j.state} · est. {usd(j.estimatedUsd)} · charged {usd(j.confirmedUsd)} ({j.ledgerState})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canManage && !o.legacy ? (
        <fieldset className="grid gap-3 rounded-xl border border-rule p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold">Verification</legend>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as OfferStatus)} className={inputCls}>
              {(Object.keys(STATUS_INFO) as OfferStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_INFO[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How it was verified" hint="Required for Verified: for example the test job reference and what was checked (size, length, audio).">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Button size="sm" busy={busy === "status"} onClick={() => void update("status", { status, verificationNote: note }, undefined, "Status saved.")}>
              Save status
            </Button>
          </div>
        </fieldset>
      ) : null}
      {canManage && !o.legacy ? (
        <fieldset className="grid gap-3 rounded-xl border border-rule p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <legend className="px-1 text-sm font-semibold">Use a stale price anyway (audited)</legend>
          <Field label="Days">
            <input inputMode="numeric" value={overrideDays} onChange={(e) => setOverrideDays(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Reason">
            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary-light" busy={busy === "override"} disabled={overrideReason.trim().length < 3} onClick={() => void update("override", { priceOverrideDays: overrideDays }, overrideReason, "Override saved.")}>
              Allow
            </Button>
            {o.priceOverrideUntil ? (
              <Button size="sm" variant="ghost-light" busy={busy === "override-clear"} onClick={() => void update("override-clear", { priceOverrideDays: null }, "Override removed", "Override removed.")}>
                Remove
              </Button>
            ) : null}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

/** Structured price editor: rates per configuration, never JSON. A blank rate stays unknown (it is not zero). */
function PriceSection({ o, canManage, units, onSaved }: { o: OfferDetail; canManage: boolean; units: CostUnit[]; onSaved: () => void }) {
  const cur = o.price?.kind === "offer" ? o.price : null;
  const base: Schedule = cur?.schedule ?? { basis: "output", dims: ["resolution"], rates: {} };
  const [unit, setUnit] = useState(cur?.unit ?? "usd");
  const [basis, setBasis] = useState<Schedule["basis"]>(base.basis);
  const [dims, setDims] = useState(base.dims.join(", "));
  const [rates, setRates] = useState<{ key: string; value: string }[]>(Object.entries(base.rates).map(([key, v]) => ({ key, value: String(v) })));
  const [secOpt, setSecOpt] = useState(base.seconds?.option ?? "duration");
  const [inSlots, setInSlots] = useState(base.inputSeconds?.slots.join(", ") ?? "");
  const [extra, setExtra] = useState({ slots: base.extraImages?.slots.join(", ") ?? "", free: String(base.extraImages?.free ?? ""), rate: base.extraImages?.rate === null || base.extraImages?.rate === undefined ? "" : String(base.extraImages.rate) });
  const [meta, setMeta] = useState({ confidence: cur?.confidence ?? "documented", sourceKind: "documented", sourceUrl: cur?.sourceUrl ?? o.sourceUrl ?? "", checkedAt: new Date().toISOString().slice(0, 10), assumptions: cur?.assumptions ?? "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  if (o.legacy) {
    return (
      <Notice>
        The original route is priced by the KIE cost versions in Models (catalog). Current: {o.price ? `v${o.price.version}, checked ${when(o.price.checkedAt)}` : "none"}.
      </Notice>
    );
  }
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const schedule: Schedule = {
        basis,
        dims: list(dims),
        rates: Object.fromEntries(rates.filter((r) => r.value.trim() !== "").map((r) => [r.key.trim(), r.value.trim()])),
        ...(basis === "output_second" || basis === "io_second" ? { seconds: { option: secOpt.trim() || "duration" } } : {}),
        ...(basis === "io_second" ? { inputSeconds: { slots: list(inSlots) } } : {}),
        ...(extra.slots.trim() ? { extraImages: { slots: list(extra.slots), free: Number(extra.free) || 0, rate: extra.rate.trim() === "" ? null : extra.rate.trim() } } : {}),
      };
      await api(`/api/admin/providers/offers/${o.id}/price`, {
        body: { price: { unit, schedule, ...meta, checkedAt: new Date(meta.checkedAt).toISOString() }, expectedVersion: o.prices[0]?.version ?? null },
      });
      setMsg({ tone: "success", text: "New price version saved. Run the routing review to see its effect." });
      onSaved();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {o.prices.length ? (
        <ul className="space-y-1 text-xs text-muted-dark">
          {o.prices.map((p) => (
            <li key={p.id}>
              v{p.version} · {UNIT_LABEL[p.unit] ?? p.unit} · {p.confidence} · {p.sourceKind} · checked {when(p.checkedAt)}
              {p.expiresAt ? ` · expires ${when(p.expiresAt)}` : ""} · {Object.entries(p.schedule.rates).slice(0, 6).map(([k, v]) => `${k || "any"} ${native(Number(v), p.unit)}`).join(", ")}
              {p.assumptions ? ` — ${p.assumptions}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="attention">No price yet: this offer cannot be routed.</Notice>
      )}
      {canManage ? (
        <fieldset className="grid gap-3 rounded-xl border border-rule p-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">New price version</legend>
          <Field label="Unit">
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {units.map((u) => (
                <option key={u.unit} value={u.unit}>
                  {UNIT_LABEL[u.unit] ?? u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Billed">
            <select value={basis} onChange={(e) => setBasis(e.target.value as Schedule["basis"])} className={inputCls}>
              <option value="output">Per output (image or clip)</option>
              <option value="request">Per request</option>
              <option value="output_second">Per output second</option>
              <option value="io_second">Per input + output second</option>
            </select>
          </Field>
          <Field label="Price depends on (settings, comma separated)" hint="Rate rows use the values joined by |, e.g. 720p|off.">
            <input value={dims} onChange={(e) => setDims(e.target.value)} className={inputCls} />
          </Field>
          {basis === "output_second" || basis === "io_second" ? (
            <Field label="Seconds come from setting">
              <input value={secOpt} onChange={(e) => setSecOpt(e.target.value)} className={inputCls} />
            </Field>
          ) : null}
          {basis === "io_second" ? (
            <Field label="Input media slots counted">
              <input value={inSlots} onChange={(e) => setInSlots(e.target.value)} className={inputCls} placeholder="reference_video" />
            </Field>
          ) : null}
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="mb-1 text-sm font-semibold">Rates ({UNIT_LABEL[unit] ?? unit})</p>
            <div className="space-y-2">
              {rates.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input aria-label="Configuration" value={r.key} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className={cn(inputCls, "w-48")} />
                  <input aria-label="Rate" inputMode="decimal" value={r.value} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={cn(inputCls, "w-40")} />
                  <Button size="sm" variant="ghost-light" onClick={() => setRates(rates.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="secondary-light" onClick={() => setRates([...rates, { key: "", value: "" }])}>
                Add rate
              </Button>
            </div>
          </div>
          <Field label="Extra images: slots" hint="Charged per image beyond the free ones; empty = none.">
            <input value={extra.slots} onChange={(e) => setExtra({ ...extra, slots: e.target.value })} className={inputCls} placeholder="_references" />
          </Field>
          <Field label="Free images">
            <input inputMode="numeric" value={extra.free} onChange={(e) => setExtra({ ...extra, free: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Rate per extra image" hint="Empty = documented but unknown (such requests have no known cost).">
            <input inputMode="decimal" value={extra.rate} onChange={(e) => setExtra({ ...extra, rate: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Confidence">
            <select value={meta.confidence} onChange={(e) => setMeta({ ...meta, confidence: e.target.value as typeof meta.confidence })} className={inputCls}>
              <option value="authoritative">Account quote / authoritative</option>
              <option value="documented">Documented price</option>
              <option value="estimate">Provider estimate (token priced)</option>
              <option value="conflicting">Conflicting sources (not routed)</option>
              <option value="unverified">Unverified (not routed)</option>
            </select>
          </Field>
          <Field label="Source">
            <select value={meta.sourceKind} onChange={(e) => setMeta({ ...meta, sourceKind: e.target.value })} className={inputCls}>
              <option value="documented">Provider page</option>
              <option value="account_quote">Account quote</option>
              <option value="observed">Observed charge</option>
              <option value="manual">Manual</option>
            </select>
          </Field>
          <Field label="Source link">
            <input value={meta.sourceUrl} onChange={(e) => setMeta({ ...meta, sourceUrl: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Checked on">
            <input type="date" value={meta.checkedAt} onChange={(e) => setMeta({ ...meta, checkedAt: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Assumptions" className="sm:col-span-2">
            <input value={meta.assumptions} onChange={(e) => setMeta({ ...meta, assumptions: e.target.value })} className={inputCls} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button size="sm" busy={busy} disabled={!rates.some((r) => r.value.trim())} onClick={() => void save()}>
              Save new version
            </Button>
          </div>
        </fieldset>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}

/** Advanced: the capability object (validated on the server). A setting it does not list makes the offer incompatible. */
function Capabilities({ o, canManage, busy, update }: { o: OfferDetail; canManage: boolean; busy: boolean; update: (w: string, p: Record<string, unknown>, r?: string, ok?: string) => Promise<void> }) {
  const [text, setText] = useState(JSON.stringify(o.capabilities, null, 2));
  const [err, setErr] = useState<string | null>(null);
  if (o.legacy) return <Notice>The original route takes exactly the model&apos;s own capability, so it is compatible with every setting customers can choose.</Notice>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-dark">
        Lists what this supplier can do for the model: <code>options</code> (allowed values or a min/max range), <code>modes</code>, <code>inputs</code> with maximum counts and
        seconds, <code>maxPromptChars</code>, fixed <code>request</code> parameters and <code>notes</code>. A supplier that would ignore a requested setting must not list it.
      </p>
      <textarea
        aria-label="Capabilities"
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!canManage}
        spellCheck={false}
        className="h-72 w-full rounded-lg border border-rule-strong bg-sheet p-3 font-mono text-xs text-ink-dark"
      />
      {err ? <Notice tone="error">{err}</Notice> : null}
      {canManage ? (
        <Button
          size="sm"
          busy={busy}
          onClick={() => {
            setErr(null);
            let caps: unknown;
            try {
              caps = JSON.parse(text);
            } catch {
              setErr("This is not valid JSON.");
              return;
            }
            void update("caps", { capabilities: caps }, undefined, "Capabilities saved.");
          }}
        >
          Save capabilities
        </Button>
      ) : null}
    </div>
  );
}

/** Paid private test pinned to this offer, through the normal pipeline (result in the job's history). */
function OfferTest({ o, model, canRun }: { o: OfferDetail; model: RoutingModel | null; canRun: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [opts, setOpts] = useState<Record<string, string | number>>(model?.example.options ?? {});
  const [refIds, setRefIds] = useState("");
  const [inputs, setInputs] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}`));
  if (!canRun) return <Notice>Only the owner (with private-test permission) can run paid tests.</Notice>;
  const needsInputs = Boolean(model?.spec.inputs);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let parsedInputs: unknown = undefined;
      if (inputs.trim()) parsedInputs = JSON.parse(inputs);
      const r = await api<{ job: { id: string; ref?: string; short_ref?: string } }>(`/api/admin/providers/offers/${o.id}/test`, {
        body: {
          prompt,
          options: opts,
          inputs: parsedInputs,
          referenceAssetIds: refIds.split(",").map((x) => x.trim()).filter(Boolean),
          confirmSpend: confirm,
        },
        idempotencyKey: key,
      });
      setMsg({ tone: "success", text: `Test job created (${r.job.ref ?? r.job.short_ref ?? r.job.id}). Follow it in Jobs; record what you checked under Details.` });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof SyntaxError ? "Inputs must be JSON like {\"motion_video\": [\"<asset id>\"]}." : errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Notice tone="attention">
        This sends one paid generation to {o.providerName} with its saved key, whatever the routing switch says. It costs about the price shown under Price. No customer credits are used.
      </Notice>
      <Field label="Prompt">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="h-24 w-full rounded-lg border border-rule-strong bg-sheet p-3 text-sm" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {Object.entries(model?.spec.options ?? {}).map(([k, def]) =>
          def.derived ? null : (
            <Field key={k} label={def.label ?? k}>
              <select
                value={String(opts[k] ?? def.default ?? "")}
                onChange={(e) => setOpts({ ...opts, [k]: (def.values ?? []).find((v) => String(v) === e.target.value) ?? e.target.value })}
                className={inputCls}
              >
                {(def.values ?? []).map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {def.labels?.[String(v)] ?? String(v)}
                  </option>
                ))}
              </select>
            </Field>
          ),
        )}
      </div>
      {model?.spec.references && (model.spec.references.min ?? 0) > 0 ? (
        <Field label="Reference image asset ids (comma separated)" hint="Ids of images you uploaded (for example from a studio test).">
          <input value={refIds} onChange={(e) => setRefIds(e.target.value)} className={inputCls} />
        </Field>
      ) : null}
      {needsInputs ? (
        <Field label="Inputs (asset ids per slot, JSON)" hint='For example {"motion_video": ["…"], "character_image": ["…"]}. Ownership, type and length are checked on the server.'>
          <input value={inputs} onChange={(e) => setInputs(e.target.value)} className={cn(inputCls, "font-mono")} />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I understand this test spends {o.providerName} credits.
      </label>
      <Button busy={busy} disabled={!confirm} onClick={() => void run()}>
        Run paid test
      </Button>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}
