"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Scale, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { day, Empty, Field, inputCls, Notice, Switch, Tabs, when } from "../catalog/shared";
import { CandidateCost, DECISION_INFO, DecisionBadge, native, settingsText, StatusBadge, UNIT_LABEL, usd } from "./parts";
import { OfferDrawer } from "./offer-drawer";
import type { CostUnit, Offer, ReviewProposal, RoutePreview, RoutingModel, RoutingModels, RoutingReview } from "./types";

type Tool = "image" | "edit" | "video";

/**
 * Models: one row per public model with its active route, cheapest eligible offer and saving against KIE. `focusModel`
 * opens that model's comparison directly (links from Admin › Models).
 */
export function ModelsTab({ canManage, canTest, units, focusModel }: { canManage: boolean; canTest: boolean; units: CostUnit[]; focusModel?: string | null }) {
  const data = useApi<RoutingModels>("/api/admin/providers/models");
  const [tool, setTool] = useState<Tool>("image");
  const [compareId, setCompareId] = useState<string | null>(focusModel ?? null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [review, setReview] = useState(false);
  const [section, setSection] = useState<"models" | "inventory">("models");

  if (data.error && !data.data) {
    return (
      <Notice tone="error" title="Routing could not load" action={<Button size="sm" variant="secondary-light" onClick={data.reload}>Try again</Button>}>
        {data.error.message}
      </Notice>
    );
  }
  if (!data.data) return <div role="status" aria-busy="true" aria-label="Loading models" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />;
  const models = data.data.models.filter((m) => m.tool === tool);
  const model = compareId ? (data.data.models.find((m) => m.id === compareId) ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<"models" | "inventory">
          label="Models or inventory"
          value={section}
          onChange={setSection}
          tabs={[
            { id: "models", label: "Public models", count: data.data.models.length },
            { id: "inventory", label: "Review inventory", count: data.data.inventory.length },
          ]}
        />
        <Button size="sm" variant="secondary-light" icon={<Scale aria-hidden className="size-4" />} onClick={() => setReview(true)}>
          Review routing
        </Button>
      </div>

      {section === "models" ? (
        <>
          <div role="group" aria-label="Model type" className="flex gap-2">
            {(["image", "edit", "video"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-semibold",
                  tool === t ? "border-brand-blue bg-brand-blue text-white" : "border-rule-strong bg-sheet text-ink-dark hover:bg-paper",
                )}
              >
                {t === "image" ? "Image" : t === "edit" ? "Image edit" : "Video"}
              </button>
            ))}
          </div>
          <Panel bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Model</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Serves now (default settings)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Example cost</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">vs KIE</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Offers</th>
                    <th scope="col" className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {models.map((m) => {
                    const c = m.route.chosen;
                    const saving = c && m.route.kieBaselineUsd !== null && c.effectiveUsd !== null ? m.route.kieBaselineUsd - c.effectiveUsd : null;
                    return (
                      <tr key={m.id}>
                        <th scope="row" className="px-4 py-3 align-top font-medium">
                          <span className="text-ink-dark">{m.name}</span>
                          <span className="mt-0.5 block text-xs font-normal text-muted-dark">
                            {m.publicVisible ? (m.state === "enabled" ? "Public" : m.state) : "Hidden from customers"}
                          </span>
                        </th>
                        <td className="px-3 py-3 align-top">
                          {m.route.status === "ok" && c ? (
                            <>
                              <span className="font-semibold">{c.providerLabel}</span>
                              {c.legacy ? <span className="ml-1 text-xs text-muted-dark">(original route)</span> : null}
                              <span className="mt-0.5 block text-xs text-muted-dark">{settingsText(m.example.options)}</span>
                            </>
                          ) : (
                            <Badge surface="light" tone={m.route.status === "blocked" ? "attention" : "error"}>
                              {m.route.status === "blocked" ? "Temporarily unavailable" : "No eligible supplier"}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right align-top tabular">{c ? usd(c.effectiveUsd) : "—"}</td>
                        <td className="px-3 py-3 text-right align-top tabular">
                          {saving === null ? <span className="text-xs text-muted-dark">Not comparable</span> : saving > 0 ? `−${usd(saving)}` : saving === 0 ? "Same" : `+${usd(-saving)}`}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <ul className="space-y-1">
                            {m.offers.map((o) => (
                              <li key={o.id} className="flex flex-wrap items-center gap-1.5">
                                <button type="button" onClick={() => setOffer(o)} className="font-semibold text-info-text underline-offset-2 hover:underline">
                                  {o.providerName}
                                </button>
                                <StatusBadge status={o.status} />
                                <DecisionBadge decision={o.decision} />
                                {o.routingEnabled ? (
                                  <Badge surface="light" tone="success" icon="none">
                                    Routing on
                                  </Badge>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-3 py-3 text-right align-top">
                          <Button size="sm" variant="secondary-light" onClick={() => setCompareId(m.id)}>
                            Compare
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="text-xs text-muted-dark">
            Costs are whole-request supplier costs in USD at each account&apos;s funding terms. &quot;vs KIE&quot; is shown only when the original KIE route has a documented price for the same settings.
          </p>
        </>
      ) : (
        <Inventory items={data.data.inventory} onOpen={setOffer} />
      )}

      {model ? <CompareDrawer m={model} onClose={() => setCompareId(null)} onOffer={setOffer} /> : null}
      {offer ? (
        <OfferDrawer
          offerId={offer.id}
          model={data.data.models.find((m) => m.id === offer.modelId) ?? null}
          canManage={canManage}
          canTest={canTest}
          units={units}
          onClose={() => setOffer(null)}
          onChanged={data.reload}
        />
      ) : null}
      {review ? <ReviewDialog canManage={canManage} onClose={() => setReview(false)} onApplied={data.reload} /> : null}
    </div>
  );
}

/** Exact-settings comparison: every offer's whole-request cost, or why it is excluded, with its evidence. */
function CompareDrawer({ m, onClose, onOffer }: { m: RoutingModel; onClose: () => void; onOffer: (o: Offer) => void }) {
  const [opts, setOpts] = useState<Record<string, string | number>>(m.example.options);
  const [mode, setMode] = useState<string | null>(m.example.mode);
  const [counts, setCounts] = useState<Record<string, number>>(m.example.quantities.counts);
  const [secs, setSecs] = useState<Record<string, number>>(m.example.quantities.seconds);
  const [r, setR] = useState<RoutePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const modeDef = m.spec.modes?.find((x) => x.id === mode) ?? null;
  const slots = useMemo(() => {
    const list = modeDef ? modeDef.uses : [];
    return [...list, ...(m.spec.references && (m.spec.references.max ?? 0) > 0 ? ["_references"] : [])];
  }, [modeDef, m.spec.references]);

  const compare = async () => {
    setBusy(true);
    setErr(null);
    try {
      const counted = Object.fromEntries(slots.map((s) => [s, Math.max(0, Math.floor(counts[s] ?? 0))]).filter(([, n]) => (n as number) > 0));
      const seconds = Object.fromEntries(Object.entries(secs).filter(([s]) => (counted[s] ?? 0) > 0));
      setR(await api<RoutePreview>("/api/admin/providers/preview", { body: { modelId: m.id, options: opts, mode, quantities: { counts: counted, seconds } } }));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open surface="light" size="xl" onClose={onClose} title={`Compare suppliers · ${m.name}`} description="Choose exact settings; every offer is priced for the whole request, or shows why it cannot take it.">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(m.spec.options ?? {}).map(([k, o]) => (
            <Field key={k} label={o.label ?? k.replace(/_/g, " ")}>
              <select
                value={String(opts[k] ?? o.default ?? "")}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = (o.values ?? []).find((x) => String(x) === raw) ?? raw;
                  setOpts({ ...opts, [k]: v });
                  // A length derived from an input follows it in the quantities too.
                  const from = m.spec.derived?.[k]?.from;
                  if (from) setSecs({ ...secs, [from]: Number(v) });
                }}
                className={inputCls}
              >
                {(o.values ?? []).map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {o.labels?.[String(v)] ?? String(v)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {m.spec.modes?.length ? (
            <Field label="Input mode">
              <select value={mode ?? ""} onChange={(e) => setMode(e.target.value || null)} className={inputCls}>
                {m.spec.modes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {slots.map((s) => {
            const def = s === "_references" ? { kind: "image", label: "Reference images", max: m.spec.references?.max } : m.spec.inputs?.[s];
            if (!def || def.kind === "job") return null;
            return (
              <div key={s} className="grid grid-cols-2 gap-2">
                <Field label={`${def.label} (files)`}>
                  <input inputMode="numeric" value={String(counts[s] ?? 0)} onChange={(e) => setCounts({ ...counts, [s]: Number(e.target.value.replace(/\D/g, "")) || 0 })} className={inputCls} />
                </Field>
                {def.kind === "video" || def.kind === "audio" ? (
                  <Field label="Seconds in total">
                    <input inputMode="decimal" value={String(secs[s] ?? "")} onChange={(e) => setSecs({ ...secs, [s]: Number(e.target.value) || 0 })} className={inputCls} />
                  </Field>
                ) : null}
              </div>
            );
          })}
        </div>
        <Button busy={busy} onClick={() => void compare()}>
          Compare for these settings
        </Button>
        {err ? <Notice tone="error">{err}</Notice> : null}
        {r ? (
          <div className="space-y-3">
            <Notice tone={r.status === "ok" ? "success" : r.status === "blocked" ? "attention" : "error"}>
              {r.explanation}
              {r.status === "ok" ? (
                <span className="mt-1 block">
                  {r.savingVsKieUsd !== null
                    ? r.savingVsKieUsd > 0
                      ? `Saves ${usd(r.savingVsKieUsd)} per job against the verified KIE price for the same settings.`
                      : r.savingVsKieUsd === 0
                        ? "Same cost as the KIE route."
                        : `Costs ${usd(-r.savingVsKieUsd)} more than KIE (KIE is not eligible for routing here).`
                    : "Saving vs KIE: not comparable / unavailable for these settings."}
                </span>
              ) : null}
            </Notice>
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Supplier</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Whole-request cost (funded)</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Price evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {r.candidates.map((c) => (
                    <tr key={c.offerId} className={cn(r.chosen?.offerId === c.offerId && "bg-success-tint/50")}>
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          className="font-semibold text-info-text hover:underline"
                          onClick={() => {
                            const o = m.offers.find((x) => x.id === c.offerId);
                            if (o) onOffer(o);
                          }}
                        >
                          {c.providerLabel}
                        </button>
                        {c.legacy ? <span className="ml-1 text-xs text-muted-dark">original route</span> : null}
                        {r.chosen?.offerId === c.offerId ? (
                          <span className="ml-2">
                            <Badge surface="light" tone="success">
                              Chosen
                            </Badge>
                          </span>
                        ) : null}
                        <span className="block text-xs text-muted-dark">{c.upstreamModelId ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <CandidateCost c={c} />
                        {!c.excluded && (c.feeBps || c.bonusBps) ? (
                          <span className="block text-[11px] text-muted-dark">
                            Funding: {c.feeBps ? `+${Number(c.feeBps) / 100} % fee` : ""}
                            {c.bonusBps ? ` ÷ (1 + ${Number(c.bonusBps) / 100} % bonus)` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-dark">
                        {c.price ? (
                          <>
                            {c.price.kind === "supplier_cost" ? "KIE cost" : "Price"} v{c.price.version} · {c.price.confidence} · checked {day(c.price.checkedAt)}
                            {c.price.sourceUrl ? (
                              <a href={c.price.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-info-text underline">
                                source <ExternalLink aria-hidden className="size-3" />
                              </a>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-dark">
              Settings: {settingsText(r.options)}
              {r.mode ? ` · mode ${r.mode}` : ""} · decided {when(r.decidedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Routing review: proposed decisions from every reviewed configuration, with a preview before anything changes. */
function ReviewDialog({ canManage, onClose, onApplied }: { canManage: boolean; onClose: () => void; onApplied: () => void }) {
  const data = useApi<RoutingReview>("/api/admin/providers/review");
  const [activate, setActivate] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [filter, setFilter] = useState<"changes" | "mapped" | "all">("changes");
  const rows = (data.data?.proposals ?? []).filter((p) =>
    filter === "all" ? true : filter === "mapped" ? p.mapped : p.proposedDecision !== p.currentDecision || p.canActivate,
  );
  const apply = async () => {
    if (!data.data) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ changed: number; switchedOff: number; switchedOn: number }>("/api/admin/providers/review/apply", {
        body: { revision: data.data.revision, activate: [...activate] },
      });
      setMsg({ tone: "success", text: `Applied: ${r.changed} decision(s) changed, ${r.switchedOn} offer(s) switched on, ${r.switchedOff} switched off. Jobs already sent are not affected.` });
      onApplied();
      data.reload();
      setActivate(new Set());
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      surface="light"
      size="xl"
      onClose={onClose}
      title="Review routing"
      description="Each offer is compared over every reviewed configuration of its model. Offers that never win are switched off for normal routing (their history stays); a provider stays active while it wins at least one configuration."
      footer={
        canManage ? (
          <>
            <Button variant="secondary-light" onClick={onClose}>
              Close
            </Button>
            <Button busy={busy} disabled={!data.data} icon={<ShieldCheck aria-hidden className="size-4" />} onClick={() => void apply()}>
              Apply {activate.size ? `and switch on ${activate.size}` : "decisions"}
            </Button>
          </>
        ) : undefined
      }
    >
      {!data.data ? (
        data.error ? (
          <Notice tone="error">{data.error.message}</Notice>
        ) : (
          <div role="status" aria-busy="true" aria-label="Computing" className="h-40 animate-pulse-soft rounded-xl bg-paper" />
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {data.data.providers.map((p) => (
              <span key={p.provider} className="rounded-full border border-rule px-3 py-1 text-xs">
                <span className="font-semibold">{p.name}</span> · {p.winningOffers} winning · {p.activeAfterApply ? "active after apply" : "no active route"}
              </span>
            ))}
          </div>
          <div role="group" aria-label="Show" className="flex gap-2 text-sm">
            {(["changes", "mapped", "all"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1", filter === f ? "border-brand-blue bg-info-tint font-semibold" : "border-rule")}>
                {f === "changes" ? "Changes" : f === "mapped" ? "Public models" : "Everything"}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <Empty>No changes: every decision is current.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-paper text-xs text-muted-dark">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">Offer</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Now → proposed</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Why</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Switch on</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((p: ReviewProposal) => (
                    <tr key={p.offerId}>
                      <td className="px-3 py-2 align-top">
                        <span className="font-semibold">{p.providerName}</span> · {p.productLabel}
                        <span className="block text-xs text-muted-dark">{p.modelId ?? "no Genlixs model"}</span>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <DecisionBadge decision={p.currentDecision} /> → <DecisionBadge decision={p.proposedDecision} />
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-dark">{p.reason}</td>
                      <td className="px-3 py-2 align-top">
                        {p.canActivate && canManage ? (
                          <Switch
                            checked={activate.has(p.offerId)}
                            label={`Switch on ${p.providerName} for ${p.productLabel}`}
                            onChange={(v) => {
                              const next = new Set(activate);
                              if (v) next.add(p.offerId);
                              else next.delete(p.offerId);
                              setActivate(next);
                            }}
                          />
                        ) : (
                          <span className="text-xs text-muted-dark">{p.routingEnabled ? "On" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        </div>
      )}
    </Dialog>
  );
}

/** Review inventory: every discovered product that no public model uses yet, with its decision, blocker and source. */
function Inventory({ items, onOpen }: { items: Offer[]; onOpen: (o: Offer) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, Offer[]>();
    for (const o of items) {
      if (q && !`${o.productLabel} ${o.providerName} ${o.productKey}`.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(o.productKey, [...(m.get(o.productKey) ?? []), o]);
    }
    return [...m.entries()];
  }, [items, q]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-dark">
        Discovery is not activation: these products are compared only with the same product at other providers. A decision of &quot;{DECISION_INFO.eligible.label}&quot; means the lowest known quote, not that it can be routed — it still needs a Genlixs model and an integration.
      </p>
      <Field label="Search" className="max-w-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="Product or provider" />
      </Field>
      <Panel bodyClass="p-0">
        {groups.length === 0 ? (
          <div className="p-5">
            <Empty>Nothing matches.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-rule">
            {groups.map(([key, offers]) => (
              <li key={key} className="px-4 py-3">
                <p className="font-semibold text-ink-dark">{offers[0].productLabel}</p>
                <ul className="mt-1 space-y-1">
                  {offers.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <button type="button" className="font-semibold text-info-text hover:underline" onClick={() => onOpen(o)}>
                        {o.providerName}
                      </button>
                      <DecisionBadge decision={o.decision} />
                      <span className="text-xs text-muted-dark">{o.price ? priceSummary(o) : "no price"}</span>
                      <span className="w-full text-xs text-muted-dark sm:w-auto">{o.decisionReason ?? o.blocker}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function priceSummary(o: Pick<Offer, "price">) {
  const p = o.price;
  if (!p) return "No price";
  const rates = Object.entries(p.schedule.rates).slice(0, 4);
  const per = p.schedule.basis === "output" ? "per output" : p.schedule.basis === "request" ? "per request" : p.schedule.basis === "io_second" ? "per input + output second" : "per second";
  return `${rates.map(([k, v]) => `${k || "any"}: ${native(Number(v), p.unit)}`).join(", ")}${Object.keys(p.schedule.rates).length > 4 ? ", …" : ""} ${per} · ${p.confidence}${UNIT_LABEL[p.unit] ? "" : ""}`;
}
