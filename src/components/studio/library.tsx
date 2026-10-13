"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Archive, CircleX, Heart, LoaderCircle, Play, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { MODELS, TOOLS, type ToolId } from "@/lib/catalog";
import { PHASE_LABEL, SEED_TIME, isTerminal, jobPhase, saveDraft, useDemo, useNow, type Job } from "@/lib/demo-store";
import { fmtCredits, fmtDate } from "@/lib/format";
import { MEDIA, stillOf } from "@/lib/media";
import { ResultActions, ResultDetails, ResultMedia } from "./result-view";

type Status = "all" | "ready" | "running" | "failed" | "expired";

export function Library() {
  const demo = useDemo();
  const now = useNow();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [type, setType] = useState<"all" | ToolId>("all");
  const [model, setModel] = useState("all");
  const [period, setPeriod] = useState<"any" | "7" | "30">("any");
  const [status, setStatus] = useState<Status>("all");
  const [favorites, setFavorites] = useState(false);
  const ids = useId();

  const openId = params.get("job");
  const open = openId ? demo.jobs.find((j) => j.id === openId && !j.removed) : undefined;
  const setOpen = (id: string | null) => router.replace(id ? `${pathname}?job=${id}` : pathname, { scroll: false });

  // Reference "now" for period filters: the clock when available, else the seed time (stable on first render).
  const ref = now || SEED_TIME;
  const statusOf = (j: Job): Exclude<Status, "all"> => {
    if (j.expired) return "expired";
    const p = jobPhase(j, now);
    if (p === "failed" || p === "cancelled") return "failed";
    return isTerminal(p) ? "ready" : "running";
  };

  const jobs = demo.jobs.filter((j) => {
    if (j.removed) return false;
    if (type !== "all" && j.tool !== type) return false;
    if (model !== "all" && j.settings.modelId !== model) return false;
    if (period !== "any" && ref - j.createdAt > Number(period) * 86_400_000) return false;
    if (favorites && !j.favorite) return false;
    if (status !== "all" && statusOf(j) !== status) return false;
    return true;
  });

  const filtered = type !== "all" || model !== "all" || period !== "any" || status !== "all" || favorites;

  const select = "h-10 rounded-full border border-line-strong bg-raised px-4 text-sm text-ink";

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.875rem] leading-tight font-extrabold sm:text-[2.25rem]">Library</h1>
          <p className="text-muted">Every result keeps its prompt, settings and credit record. Files are private unless you share them.</p>
        </div>
      </div>

      <form aria-label="Filter results" className="mt-6 flex flex-wrap items-end gap-3 rounded-[24px] border border-white/[0.08] bg-surface p-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-type`} className="text-xs font-semibold text-muted">
            Type
          </label>
          <select id={`${ids}-type`} value={type} onChange={(e) => setType(e.target.value as typeof type)} className={select}>
            <option value="all">All types</option>
            <option value="image">Image</option>
            <option value="edit">Edit</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-model`} className="text-xs font-semibold text-muted">
            Model
          </label>
          <select id={`${ids}-model`} value={model} onChange={(e) => setModel(e.target.value)} className={select}>
            <option value="all">All models</option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-period`} className="text-xs font-semibold text-muted">
            Period
          </label>
          <select id={`${ids}-period`} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className={select}>
            <option value="any">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-status`} className="text-xs font-semibold text-muted">
            Status
          </label>
          <select id={`${ids}-status`} value={status} onChange={(e) => setStatus(e.target.value as Status)} className={select}>
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="running">Running</option>
            <option value="failed">Failed or cancelled</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-raised px-4 text-sm text-ink">
          <input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} className="size-4 accent-brand-blue" />
          Favorites only
        </label>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setType("all");
              setModel("all");
              setPeriod("any");
              setStatus("all");
              setFavorites(false);
            }}
            className="h-10 px-2 text-sm font-semibold text-link hover:underline"
          >
            Clear filters
          </button>
        ) : null}
        <p className="ml-auto self-center text-sm text-muted" role="status">
          {jobs.length} {jobs.length === 1 ? "result" : "results"}
        </p>
      </form>

      {jobs.length ? (
        <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {jobs.map((j) => (
            <li key={j.id}>
              <JobCard job={j} status={statusOf(j)} phaseLabel={PHASE_LABEL[jobPhase(j, now)]} onOpen={() => setOpen(j.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-[24px] border border-dashed border-line-strong p-10 text-center">
          <p className="font-semibold text-ink">{filtered ? "No results match these filters" : "Your library is empty"}</p>
          <p className="mt-1 text-sm text-muted">{filtered ? "Try clearing a filter." : "Results you generate appear here with their prompt and settings."}</p>
        </div>
      )}

      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title ?? ""} description={open ? `${TOOLS[open.tool].label} · ${fmtDate(open.createdAt)} · ${open.id}` : undefined} size="xl">
        {open ? <DetailBody job={open} status={statusOf(open)} onClose={() => setOpen(null)} /> : null}
      </Dialog>
    </div>
  );
}

function DetailBody({ job, status, onClose }: { job: Job; status: Exclude<Status, "all">; onClose: () => void }) {
  const router = useRouter();
  const reuse = () => {
    saveDraft({ tool: job.tool, prompt: job.prompt, settings: { ...job.settings }, source: "studio", referenceSample: job.tool === "edit" ? true : undefined });
    onClose();
    router.push(TOOLS[job.tool].href);
  };
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        {status === "ready" ? (
          <ResultMedia job={job} maxH="max-h-[56vh]" sizes="(min-width: 1024px) 50vw, 90vw" />
        ) : status === "expired" ? (
          <ExpiredNotice job={job} />
        ) : status === "failed" ? (
          <div className="rounded-[var(--radius-media)] border border-[rgb(214_54_82/0.45)] bg-[rgb(214_54_82/0.08)] p-5 text-sm">
            <p className="font-semibold text-ink">This job didn&apos;t finish</p>
            <p className="mt-1 text-muted">{job.failureReason ?? "Cancelled before submission."}</p>
            <p className="mt-2 font-semibold text-brand-lime">{fmtCredits(job.credits)} returned to your balance.</p>
          </div>
        ) : (
          <div className="rounded-[var(--radius-media)] border border-white/[0.08] bg-surface p-5 text-sm text-muted">Still running. The file appears here when it&apos;s saved.</div>
        )}
      </div>
      <div className="space-y-4 lg:col-span-2">
        {status === "ready" ? <ResultActions job={job} onReuse={reuse} compact /> : null}
        {status !== "ready" ? (
          <button type="button" onClick={reuse} className="inline-flex h-10 items-center rounded-full border border-white/20 bg-white/[0.04] px-4 text-sm font-semibold text-ink hover:border-white/45">
            Reuse prompt and settings
          </button>
        ) : null}
        <ResultDetails job={job} defaultOpen />
        {job.tool === "edit" ? (
          <div className="rounded-[var(--radius-media)] border border-white/[0.08] bg-surface p-4 text-sm">
            <p className="font-semibold text-ink">Versions</p>
            <ol className="mt-2 space-y-1 text-muted">
              <li>v0 · Original reference (kept unchanged)</li>
              <li>v1 · Edit from this job</li>
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExpiredNotice({ job }: { job: Job }) {
  return (
    <div className="grid aspect-[3/2] place-items-center rounded-[var(--radius-media)] border border-dashed border-line-strong bg-surface p-6 text-center">
      <div>
        <Archive aria-hidden className="mx-auto size-8 text-muted" />
        <p className="mt-3 font-semibold text-ink">This file has expired</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Files are removed after the retention period. The prompt, settings and credit record ({fmtCredits(job.credits)}) are kept, so you can generate it again.
        </p>
      </div>
    </div>
  );
}

function JobCard({ job, status, phaseLabel, onOpen }: { job: Job; status: Exclude<Status, "all">; phaseLabel: string; onOpen: () => void }) {
  const m = MEDIA[job.media];
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        {status === "ready" ? (
          <>
            <Image src={stillOf(job.media)} alt={m.alt} fill sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 45vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            {m.kind === "video" ? (
              <span className="absolute right-2 bottom-2 inline-flex h-7 items-center gap-1 rounded-full bg-[rgb(15_18_18/0.8)] px-2 text-[11px] font-semibold tabular">
                <Play aria-hidden className="size-3" /> 0:{String(m.duration ?? 5).padStart(2, "0")}
              </span>
            ) : null}
          </>
        ) : status === "expired" ? (
          <div className="grid h-full place-items-center p-3 text-center text-xs text-muted">
            <span>
              <Archive aria-hidden className="mx-auto mb-1.5 size-5" />
              File expired · details kept
            </span>
          </div>
        ) : status === "failed" ? (
          <div className="grid h-full place-items-center p-3 text-center text-xs text-muted">
            <span>
              <CircleX aria-hidden className="mx-auto mb-1.5 size-5 text-error-on-dark" />
              Credits returned
            </span>
          </div>
        ) : (
          <div className="grid h-full place-items-center">
            <LoaderCircle aria-hidden className="size-6 animate-spin-slow text-brand-blue-bright" />
          </div>
        )}
        <span className="absolute top-2 left-2 flex gap-1">
          {job.favorite ? (
            <span className="grid size-7 place-items-center rounded-full bg-[rgb(15_18_18/0.8)]" title="Favorite">
              <Heart aria-hidden className="size-3.5 fill-brand-blue-bright text-brand-blue-bright" />
              <span className="sr-only">Favorite</span>
            </span>
          ) : null}
          {job.shareUrl ? (
            <span className="grid size-7 place-items-center rounded-full bg-[rgb(15_18_18/0.8)]" title="Public link on">
              <Share2 aria-hidden className="size-3.5 text-orange-on-dark" />
              <span className="sr-only">Public link on</span>
            </span>
          ) : null}
        </span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink group-hover:underline">{job.title}</p>
          <p className="truncate text-xs text-muted">
            {TOOLS[job.tool].label} · {fmtDate(job.createdAt)}
          </p>
        </div>
        <span className="shrink-0">
          {status === "ready" ? (
            <Badge tone="success">Ready</Badge>
          ) : status === "expired" ? (
            <Badge tone="neutral">Expired</Badge>
          ) : status === "failed" ? (
            <Badge tone="error">Failed</Badge>
          ) : (
            <Badge tone="info" icon="busy">
              {phaseLabel}
            </Badge>
          )}
        </span>
      </div>
    </button>
  );
}
