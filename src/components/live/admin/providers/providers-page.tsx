"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHead } from "@/components/console/parts";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/live/api";
import { useApi } from "@/lib/live/account";
import { Notice, Tabs, Wrap } from "../catalog/shared";
import { useAdminMe } from "../live-admin";
import { ModelsTab } from "./models-tab";
import { OverviewTab } from "./overview-tab";
import { ProvidersTab } from "./providers-tab";
import type { ProvidersOverview } from "./types";
import { UsageTab } from "./usage-tab";

type TabId = "overview" | "providers" | "models" | "usage";
const TAB_IDS: TabId[] = ["overview", "providers", "models", "usage"];

/**
 * Providers & routing (provider.read; changes need provider.manage, which only the owner has). Keys are entered here
 * and stored in Vault on the server; this page only ever sees a masked hint. Balances and spending are read from the
 * database as recorded, with their source and age — nothing on this page is sample data. `?tab=models&model=<id>` opens
 * one model's supplier comparison (links from Admin › Models).
 */
export function ProvidersPage() {
  const me = useAdminMe();
  const caps = me.data?.capabilities ?? [];
  const sp = useSearchParams();
  const linkedTab = sp.get("tab") as TabId | null;
  const [tab, setTab] = useState<TabId>(linkedTab && TAB_IDS.includes(linkedTab) ? linkedTab : "overview");
  const overview = useApi<ProvidersOverview>(caps.includes("provider.read") ? "/api/admin/providers/overview" : null, [caps.length]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const refreshBalances = useCallback(async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await api<ProvidersOverview>("/api/admin/providers/balances/refresh", { body: {} });
      overview.setData(r);
      const n = r.refreshed?.filter((x) => !x.skipped).length ?? 0;
      const failed = r.refreshed?.filter((x) => x.ok === false).length ?? 0;
      setRefreshMsg({ tone: failed ? "error" : "success", text: n ? `${n} provider(s) read${failed ? `, ${failed} failed` : ""}.` : "Nothing to read: no provider has a key, or they were just read." });
    } catch (e) {
      setRefreshMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  }, [overview]);

  const canManage = Boolean(overview.data?.canManage);
  return (
    <Wrap>
      <PageHead
        title="Providers & routing"
        sub="Supplier keys, balances and spending, and which supplier serves each model. Customers always see one card per model; the server picks the cheapest verified supplier for the exact settings."
        actions={
          caps.includes("provider.read") ? (
            <Button size="sm" variant="secondary-light" busy={refreshing} icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void refreshBalances()}>
              Refresh balances
            </Button>
          ) : undefined
        }
      />
      {!me.data ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
      ) : !caps.includes("provider.read") ? (
        <Notice>Your role cannot see suppliers, balances or routing.</Notice>
      ) : (
        <>
          {refreshMsg ? <Notice tone={refreshMsg.tone}>{refreshMsg.text}</Notice> : null}
          <Tabs<TabId>
            label="Providers and routing"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "providers", label: "Providers", count: overview.data?.accounts.length },
              { id: "models", label: "Models" },
              { id: "usage", label: "Usage" },
            ]}
          />
          {overview.error && !overview.data ? (
            <Notice tone="error" title="Providers could not load" action={<Button size="sm" variant="secondary-light" onClick={overview.reload}>Try again</Button>}>
              {overview.error.message}
            </Notice>
          ) : !overview.data ? (
            <div role="status" aria-busy="true" aria-label="Loading providers" className="h-48 animate-pulse-soft rounded-[var(--radius-media)] bg-sheet" />
          ) : tab === "overview" ? (
            <OverviewTab o={overview.data} onOpen={(t) => setTab(t)} />
          ) : tab === "providers" ? (
            <ProvidersTab o={overview.data} canManage={canManage} reload={overview.reload} />
          ) : tab === "models" ? (
            <ModelsTab canManage={canManage} canTest={caps.includes("catalog.test")} units={overview.data.units} focusModel={sp.get("model")} />
          ) : (
            <UsageTab accounts={overview.data.accounts} />
          )}
        </>
      )}
    </Wrap>
  );
}
