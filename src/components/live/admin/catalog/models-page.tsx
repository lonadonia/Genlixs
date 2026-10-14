"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { PageHead, Panel } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { api, ApiClientError, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { cn } from "@/lib/format";
import { Diagnostics, type DiagnosticsSection } from "./diagnostics";
import { Empty, inputCls, Notice, Switch, Wrap } from "./shared";
import type { AdminModel, AvailabilityState, CatalogData, Check } from "./types";

type Filter = "all" | "image" | "video";
type RowMessage = { tone: "error" | "attention"; text: string; fix?: { label: string; href?: string; section?: DiagnosticsSection } };

const isOn = (s: AvailabilityState) => s === "enabled" || s === "experimental";
const kindLabel = (m: AdminModel) => (m.tool === "video" ? "Video" : m.tool === "edit" ? "Image edit" : "Image");

/** What stops a model from being switched on, in one short sentence with one fix. */
function blockerMessage(m: AdminModel, c: Check): RowMessage {
  switch (c.key) {
    case "price":
      return { tone: "attention", text: "Set a price first.", fix: { label: "Set price", href: `/admin/pricing?model=${m.id}` } };
    case "supplier_cost":
      return { tone: "attention", text: "The KIE cost is unknown.", fix: { label: "Open KIE cost", section: "cost" } };
    case "adapter":
      return { tone: "attention", text: "This release cannot send work to this model yet." };
    case "provider_account":
      return { tone: "attention", text: "The KIE account is paused in Genlixs." };
    default:
      return { tone: "attention", text: c.detail };
  }
}

/**
 * Models: one On/Off switch per model. The switch calls the real availability endpoint; it shows a pending state,
 * keeps the new position on success and returns to the old one on failure. Maintenance, experimental labels, private
 * tests, KIE cost sources and technical details live behind "Details".
 */
export function ModelsPage() {
  const c = useApi<CatalogData>("/api/admin/catalog");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState<Record<string, AvailabilityState>>({});
  const [messages, setMessages] = useState<Record<string, RowMessage | undefined>>({});
  const [announce, setAnnounce] = useState("");
  const [details, setDetails] = useState<{ id: string; section: DiagnosticsSection } | null>(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (c.data?.models ?? []).filter(
      (m) => (filter === "all" || m.category === filter) && (!term || [m.name, m.family ?? "", m.variant ?? ""].some((s) => s.toLowerCase().includes(term))),
    );
  }, [c.data, filter, q]);

  if (c.error && !c.data) {
    return (
      <Wrap>
        <Notice tone="error" title="Models could not load" action={<Button size="sm" variant="secondary-light" onClick={c.reload}>Try again</Button>}>
          {c.error.message}
        </Notice>
      </Wrap>
    );
  }
  if (!c.data) {
    return (
      <Wrap>
        <div role="status" aria-busy="true" aria-label="Loading models" className="h-64 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      </Wrap>
    );
  }
  const d = c.data;
  const onCount = d.models.filter((m) => isOn(m.state)).length;

  const setMessage = (id: string, msg: RowMessage | undefined) => setMessages((all) => ({ ...all, [id]: msg }));

  const toggle = async (m: AdminModel, on: boolean) => {
    setMessage(m.id, undefined);
    if (on) {
      if (!d.runtime.submitsEnabled) {
        setMessage(m.id, { tone: "attention", text: "This site cannot send work to KIE yet (the KIE key is missing on the server)." });
        return;
      }
      const block = m.readiness.checks.find((x) => !x.ok && !x.warning);
      if (block) {
        setMessage(m.id, blockerMessage(m, block));
        return;
      }
    }
    const target: AvailabilityState = on ? "enabled" : "disabled";
    setPending((p) => ({ ...p, [m.id]: target }));
    try {
      await api(`/api/admin/catalog/models/${m.id}/availability`, { body: { state: target } });
      c.setData((prev) => (prev ? { ...prev, models: prev.models.map((x) => (x.id === m.id ? { ...x, state: target, note: null } : x)) } : prev));
      setAnnounce(`${m.name} is ${on ? "on. Customers can use it now" : "off. New requests are refused; running jobs finish"}.`);
      c.reload();
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : "";
      setMessage(
        m.id,
        code === "MODEL_NOT_PRICED"
          ? { tone: "attention", text: "Set a price first.", fix: { label: "Set price", href: `/admin/pricing?model=${m.id}` } }
          : { tone: "error", text: `Not changed: ${errorMessage(e)}` },
      );
      setAnnounce(`${m.name} was not changed.`);
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
    }
  };

  return (
    <Wrap>
      <PageHead
        title="Models"
        sub="Switch models on or off for customers. A model needs a price before it can be switched on; changes are recorded in the audit log."
        actions={
          <Button size="sm" variant="secondary-light" icon={<RefreshCw aria-hidden className="size-4" />} onClick={c.reload} busy={c.loading}>
            Refresh
          </Button>
        }
      />
      {!d.runtime.submitsEnabled ? (
        <Notice tone="attention" title="Models cannot be switched on here">
          This deployment has no KIE key, so customers could not generate. Add KIE_API_KEY in Vercel.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Model type" className="inline-flex rounded-full border border-rule-strong bg-sheet p-1">
          {(["all", "image", "video"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn("rounded-full px-3.5 py-1.5 text-sm font-semibold", filter === f ? "bg-ink-dark text-white" : "text-muted-dark hover:text-ink-dark")}
            >
              {f === "all" ? "All" : f === "image" ? "Images" : "Videos"}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Search models</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-dark" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className={cn(inputCls, "w-64 max-w-full pl-9")} />
        </label>
        <p className="text-sm text-muted-dark">
          {onCount} of {d.models.length} on
        </p>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <Panel bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <Empty>No model matches this search.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((m) => {
              const state = pending[m.id] ?? m.state;
              const busy = m.id in pending;
              const msg = messages[m.id];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-semibold text-ink-dark">{m.name}</p>
                    <p className="text-xs text-muted-dark">
                      {kindLabel(m)}
                      {m.family ? ` · ${m.family}` : ""}
                      {m.variant ? (
                        <span className="ml-1.5 rounded-full border border-rule px-1.5 py-px text-[11px] font-semibold text-ink-dark">{m.variant}</span>
                      ) : null}
                    </p>
                    {state === "maintenance" ? <p className="mt-0.5 text-xs text-orange-text">Paused for maintenance{m.note ? `: “${m.note}”` : ""}</p> : null}
                    {state === "experimental" ? <p className="mt-0.5 text-xs text-muted-dark">Shown to customers as experimental</p> : null}
                    {msg ? (
                      <p role={msg.tone === "error" ? "alert" : undefined} className={cn("mt-1 text-sm", msg.tone === "error" ? "text-error-text" : "text-orange-text")}>
                        {msg.text}{" "}
                        {msg.fix?.href ? (
                          <Link href={msg.fix.href} className="font-semibold text-info-text underline">
                            {msg.fix.label}
                          </Link>
                        ) : msg.fix?.section ? (
                          <button type="button" onClick={() => setDetails({ id: m.id, section: msg.fix!.section! })} className="font-semibold text-info-text underline">
                            {msg.fix.label}
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("w-16 text-right text-sm font-semibold", isOn(state) ? "text-ink-dark" : "text-muted-dark")} aria-hidden>
                      {busy ? "Saving…" : isOn(state) ? "On" : "Off"}
                    </span>
                    <Switch
                      checked={isOn(state)}
                      busy={busy}
                      disabled={!d.access.canOperate}
                      onChange={(on) => void toggle(m, on)}
                      label={`${m.name}: available to customers`}
                    />
                    <Button size="sm" variant="ghost-light" onClick={() => setDetails({ id: m.id, section: "status" })} aria-label={`Details for ${m.name}`}>
                      Details
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {!d.access.canOperate ? <p className="text-sm text-muted-dark">Your role can see models but not switch them on or off.</p> : null}
      <p className="text-xs text-muted-dark">
        Off: hidden from customers, new price checks and submissions are refused (also for prices checked earlier); jobs already running finish
        normally. Customers see a change within a few seconds.
      </p>
      {details ? (
        <Diagnostics
          modelId={details.id}
          section={details.section}
          onSection={(s) => setDetails({ ...details, section: s })}
          onClose={() => setDetails(null)}
          onChanged={c.reload}
        />
      ) : null}
    </Wrap>
  );
}
