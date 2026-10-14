"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { creditsAtReference, packageRate, vsReferencePct } from "@/lib/pricing/credit-math";
import { toNumber, type Dec } from "@/lib/pricing/decimal";
import { cn } from "@/lib/format";
import { day, Field, fmtMarkup, fmtRate, inputCls, Notice, Switch } from "./shared";
import type { ProductRow } from "./types";

/** The version an editor starts from (what customers can buy, otherwise the latest) and the latest version id. */
export function packageGroups(products: ProductRow[]) {
  const byKey = new Map<string, ProductRow[]>();
  for (const p of products) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  return [...byKey.values()].map((versions) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const published = sorted.find((v) => v.state === "published") ?? null;
    return { key: sorted[0].key, current: published ?? sorted[0], latestId: sorted[0].id, offered: Boolean(published) };
  });
}

/**
 * Package editor: name, price, included and bonus credits, and whether customers can buy it. Each package is saved
 * on its own as a new version; orders and subscriptions keep the version they were bought with. Every package adds
 * credits to the same wallet, in the same unit.
 */
export function PackagesEditor({
  products,
  reference,
  canEdit,
  canPublish,
  promotions,
  onSaved,
}: {
  products: ProductRow[];
  reference: Dec | null;
  canEdit: boolean;
  canPublish: boolean;
  promotions: { signupUnits: unknown; promoDays: unknown };
  onSaved: () => void;
}) {
  const groups = packageGroups(products);
  const signup = Number(promotions.signupUnits ?? 0);
  return (
    <div className="space-y-3">
      {groups.length === 0 ? <p className="text-sm text-muted-dark">No packages exist yet.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map((g) => (
          <PackageCard key={g.key} group={g} reference={reference} canEdit={canEdit} canPublish={canPublish} onSaved={onSaved} />
        ))}
      </div>
      <p className="text-xs text-muted-dark">
        All packages add credits to the same balance, and a credit is spent the same way whichever package it came from. Promotional credits are separate
        and bring no revenue{signup > 0 ? `: new accounts receive ${signup} sign-up credits` : ""}.
      </p>
    </div>
  );
}

function PackageCard({
  group,
  reference,
  canEdit,
  canPublish,
  onSaved,
}: {
  group: ReturnType<typeof packageGroups>[number];
  reference: Dec | null;
  canEdit: boolean;
  canPublish: boolean;
  onSaved: () => void;
}) {
  const p = group.current;
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState((Number(p.amountMinor) / 100).toFixed(2));
  const [included, setIncluded] = useState(p.includedCredits ?? p.credits);
  const [bonus, setBonus] = useState(p.bonusCredits ?? "0");
  const [offered, setOffered] = useState(group.offered);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "attention"; text: string } | null>(null);

  const priceOk = /^\d{1,7}(\.\d{1,2})?$/.test(price.trim()) && Number(price) > 0;
  // At most two decimals, so rounding the cents is exact.
  const minor = priceOk ? Math.round(Number(price) * 100) : null;
  const includedOk = /^\d{1,8}$/.test(included) && Number(included) >= 1;
  const bonusOk = /^\d{0,8}$/.test(bonus);
  const valid = name.trim().length >= 2 && name.trim().length <= 60 && priceOk && includedOk && bonusOk && minor !== null;
  const rate = valid ? packageRate(minor!, included, bonus || 0) : null;
  const vs = rate ? vsReferencePct(rate.usdPerCredit, reference) : null;
  const changed =
    name.trim() !== p.name ||
    minor !== Number(p.amountMinor) ||
    Number(included) !== Number(p.includedCredits ?? p.credits) ||
    Number(bonus || 0) !== Number(p.bonusCredits ?? 0) ||
    offered !== group.offered;
  const mayEdit = canEdit && (canPublish || (!offered && !group.offered));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ unchanged: boolean }>(`/api/admin/packages/${p.key}`, {
        body: { name: name.trim(), amountMinor: minor, includedCredits: Number(included), bonusCredits: Number(bonus || 0), offered, expectedVersionId: group.latestId },
      });
      setMsg({
        tone: "success",
        text: r.unchanged ? "Nothing changed." : offered ? "Saved. New purchases use these terms; earlier orders keep theirs." : "Saved. Customers cannot buy this package.",
      });
      onSaved();
    } catch (e) {
      setMsg({ tone: e instanceof ApiClientError && e.code === "PACKAGE_CHANGED" ? "attention" : "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const fromReference = () => {
    if (minor === null) return;
    const n = creditsAtReference(minor, reference);
    if (n !== null && n >= 1) setIncluded(String(n));
  };

  const id = `pkg-${p.key}`;
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${id}-h`} className="text-base font-semibold text-ink-dark">
          {p.name}
        </h3>
        <Badge surface="light" tone={group.offered ? "success" : "neutral"} icon="none">
          {group.offered ? "Offered" : "Not offered"}
        </Badge>
      </div>
      <p className="text-xs text-muted-dark">
        {p.kind === "subscription" ? "Monthly plan (credits each paid month)" : "One-time credit pack"} · version {p.version}
        {group.offered && p.effectiveAt ? ` · since ${day(p.effectiveAt)}` : ""}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input value={name} maxLength={60} disabled={!mayEdit} onChange={(e) => setName(e.target.value)} className={cn(inputCls, "w-full min-w-0")} />
        </Field>
        <Field label={`Price (${p.currency})`}>
          <input inputMode="decimal" value={price} disabled={!mayEdit} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={!priceOk} className={cn(inputCls, "w-full min-w-0 tabular", !priceOk && "border-error-text")} />
        </Field>
        <Field label="Included credits">
          <input inputMode="numeric" value={included} disabled={!mayEdit} onChange={(e) => setIncluded(e.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!includedOk} className={cn(inputCls, "w-full min-w-0 tabular", !includedOk && "border-error-text")} />
        </Field>
        <Field label="Bonus credits">
          <input inputMode="numeric" value={bonus} disabled={!mayEdit} onChange={(e) => setBonus(e.target.value.replace(/[^0-9]/g, ""))} className={cn(inputCls, "w-full min-w-0 tabular")} />
        </Field>
        <div className="grid content-end gap-1 text-sm">
          <span className="font-semibold text-ink-dark">Offered to customers</span>
          <span className="flex h-10 items-center gap-2">
            <Switch checked={offered} onChange={setOffered} disabled={!canEdit || !canPublish} label={`${p.name}: offered to customers`} />
            <span className="text-muted-dark">{offered ? "Yes" : "No"}</span>
          </span>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-paper px-3 py-2.5 text-sm">
        <dt className="text-muted-dark">Usable credits</dt>
        <dd className="text-right font-semibold tabular text-ink-dark">{rate ? rate.usable.toLocaleString("en-US") : "—"}</dd>
        <dt className="text-muted-dark">Value per credit</dt>
        <dd className="text-right font-semibold tabular text-ink-dark">{rate ? fmtRate(toNumber(rate.usdPerCredit)) : "—"}</dd>
        <dt className="text-muted-dark">Against the credit value</dt>
        <dd className="text-right tabular text-ink-dark">
          {vs === null ? "—" : vs === 0 ? "Same" : `${fmtMarkup(vs)} ${vs > 0 ? "premium" : "discount"}`}
        </dd>
      </dl>
      {mayEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" busy={busy} disabled={!valid || !changed} onClick={() => void save()}>
            Save package
          </Button>
          {reference ? (
            <Button size="sm" variant="ghost-light" disabled={!priceOk} onClick={fromReference}>
              Credits from the credit value
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-dark">{canEdit ? "Only the owner can change packages that customers can buy." : "Your role can view packages only."}</p>
      )}
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
    </section>
  );
}
