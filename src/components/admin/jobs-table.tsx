"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { ADMIN_JOBS, STATUS_META, type AdminJob, type AdminJobStatus } from "@/lib/admin-data";
import { TOOLS } from "@/lib/catalog";
import { cn, fmtDateTime } from "@/lib/format";

const PAGE = 10;
type SortKey = "createdAt" | "credits" | "supplierCostUsd" | "durationS";

export function JobsTable() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ids = useId();

  const status = (params.get("status") ?? "all") as AdminJobStatus | "all";
  const tool = params.get("tool") ?? "all";
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const sort = (params.get("sort") ?? "createdAt") as SortKey;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const base = ADMIN_JOBS.filter((j) => {
    if (tool !== "all" && j.tool !== tool) return false;
    if (q && !`${j.id} ${j.customerId} ${j.customer} ${j.model}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const totals = base.reduce<Record<string, number>>((acc, j) => ((acc[j.status] = (acc[j.status] ?? 0) + 1), acc), {});
  const rows = base
    .filter((j) => status === "all" || j.status === status)
    .sort((a, b) => {
      const av = a[sort] ?? -1;
      const bv = b[sort] ?? -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "asc" ? 1 : -1);
    });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const back = encodeURIComponent(params.toString());

  const sortHead = (k: SortKey, children: string, right?: boolean) => {
    const on = sort === k;
    const Icon = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2.5 font-semibold", right && "text-right")}>
        <button
          type="button"
          onClick={() => set({ sort: k, dir: on && dir === "desc" ? "asc" : "desc" })}
          className={cn("inline-flex items-center gap-1 rounded-[6px] whitespace-nowrap hover:text-ink-dark", on && "text-ink-dark")}
        >
          {children}
          <Icon aria-hidden className="size-3.5" />
        </button>
      </th>
    );
  };

  const select = "h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-sm text-ink-dark";
  // Status filter chips: the selected one is electric blue (white text 6.7:1); the rest stay neutral.
  const chip = (on: boolean) =>
    cn(
      "h-9 rounded-full border px-3 text-sm font-semibold transition-colors",
      on ? "border-brand-blue bg-brand-blue text-white" : "border-[#cfd4cd] bg-sheet text-muted-dark hover:border-[#9aa29f] hover:text-ink-dark",
    );
  const pager =
    "inline-flex h-10 items-center gap-1 rounded-full border border-[#cfd4cd] bg-sheet px-4 font-semibold text-ink-dark transition-colors hover:border-[#9aa29f] hover:bg-paper disabled:pointer-events-none disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-media)] border border-rule bg-sheet p-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-tool`} className="text-xs font-semibold text-muted-dark">
            Tool
          </label>
          <select id={`${ids}-tool`} value={tool} onChange={(e) => set({ tool: e.target.value })} className={select}>
            <option value="all">All tools</option>
            <option value="image">Image</option>
            <option value="edit">Edit</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-status`} className="text-xs font-semibold text-muted-dark">
            Status
          </label>
          <select id={`${ids}-status`} value={status} onChange={(e) => set({ status: e.target.value })} className={select}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_META) as AdminJobStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        {q ? (
          <p className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-info-tint px-3 text-sm text-info-text">
            Search: “{params.get("q")}”
            <button type="button" onClick={() => set({ q: null })} className="font-semibold underline">
              Clear
            </button>
          </p>
        ) : null}
        <p className="ml-auto self-center text-sm text-muted-dark" role="status">
          {rows.length} of {ADMIN_JOBS.length} jobs
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Status totals">
        <button type="button" onClick={() => set({ status: null })} aria-pressed={status === "all"} className={chip(status === "all")}>
          All · {base.length}
        </button>
        {(Object.keys(STATUS_META) as AdminJobStatus[])
          .filter((s) => totals[s])
          .map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => set({ status: s })}
              className={chip(status === s)}
            >
              {STATUS_META[s].label} · {totals[s]}
            </button>
          ))}
      </div>

      {/* ≥768px: contained, scrollable table. Phone: record cards. */}
      <div className="hidden rounded-[var(--radius-media)] border border-rule bg-sheet md:block">
        <div className="scroll-thin relative overflow-x-auto" role="region" aria-label="Jobs table, scroll horizontally for more columns" tabIndex={0}>
          <table className="w-full min-w-[1120px] text-sm">
            <caption className="sr-only">Jobs, sorted by {sort} {dir === "asc" ? "ascending" : "descending"}</caption>
            <thead className="sticky top-0 bg-sheet">
              <tr className="border-b border-rule text-left text-muted-dark">
                <th scope="col" className="px-4 py-2.5 font-semibold">Job ID</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Model · tool</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
                {sortHead("createdAt", "Created")}
                {sortHead("durationS", "Duration", true)}
                {sortHead("credits", "Credits", true)}
                {sortHead("supplierCostUsd", "Supplier cost", true)}
                <th scope="col" className="px-3 py-2.5 font-semibold">Import</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length ? (
                shown.map((j) => (
                  <tr key={j.id} className="h-12 border-b border-rule last:border-0 hover:bg-paper">
                    <td className="px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs text-ink-dark">{j.id}</span>
                        <CopyButton value={j.id} label="" copiedLabel="" variant="inline" surface="light" className="size-8 border-0 bg-transparent px-0" srLabel={`Copy job ID ${j.id}`} />
                      </span>
                    </td>
                    <td className="px-3 text-ink-dark">
                      <span className="block whitespace-nowrap">{j.model}</span>
                      <span className="block text-xs text-muted-dark">{TOOLS[j.tool].label}</span>
                    </td>
                    <td className="px-3">
                      <span className="block text-ink-dark">{j.customerId}</span>
                      <span className="block text-xs text-muted-dark">{j.customer}</span>
                    </td>
                    <td className="px-3 whitespace-nowrap text-muted-dark">{fmtDateTime(j.createdAt)}</td>
                    <td className="px-3 text-right tabular">{j.durationS === null ? "—" : `${j.durationS}s`}</td>
                    <td className="px-3 text-right tabular">{j.credits}</td>
                    <td className="px-3 text-right tabular">${j.supplierCostUsd.toFixed(3)}</td>
                    <td className="px-3 whitespace-nowrap text-muted-dark capitalize">{j.importState}</td>
                    <td className="px-3">
                      <Badge surface="light" tone={STATUS_META[j.status].tone}>
                        {STATUS_META[j.status].label}
                      </Badge>
                    </td>
                    <td className="px-4 text-right">
                      <Link href={`/admin/jobs/${j.id}?back=${back}`} className="inline-flex h-9 items-center rounded-full px-2 font-semibold text-info-text hover:bg-info-tint">
                        Details<span className="sr-only"> for {j.id}</span>
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-muted-dark">
                    No jobs match these filters. <button type="button" onClick={() => router.replace(pathname)} className="font-semibold text-info-text underline">Clear filters</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="space-y-3 md:hidden">
        {shown.map((j) => (
          <li key={j.id}>
            <MobileCard j={j} back={back} />
          </li>
        ))}
        {!shown.length ? <li className="rounded-[var(--radius-media)] border border-rule bg-sheet p-6 text-center text-sm text-muted-dark">No jobs match these filters.</li> : null}
      </ul>

      <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm text-muted-dark">
        <p>
          Page {current} of {pages} · {rows.length} total
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={current <= 1}
            onClick={() => set({ page: String(current - 1) })}
            className={pager}
          >
            <ChevronLeft aria-hidden className="size-4" /> Previous
          </button>
          <button
            type="button"
            disabled={current >= pages}
            onClick={() => set({ page: String(current + 1) })}
            className={pager}
          >
            Next <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </nav>
    </div>
  );
}

function MobileCard({ j, back }: { j: AdminJob; back: string }) {
  return (
    <Link href={`/admin/jobs/${j.id}?back=${back}`} className="block rounded-[var(--radius-media)] border border-rule bg-sheet p-4 transition-colors hover:border-brand-blue">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-ink-dark">{j.id}</span>
        <Badge surface="light" tone={STATUS_META[j.status].tone}>
          {STATUS_META[j.status].label}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-ink-dark">
        {TOOLS[j.tool].label} · {j.model}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-dark">Customer</dt>
          <dd className="text-ink-dark">{j.customerId}</dd>
        </div>
        <div>
          <dt className="text-muted-dark">Credits</dt>
          <dd className="text-ink-dark tabular">{j.credits}</dd>
        </div>
        <div>
          <dt className="text-muted-dark">Created</dt>
          <dd className="text-ink-dark">{fmtDateTime(j.createdAt).replace(" UTC", "")}</dd>
        </div>
      </dl>
    </Link>
  );
}
