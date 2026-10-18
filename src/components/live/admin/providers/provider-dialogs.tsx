"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/live/api";
import { cn } from "@/lib/format";
import { KieActivity, type useKieSummary } from "../catalog/provider";
import { Field, inputCls, Notice, Tabs, when } from "../catalog/shared";
import { BalanceCell, KV, money, UNIT_LABEL } from "./parts";
import type { ProviderAccount, ProvidersOverview } from "./types";
import { UsageTab } from "./usage-tab";

export const BILLING: Record<string, string> = {
  kie: "https://kie.ai/billing",
  duomi: "https://duomiapi.com",
  poyo: "https://poyo.ai/dashboard",
  nezhagate: "https://nezhagate.com",
  cuddler: "https://platform.cuddler.ai",
  apimart: "https://apimart.ai",
};

type Msg = { tone: "error" | "success" | "attention"; text: string } | null;

/**
 * Key entry. The value is sent once over HTTPS to the server, which stores it in Supabase Vault; the field is cleared
 * whatever the outcome and the reply contains only a masked hint. Saving needs a recent sign-in.
 */
export function KeyDialog({ a, onClose, onSaved }: { a: ProviderAccount; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const save = async () => {
    const value = key;
    setKey("");
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ keyHint: string; keyVersion: number }>(`/api/admin/providers/${a.id}/key`, { body: { key: value } });
      setMsg({ tone: "success", text: `Saved as version ${r.keyVersion} (${r.keyHint}). Use "Test connection" in Details to check it with a read-only call.` });
      onSaved();
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
      size="md"
      onClose={onClose}
      title={`${a.credential.source === "vault" ? "Replace" : "Add"} the ${a.name} API key`}
      description="Stored encrypted in Supabase Vault on the server. It is never shown again; only the last four characters are kept as a hint. Jobs already sent keep the key they were sent with."
      footer={
        <>
          <Button variant="secondary-light" onClick={onClose}>
            Close
          </Button>
          <Button busy={busy} disabled={key.trim().length < 8} onClick={() => void save()}>
            Save key
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim().length >= 8) void save();
        }}
      >
        <Field label="API key" hint="Paste it exactly as the provider shows it.">
          <input
            type="password"
            name={`provider-key-${a.provider}`}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn(inputCls, "font-mono")}
          />
        </Field>
      </form>
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
    </Dialog>
  );
}

type Section = "overview" | "funding" | "usage" | "activity";

/**
 * Everything advanced about one provider, out of the everyday list: diagnostics, funding terms and limits, a manual
 * balance, key removal, where the money went, and (KIE) per-model spend, reliability and balance readings.
 */
export function ProviderDrawer({
  a,
  o,
  canManage,
  canOperate,
  kie,
  onClose,
  onSaved,
}: {
  a: ProviderAccount;
  o: ProvidersOverview;
  canManage: boolean;
  canOperate: boolean;
  kie: ReturnType<typeof useKieSummary> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const caps = o.runtime.providers[a.provider];
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const call = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setMsg(null);
    try {
      setMsg({ tone: "success", text: await fn() });
      onSaved();
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
      title={`${a.name} details`}
      description="Diagnostics, funding terms, limits and spending. Every change is audited; keys are never shown."
      footer={
        <a href={BILLING[a.provider]} target="_blank" rel="noopener noreferrer" className="mr-auto inline-flex items-center gap-1 text-sm font-semibold text-info-text underline">
          {a.name} account <ExternalLink aria-hidden className="size-3.5" />
        </a>
      }
    >
      <div className="space-y-5">
        <Tabs<Section>
          label="Provider details"
          value={section}
          onChange={setSection}
          tabs={[
            { id: "overview", label: "Status" },
            { id: "funding", label: "Funding & limits" },
            { id: "usage", label: "Spending" },
            ...(kie ? [{ id: "activity" as const, label: "KIE activity" }] : []),
          ]}
        />
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

        {section === "overview" ? (
          <div className="space-y-5">
            <BalanceCell a={a} large />
            <dl>
              <KV k="Key">
                {a.credential.source === "vault"
                  ? `${a.credential.hint ?? "Saved"} · version ${a.credential.version}${a.credential.setAt ? ` · ${when(a.credential.setAt)}` : ""}`
                  : a.credential.source === "environment"
                    ? `Server setting (${a.credential.environmentName ?? "environment"})`
                    : "None"}
              </KV>
              <KV k="Connection">
                {a.connection.state === "ok" ? "Connected" : a.connection.state === "untested" ? "Not tested" : a.connection.state}
                {a.connection.checkedAt ? ` · ${when(a.connection.checkedAt)}` : ""}
                {a.connection.message && a.connection.state !== "ok" ? <span className="block text-xs text-error-text">{a.connection.message}</span> : null}
              </KV>
              <KV k="Circuit breaker">{a.circuit.blockedUntil ? `Refusing until ${when(a.circuit.blockedUntil)} (${a.circuit.code})` : "Clear"}</KV>
              <KV k="Failures (24 h)">{a.failures24h ? `${a.failures24h} refused or unknown submission(s)` : "None"}</KV>
              <KV k="Offers">
                {a.offers.routing} serving · {a.offers.eligible} verified · {a.offers.mapped} for Genlixs models · {a.offers.total} in total
              </KV>
              <KV k="In flight">{a.spend.pendingJobs ? `${a.spend.pendingJobs} job(s) · ${money(a.spend.pendingUsd)}` : "None"}</KV>
              <KV k="Native unit">{UNIT_LABEL[a.nativeUnit] ?? a.nativeUnit}</KV>
              <KV k="Balance check">{caps?.balance === "api" ? "Read-only API call" : "Not available (enter a manual balance)"}</KV>
              <KV k="Integrations in this release">{caps?.adapters.length ? caps.adapters.join(", ") : "None"}</KV>
              <KV k="Result hosts">
                {caps?.resultHosts.length ? caps.resultHosts.join(", ") : "Not documented — add the confirmed host to MEDIA_FETCH_ALLOWED_HOSTS after the first test"}
              </KV>
              <KV k="Usage endpoint">{caps?.usage ? "Yes (account level, may include other apps)" : "No"}</KV>
            </dl>
            {canManage && a.credential.source !== "none" ? (
              <Button
                size="sm"
                variant="secondary-light"
                busy={busy === "test"}
                onClick={() =>
                  void call("test", async () => {
                    const r = await api<{ result: { ok: boolean; state: string; error: string | null } }>(`/api/admin/providers/${a.id}/test`, { body: {} });
                    if (r.result.ok) return "Connected: the balance was read with the saved key (no generation was created).";
                    if (r.result.state === "unsupported") return "This provider has no documented read-only check; the key cannot be tested without a paid job.";
                    throw new Error(r.result.state === "unauthorized" ? `The provider refused the key (${r.result.error}).` : `The check failed (${r.result.error}).`);
                  })
                }
              >
                Test connection
              </Button>
            ) : null}
          </div>
        ) : null}

        {section === "funding" ? (
          <FundingForm a={a} canManage={canManage} units={o.units.map((u) => u.unit)} busy={busy} call={call} />
        ) : null}

        {section === "usage" ? <UsageTab accounts={o.accounts} provider={a.provider} /> : null}

        {section === "activity" && kie ? (
          kie.s ? (
            <KieActivity s={kie.s} canOperate={canOperate} onSaved={() => void kie.refresh("auto")} />
          ) : (
            <Notice tone={kie.error ? "error" : "info"}>{kie.error ?? "Loading KIE activity…"}</Notice>
          )
        ) : null}
      </div>
    </Dialog>
  );
}

function FundingForm({
  a,
  canManage,
  units,
  busy,
  call,
}: {
  a: ProviderAccount;
  canManage: boolean;
  units: string[];
  busy: string | null;
  call: (what: string, fn: () => Promise<string>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    lowBalanceThreshold: a.lowBalanceThreshold === null ? "" : String(a.lowBalanceThreshold),
    dailySpendCapUsd: a.dailySpendCapUsd === null ? "" : String(a.dailySpendCapUsd),
    fundingFeeBps: String(a.funding.feeBps),
    fundingBonusBps: String(a.funding.bonusBps),
    fundingNote: a.funding.note ?? "",
    walletGroup: a.walletGroup ?? "",
  });
  const [manual, setManual] = useState({ total: "", unit: a.balance.unit || a.nativeUnit, observedAt: new Date().toISOString().slice(0, 16), note: "" });
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

  return (
    <div className="space-y-6">
      <fieldset disabled={!canManage} className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink-dark">Limits and funding</legend>
        <Field label={`Warn below (${UNIT_LABEL[a.balance.unit] ?? a.balance.unit})`} hint="Empty = no warning.">
          <input inputMode="decimal" value={form.lowBalanceThreshold} onChange={(e) => setForm({ ...form, lowBalanceThreshold: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Daily spending cap (USD)" hint="Jobs that would pass it wait. Empty = no cap.">
          <input inputMode="decimal" value={form.dailySpendCapUsd} onChange={(e) => setForm({ ...form, dailySpendCapUsd: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Funding fee (basis points)" hint="Card or top-up fee actually paid: 5.5 % = 550. Added once to every cost.">
          <input inputMode="numeric" value={form.fundingFeeBps} onChange={(e) => setForm({ ...form, fundingFeeBps: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Credit bonus (basis points)" hint="Bonus credits received: 10 % = 1000 (cost ÷ 1.10).">
          <input inputMode="numeric" value={form.fundingBonusBps} onChange={(e) => setForm({ ...form, fundingBonusBps: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Shared wallet group" hint="Same text on two accounts = one wallet, counted once.">
          <input value={form.walletGroup} onChange={(e) => setForm({ ...form, walletGroup: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Funding note">
          <input value={form.fundingNote} onChange={(e) => setForm({ ...form, fundingNote: e.target.value })} className={inputCls} />
        </Field>
        {canManage ? (
          <div className="sm:col-span-2">
            <Button
              size="sm"
              busy={busy === "save"}
              onClick={() =>
                void call("save", async () => {
                  await api(`/api/admin/providers/${a.id}/settings`, {
                    body: {
                      patch: {
                        lowBalanceThreshold: orNull(form.lowBalanceThreshold),
                        dailySpendCapUsd: orNull(form.dailySpendCapUsd),
                        fundingFeeBps: form.fundingFeeBps.trim() || "0",
                        fundingBonusBps: form.fundingBonusBps.trim() || "0",
                        fundingNote: form.fundingNote,
                        walletGroup: orNull(form.walletGroup),
                      },
                    },
                  });
                  return "Saved. New routes use these terms; jobs already sent keep theirs. Customer prices do not change.";
                })
              }
            >
              Save
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-dark sm:col-span-2">Only the owner can change limits and funding terms.</p>
        )}
      </fieldset>

      {canManage ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-ink-dark">Manual balance</legend>
          <p className="text-xs text-muted-dark sm:col-span-2">
            For a provider without a balance endpoint, or to note what its dashboard shows. It is labelled as manual and dated; it never replaces a newer
            API reading.
          </p>
          <Field label="Balance">
            <input inputMode="decimal" value={manual.total} onChange={(e) => setManual({ ...manual, total: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Unit">
            <select value={manual.unit} onChange={(e) => setManual({ ...manual, unit: e.target.value })} className={inputCls}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u] ?? u}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seen on">
            <input type="datetime-local" value={manual.observedAt} onChange={(e) => setManual({ ...manual, observedAt: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Where it comes from">
            <input value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} className={inputCls} placeholder="Provider dashboard" />
          </Field>
          <div className="sm:col-span-2">
            <Button
              size="sm"
              variant="secondary-light"
              busy={busy === "manual"}
              disabled={!manual.total.trim() || manual.note.trim().length < 3}
              onClick={() =>
                void call("manual", async () => {
                  await api(`/api/admin/providers/${a.id}/manual-balance`, {
                    body: { total: manual.total.trim(), unit: manual.unit, observedAt: new Date(manual.observedAt).toISOString(), note: manual.note.trim() },
                  });
                  return "Manual balance recorded.";
                })
              }
            >
              Record manual balance
            </Button>
          </div>
        </fieldset>
      ) : null}

      {canManage && a.credential.source === "vault" ? (
        <RemoveKey
          a={a}
          busy={busy === "remove"}
          onRemove={(reason) =>
            void call("remove", async () => {
              await api(`/api/admin/providers/${a.id}/key/remove`, { body: { reason } });
              return a.provider === "kie" ? "Key removed. KIE falls back to the server setting, if one exists." : "Key removed. New jobs no longer use this provider.";
            })
          }
        />
      ) : null}
    </div>
  );
}

function RemoveKey({ a, busy, onRemove }: { a: ProviderAccount; busy: boolean; onRemove: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <fieldset className="grid gap-2 rounded-xl border border-[#f6c4c4] p-4">
      <legend className="px-1 text-sm font-semibold text-error-text">Remove the saved key</legend>
      <p className="text-xs text-muted-dark">
        New jobs stop using {a.name}. Jobs already sent keep their key version until they finish; then it is deleted from Vault.
      </p>
      <Field label="Reason">
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
      </Field>
      <div>
        <Button size="sm" variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={() => onRemove(reason.trim())}>
          Remove key
        </Button>
      </div>
    </fieldset>
  );
}
