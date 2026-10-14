"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { money } from "@/lib/live/types";
import { cn } from "@/lib/format";
import { Field, fmtUsd4, inputCls, Money, Notice } from "./shared";
import type { CatalogData, ProductRow, RevenueBasis } from "./types";

type Edit = { name: string; price: string; credits: string };
type Impact = {
  before: RevenueBasis;
  after: RevenueBasis;
  models: { modelId: string; name: string; priceState: string; lossBefore: number; lossAfter: number; directLossAfter: number; worstAfter: number | null }[];
};

/**
 * Credit packages: price and credits per package with the resulting revenue per credit. Package prices are not
 * derived from any model's KIE cost; instead a change is checked against the same credit economics (lowest
 * revenue per credit, 50 % partner scenario) before the owner decides what to publish. Paid orders keep their
 * own snapshot of price and credits.
 */
export function PackagesTab({ data, reload }: { data: CatalogData; reload: () => void }) {
  const groups = useMemo(() => {
    const byKey = new Map<string, ProductRow[]>();
    for (const p of data.products) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
    return [...byKey.entries()].map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { key, published: sorted.find((v) => v.state === "published") ?? null, draft: sorted.find((v) => v.state === "draft") ?? null, latest: sorted[0] };
    });
  }, [data.products]);
  const [edits, setEdits] = useState<Record<string, Edit>>(() =>
    Object.fromEntries(groups.map((g) => [g.key, { name: g.latest.name, price: (Number(g.latest.amountMinor) / 100).toFixed(2), credits: g.latest.credits }])),
  );
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const parsed = (k: string) => {
    const e = edits[k];
    const minor = Math.round(Number(e?.price) * 100);
    const credits = Number(e?.credits);
    return Number.isFinite(minor) && minor > 0 && Number.isInteger(credits) && credits > 0 ? { minor, credits } : null;
  };
  const changed = groups.filter((g) => {
    const p = parsed(g.key);
    return p && (p.minor !== Number(g.latest.amountMinor) || p.credits !== Number(g.latest.credits) || edits[g.key].name.trim() !== g.latest.name);
  });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const previewImpact = () =>
    run("impact", async () => {
      const changes = Object.fromEntries(
        groups
          .map((g) => [g.key, parsed(g.key)] as const)
          .filter(([, p]) => p)
          .map(([k, p]) => [k, { amountMinor: p!.minor, credits: p!.credits }]),
      );
      setImpact(await api<Impact>("/api/admin/catalog/packages/impact", { body: { changes } }));
    });
  const saveDraft = (g: (typeof groups)[number]) =>
    run(`save-${g.key}`, async () => {
      const p = parsed(g.key);
      if (!p) throw new Error("invalid");
      await api("/api/admin/catalog/products", {
        body: {
          productKey: g.key,
          kind: g.latest.kind,
          name: edits[g.key].name.trim(),
          currency: g.latest.currency,
          amountMinor: p.minor,
          credits: p.credits,
          interval: g.latest.interval ?? undefined,
          creditExpiryDays: g.latest.creditExpiryDays ?? undefined,
          gatewayMapping: g.latest.gatewayMapping,
          description: g.latest.description ?? undefined,
        },
      });
      setMsg({ tone: "success", text: `${edits[g.key].name}: saved as a new draft version.` });
      reload();
    });
  const publish = (id: string, name: string) =>
    run(`pub-${id}`, async () => {
      await api(`/api/admin/catalog/products/${id}/publish`, { body: {} });
      setMsg({ tone: "success", text: `${name} published. New checkouts use it; paid orders keep the price and credits they were bought with.` });
      reload();
    });

  return (
    <div className="space-y-5">
      <Notice>
        Bulk markup applies to generation prices only. A package has no single KIE cost, so its price is never multiplied by a model cost; check here how a
        change moves the credit value (revenue per usable credit) that all generation prices are based on.
      </Notice>
      <Panel title="Credit packages" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Packages with price, credits and revenue per credit</caption>
            <thead className="bg-paper text-xs text-muted-dark">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Package</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Published</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Price (USD, before tax)</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Credits granted</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Revenue / credit</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {groups.map((g) => {
                const p = parsed(g.key);
                const e = edits[g.key];
                return (
                  <tr key={g.key} className="align-top">
                    <th scope="row" className="px-4 py-3 font-semibold text-ink-dark">
                      {g.key}
                      <span className="block text-xs font-normal text-muted-dark">{g.latest.kind === "subscription" ? `Subscription (${g.latest.interval})` : "Credit pack"}</span>
                    </th>
                    <td className="px-3 py-3">
                      {g.published ? (
                        <span>
                          {money(g.published.amountMinor, g.published.currency)} · {g.published.credits} cr
                          <span className="block text-xs text-muted-dark">v{g.published.version}</span>
                        </span>
                      ) : (
                        <Badge surface="light" tone="neutral">
                          Not published
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <input aria-label={`${g.key} name`} value={e.name} maxLength={60} disabled={!data.access.canPrice} onChange={(ev) => setEdits({ ...edits, [g.key]: { ...e, name: ev.target.value } })} className={cn(inputCls, "w-36")} />
                    </td>
                    <td className="px-3 py-3">
                      <input aria-label={`${g.key} price in USD`} inputMode="decimal" value={e.price} disabled={!data.access.canPrice || g.latest.currency !== "USD"} onChange={(ev) => setEdits({ ...edits, [g.key]: { ...e, price: ev.target.value } })} className={cn(inputCls, "w-28 text-right tabular")} />
                    </td>
                    <td className="px-3 py-3">
                      <input aria-label={`${g.key} credits`} inputMode="numeric" value={e.credits} disabled={!data.access.canPrice} onChange={(ev) => setEdits({ ...edits, [g.key]: { ...e, credits: ev.target.value.replace(/[^0-9]/g, "") } })} className={cn(inputCls, "w-28 text-right tabular")} />
                    </td>
                    <td className="px-3 py-3 text-right tabular">{p ? fmtUsd4(p.minor / 100 / p.credits) : "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {data.access.canPrice ? (
                          <Button size="sm" variant="secondary-light" disabled={!changed.includes(g) || !p} busy={busy === `save-${g.key}`} onClick={() => void saveDraft(g)}>
                            Save draft
                          </Button>
                        ) : null}
                        {data.access.canPublish && g.draft ? (
                          <Button size="sm" busy={busy === `pub-${g.draft.id}`} onClick={() => void publish(g.draft!.id, g.draft!.name)}>
                            Publish v{g.draft.version} ({money(g.draft.amountMinor, g.draft.currency)} · {g.draft.credits} cr)
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
          <Button variant="secondary-light" busy={busy === "impact"} onClick={() => void previewImpact()}>
            Preview impact of these values
          </Button>
          <span className="text-xs text-muted-dark">{changed.length ? `${changed.length} package(s) changed, not saved.` : "No unsaved changes."}</span>
        </div>
      </Panel>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {impact ? <ImpactView impact={impact} /> : null}
      {data.access.canPrice && data.economics ? <AssumptionsForm a={data.economics.assumptions} reload={reload} /> : null}
    </div>
  );
}

function ImpactView({ impact }: { impact: Impact }) {
  const b = impact.before.minRevenuePerCredit;
  const a = impact.after.minRevenuePerCredit;
  const worse = impact.models.filter((m) => m.lossAfter > m.lossBefore);
  return (
    <Panel title="Impact on generation prices">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold text-muted-dark">Credit value now</dt>
          <dd className="mt-0.5 tabular">
            {fmtUsd4(b)} ({impact.before.conservative?.name ?? "—"})
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted-dark">With these values</dt>
          <dd className="mt-0.5 tabular">
            {fmtUsd4(a)} ({impact.after.conservative?.name ?? "—"}){" "}
            {a !== null && b !== null && a < b ? <span className="font-semibold text-orange-text">lower: every credit earns less</span> : null}
          </dd>
        </div>
      </dl>
      {impact.models.length === 0 ? (
        <p className="mt-3 text-sm text-muted-dark">No model has a price yet, so no generation price is affected.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {impact.models.map((m) => (
            <li key={m.modelId} className={cn(m.lossAfter > m.lossBefore && "font-semibold text-error-text")}>
              {m.name} ({m.priceState} price): {m.lossAfter} configuration(s) below cost in the 50 % partner scenario{m.lossAfter !== m.lossBefore ? ` (was ${m.lossBefore})` : ""}
              {m.directLossAfter ? `, ${m.directLossAfter} below cost even without a partner` : ""}. Worst case <Money value={m.worstAfter} />
            </li>
          ))}
        </ul>
      )}
      {worse.length ? (
        <div className="mt-3">
          <Notice tone="attention">Publishing these package values would make {worse.length} model price(s) lose more often. Re-run bulk pricing after publishing, or keep the package values.</Notice>
        </div>
      ) : null}
    </Panel>
  );
}

function AssumptionsForm({ a, reload }: { a: NonNullable<CatalogData["economics"]>["assumptions"]; reload: () => void }) {
  const [fee, setFee] = useState(a.paymentFeeBps === null ? "" : String(a.paymentFeeBps / 100));
  const [fixed, setFixed] = useState(a.paymentFixedFeeUsd === null ? "" : String(a.paymentFixedFeeUsd));
  const [op, setOp] = useState(a.operatingCostUsdPerJob === null ? "" : String(a.operatingCostUsdPerJob));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Panel title="Cost assumptions for contribution estimates">
      <p className="text-sm text-muted-dark">Leave a field empty when it is not known yet; estimates then say “before” that cost instead of treating it as zero.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Payment fee (% of package price)">
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Fixed fee per payment (USD)">
          <input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Operating cost per generation (USD)" hint="Storage, bandwidth, compute.">
          <input inputMode="decimal" value={op} onChange={(e) => setOp(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Button
        className="mt-3"
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const f = num(fee);
            await api("/api/admin/catalog/assumptions", {
              body: { paymentFeeBps: f === null ? null : Math.round(f * 100), paymentFixedFeeUsd: num(fixed), operatingCostUsdPerJob: num(op) },
            });
            setMsg({ tone: "success", text: "Saved. Previews now use these assumptions." });
            reload();
          } catch (e) {
            setMsg({ tone: "error", text: errorMessage(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save assumptions
      </Button>
      {msg ? <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
    </Panel>
  );
}
