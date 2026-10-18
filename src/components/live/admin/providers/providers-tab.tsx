"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, KeyRound, PlugZap, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/live/api";
import { cn } from "@/lib/format";
import { Field, inputCls, Notice, Switch, when } from "../catalog/shared";
import { BalanceCell, ConnectionBadge, KV, UNIT_LABEL, money } from "./parts";
import type { ProviderAccount, ProvidersOverview } from "./types";

const BILLING: Record<string, string> = {
  kie: "https://kie.ai/billing",
  duomi: "https://duomiapi.com",
  poyo: "https://poyo.ai/dashboard",
  nezhagate: "https://nezhagate.com",
  cuddler: "https://platform.cuddler.ai",
  apimart: "https://apimart.ai",
};

type Msg = { tone: "error" | "success" | "attention"; text: string } | null;

/** Providers: connection, masked key, balance, recent spending and winning offers; owner actions per account. */
export function ProvidersTab({ o, canManage, reload }: { o: ProvidersOverview; canManage: boolean; reload: () => void }) {
  const [keyFor, setKeyFor] = useState<ProviderAccount | null>(null);
  const [settingsFor, setSettingsFor] = useState<ProviderAccount | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, Msg>>({});

  const run = async (a: ProviderAccount, what: string, fn: () => Promise<string>) => {
    setBusy(`${a.id}:${what}`);
    setMsg((m) => ({ ...m, [a.id]: null }));
    try {
      const text = await fn();
      setMsg((m) => ({ ...m, [a.id]: { tone: "success", text } }));
      reload();
    } catch (e) {
      setMsg((m) => ({ ...m, [a.id]: { tone: "error", text: errorMessage(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {!canManage ? <Notice>Only the owner can add keys, switch providers on or off and change limits. You can see their state.</Notice> : null}
      <ul className="grid gap-4 xl:grid-cols-2">
        {o.accounts.map((a) => {
          const caps = o.runtime.providers[a.provider];
          return (
            <li key={a.id} className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-ink-dark">{a.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <ConnectionBadge a={a} />
                    {a.paused ? (
                      <Badge surface="light" tone="attention">
                        Paused
                      </Badge>
                    ) : null}
                    {a.offers.winning ? (
                      <Badge surface="light" tone="success">
                        Wins {a.offers.winning} offer(s)
                      </Badge>
                    ) : (
                      <Badge surface="light" tone="neutral">
                        No winning offer
                      </Badge>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-ink-dark">
                  {a.enabled ? "On" : "Off"}
                  <Switch
                    checked={a.enabled}
                    label={`${a.name} available for new jobs`}
                    disabled={!canManage}
                    busy={busy === `${a.id}:enabled`}
                    onChange={(v) =>
                      void run(a, "enabled", async () => {
                        await api(`/api/admin/providers/${a.id}/settings`, { body: { patch: { enabled: v } } });
                        return v ? "Switched on. Only verified offers with routing on receive jobs." : "Switched off for new jobs. Jobs already sent finish normally.";
                      })
                    }
                  />
                </label>
              </div>

              <div className="mt-4">
                <BalanceCell a={a} large />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-4 sm:grid-cols-3">
                <Fact label="Key">
                  {a.credential.source === "vault"
                    ? `${a.credential.hint ?? "Saved"} · v${a.credential.version}`
                    : a.credential.source === "environment"
                      ? "Server setting"
                      : "None"}
                  {a.credential.source === "vault" && a.credential.setAt ? <span className="block text-xs text-muted-dark">{when(a.credential.setAt)}</span> : null}
                  {a.credential.source === "environment" ? <span className="block text-xs text-muted-dark">{a.credential.environmentName}</span> : null}
                </Fact>
                <Fact label="This month">
                  {money(a.spend.monthConfirmedUsd)}
                  <span className="block text-xs text-muted-dark">
                    {a.spend.monthEstimatedUsd ? `+ ${money(a.spend.monthEstimatedUsd)} estimated` : "confirmed"}
                  </span>
                </Fact>
                <Fact label="Pending">{a.spend.pendingJobs ? `${a.spend.pendingJobs} job(s) · ${money(a.spend.pendingUsd)}` : "None"}</Fact>
                <Fact label="Funding terms">
                  {a.funding.feeBps ? `+${a.funding.feeBps / 100} % fee` : "No fee"}
                  {a.funding.bonusBps ? <span className="block text-xs text-muted-dark">{a.funding.bonusBps / 100} % bonus credits</span> : null}
                </Fact>
                <Fact label="Daily cap">{a.dailySpendCapUsd === null ? "None" : money(a.dailySpendCapUsd)}</Fact>
                <Fact label="Balance check">{caps?.balance === "api" ? "Read-only API call" : "Not available"}</Fact>
              </dl>
              {a.connection.message && a.connection.state !== "ok" ? (
                <p className="mt-2 text-xs font-semibold text-error-text">Last check: {a.connection.message}</p>
              ) : null}
              {msg[a.id] ? (
                <div className="mt-3">
                  <Notice tone={msg[a.id]!.tone}>{msg[a.id]!.text}</Notice>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canManage ? (
                  <Button size="sm" variant="secondary-light" icon={<KeyRound aria-hidden className="size-4" />} onClick={() => setKeyFor(a)}>
                    {a.credential.source === "vault" ? "Replace key" : "Add key"}
                  </Button>
                ) : null}
                {canManage && a.credential.source !== "none" ? (
                  <Button
                    size="sm"
                    variant="secondary-light"
                    icon={<PlugZap aria-hidden className="size-4" />}
                    busy={busy === `${a.id}:test`}
                    onClick={() =>
                      void run(a, "test", async () => {
                        const r = await api<{ result: { ok: boolean; state: string; error: string | null } }>(`/api/admin/providers/${a.id}/test`, { body: {} });
                        if (r.result.ok) return "Connected: the balance was read with the saved key (no generation was created).";
                        if (r.result.state === "unsupported") return "This provider has no documented read-only check; the key was saved but cannot be tested without a paid job.";
                        throw new Error(r.result.state === "unauthorized" ? `The provider refused the key (${r.result.error}).` : `The check failed (${r.result.error}).`);
                      })
                    }
                  >
                    Test connection
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost-light" icon={<Settings2 aria-hidden className="size-4" />} onClick={() => setSettingsFor(a)}>
                  Details
                </Button>
                <a href={BILLING[a.provider]} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-info-text underline">
                  {a.name} account <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      {keyFor ? <KeyDialog a={keyFor} onClose={() => setKeyFor(null)} onSaved={reload} /> : null}
      {settingsFor ? (
        <SettingsDialog
          a={o.accounts.find((x) => x.id === settingsFor.id) ?? settingsFor}
          canManage={canManage}
          units={o.units.map((u) => u.unit)}
          hosts={o.runtime.providers[settingsFor.provider]}
          onClose={() => setSettingsFor(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

/**
 * Key entry. The value is sent once over HTTPS to the server, which stores it in Supabase Vault; the field is cleared
 * whatever the outcome and the reply contains only a masked hint. Saving needs a recent sign-in.
 */
function KeyDialog({ a, onClose, onSaved }: { a: ProviderAccount; onClose: () => void; onSaved: () => void }) {
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
      setMsg({ tone: "success", text: `Saved as version ${r.keyVersion} (${r.keyHint}). Use "Test connection" to check it with a read-only call.` });
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

function SettingsDialog({
  a,
  canManage,
  units,
  hosts,
  onClose,
  onSaved,
}: {
  a: ProviderAccount;
  canManage: boolean;
  units: string[];
  hosts?: { adapters: string[]; resultHosts: string[]; balance: string; usage: boolean };
  onClose: () => void;
  onSaved: () => void;
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
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

  return (
    <Dialog open surface="light" size="lg" onClose={onClose} title={`${a.name} details`} description="Limits, funding terms and balance entries. Every change is audited.">
      <div className="space-y-6">
        <dl>
          <KV k="Native unit">{UNIT_LABEL[a.nativeUnit] ?? a.nativeUnit}</KV>
          <KV k="Integrations in this release">{hosts?.adapters.length ? hosts.adapters.join(", ") : "None"}</KV>
          <KV k="Result hosts">{hosts?.resultHosts.length ? hosts.resultHosts.join(", ") : "Not documented — add the confirmed host to MEDIA_FETCH_ALLOWED_HOSTS after the first test"}</KV>
          <KV k="Usage endpoint">{hosts?.usage ? "Yes (account level, may include other apps)" : "No"}</KV>
          <KV k="Circuit breaker">{a.circuit.blockedUntil ? `Refusing until ${when(a.circuit.blockedUntil)} (${a.circuit.code})` : "Clear"}</KV>
        </dl>

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
                    return "Saved. New routes use these terms; jobs already sent keep theirs.";
                  })
                }
              >
                Save
              </Button>
            </div>
          ) : null}
        </fieldset>

        {canManage ? (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink-dark">Manual balance</legend>
            <p className="text-xs text-muted-dark sm:col-span-2">For a provider without a balance endpoint, or to note what its dashboard shows. It is labelled as manual and dated; it never replaces a newer API reading.</p>
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
          <RemoveKey a={a} busy={busy === "remove"} onRemove={(reason) => void call("remove", async () => {
            await api(`/api/admin/providers/${a.id}/key/remove`, { body: { reason } });
            return a.provider === "kie" ? "Key removed. KIE falls back to the server setting, if one exists." : "Key removed. New jobs no longer use this provider.";
          })} />
        ) : null}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </div>
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-dark">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-dark tabular">{children}</dd>
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
