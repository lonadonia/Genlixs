"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Clapperboard,
  Gem,
  ImagePlus,
  Info,
  MonitorPlay,
  Play,
  Plus,
  RectangleHorizontal,
  Sparkles,
  Timer,
  WandSparkles,
} from "lucide-react";
import { Badge, ConceptTag } from "@/components/ui/badge";
import { TOOLS, TOOL_ORDER, defaultSettings, demoQuote, modelById, modelsFor, reconcileSettings, type Settings, type ToolId } from "@/lib/catalog";
import { PHASE_LABEL, isTerminal, jobPhase, saveDraft, submitJob, useDemo, useNow } from "@/lib/demo-store";
import { cn, fmtCredits, fmtDate, fmtNum } from "@/lib/format";
import { MEDIA, stillOf } from "@/lib/media";
import { pickMedia, titleFrom } from "./demo-helpers";

const ICON = { image: ImagePlus, edit: WandSparkles, video: Clapperboard };
const LIMIT = 1000;

/** Studio home (guide §08 Overview), laid out like a creation app: title, tool tabs, lit composer, promos, then work. */
export function Overview() {
  const demo = useDemo();
  const now = useNow();
  const active = demo.jobs.filter((j) => !j.removed && !isTerminal(jobPhase(j, now)));
  const recent = demo.jobs.filter((j) => !j.removed && !j.expired && j.settled === "charged").slice(0, 6);
  const hasHistory = demo.jobs.some((j) => j.settled === "charged");

  return (
    <div className="relative isolate">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] overflow-hidden">
        <div className="dot-field absolute inset-0" />
        <div className="glow-electric absolute top-[8%] left-1/2 h-[440px] w-[min(980px,100%)] -translate-x-1/2" />
      </div>

      <div className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-16 sm:px-6 lg:pt-12">
        <div className="text-center">
          <h1 className="font-display text-[2rem] leading-[1.05] font-extrabold text-balance sm:text-[2.75rem] lg:text-[3.25rem]">
            What would you like to <span className="text-brand-blue-bright">create?</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted sm:text-lg">Pick a tool. You&apos;ll see the exact credit cost before anything runs.</p>
        </div>

        <div className="mx-auto mt-8 max-w-[880px]">
          <QuickCreate />
        </div>

        {/* Promo row */}
        <section aria-labelledby="explore-h" className="mt-14">
          <h2 id="explore-h" className="sr-only">
            Explore the studio
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            <Promo
              href="/studio/edit"
              eyebrow="Edit studio"
              title="Change a scene with one sentence"
              icon={WandSparkles}
              visual={
                <>
                  <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                    <Image src={MEDIA.dunesNoon.src} alt="" fill sizes="(min-width: 768px) 16vw, 50vw" className="object-cover object-left" />
                  </div>
                  <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
                    <Image src={MEDIA.dunesDusk.src} alt="" fill sizes="(min-width: 768px) 16vw, 50vw" className="object-cover object-right" />
                  </div>
                  <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white" />
                </>
              }
            />
            <Promo
              href="/studio/video"
              eyebrow="Video studio"
              title="Short clips, five or ten seconds"
              icon={MonitorPlay}
              visual={
                <>
                  <Image src={stillOf("loop")} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                  <span aria-hidden className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-[70%] place-items-center rounded-full bg-[rgb(15_18_18/0.6)] text-white ring-1 ring-white/30 backdrop-blur-md">
                    <Play className="ml-0.5 size-5" />
                  </span>
                </>
              }
            />
            <Promo
              href="/studio/credits"
              eyebrow="Credits"
              title="Failed jobs give reserved credits back"
              icon={Gem}
              visual={<Image src={MEDIA.pills.src} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover object-[50%_62%]" />}
            />
          </ul>
        </section>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          <section aria-labelledby="active-h" className="self-start rounded-[24px] border border-white/[0.08] bg-surface p-5 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 id="active-h" className="font-semibold text-ink">
                Active jobs
              </h2>
              {active.length ? <Badge tone="info" icon="busy">{`${active.length} running`}</Badge> : null}
            </div>
            {active.length ? (
              <ul className="mt-3 divide-y divide-white/[0.06]">
                {active.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link href={TOOLS[j.tool].href} className="block truncate text-sm font-semibold text-ink hover:underline">
                        {j.title}
                      </Link>
                      <p className="text-xs text-muted">
                        {TOOLS[j.tool].label} · {j.id}
                      </p>
                    </div>
                    <Badge tone="info" icon="busy">
                      {PHASE_LABEL[jobPhase(j, now)]}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">Nothing running. Jobs you start keep running here if you leave the studio.</p>
            )}
          </section>

          <section aria-labelledby="recent-h" className="lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 id="recent-h" className="font-semibold text-ink">
                Recent work
              </h2>
              <Link href="/studio/library" className="text-sm font-semibold text-link underline-offset-4 hover:underline">
                Open library
              </Link>
            </div>
            {hasHistory ? (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {recent.map((j) => {
                  const m = MEDIA[j.media];
                  return (
                    <li key={j.id}>
                      <Link href={`/studio/library?job=${j.id}`} className="group block">
                        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
                          <Image src={stillOf(j.media)} alt={m.alt} fill sizes="(min-width: 640px) 22vw, 45vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                          {m.kind === "video" ? (
                            <span className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-[rgb(15_18_18/0.8)]">
                              <Play aria-hidden className="ml-0.5 size-3.5" />
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 truncate text-sm font-semibold text-ink">{j.title}</p>
                        <p className="text-xs text-muted">
                          {TOOLS[j.tool].label} · {fmtDate(j.createdAt)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-line-strong p-6 text-sm text-muted">
                Your first results will appear here. Try a prompt idea above.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Promo({ href, eyebrow, title, icon: Icon, visual }: { href: string; eyebrow: string; title: string; icon: ComponentType<{ className?: string }>; visual: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="group relative block aspect-[16/10] overflow-hidden rounded-[24px] border border-white/[0.08] bg-raised">
        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.04]">{visual}</div>
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_top,rgb(15_18_18/0.95)_10%,rgb(15_18_18/0.55)_45%,transparent_75%)]" />
        <ConceptTag className="absolute top-3 left-3" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-link">
              <Icon aria-hidden className="size-3.5" /> {eyebrow}
            </p>
            <p className="mt-1 text-[17px] leading-snug font-semibold text-white">{title}</p>
          </div>
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-brand-night transition-colors group-hover:bg-brand-blue group-hover:text-white">
            <ArrowUpRight className="size-4" />
          </span>
        </div>
      </Link>
    </li>
  );
}

/** Home composer: same draft as the tool pages, exact cost beside the round Generate button. */
function QuickCreate() {
  const router = useRouter();
  const demo = useDemo();
  const tabIds = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = demo.draft;
  const tool: ToolId = draft?.tool ?? "image";
  const prompt = draft?.prompt ?? "";
  const settings: Settings = draft?.settings ?? defaultSettings(tool);
  const model = modelById(settings.modelId) ?? modelsFor(tool)[0];
  const credits = demoQuote(settings);
  const insufficient = tool !== "edit" && credits > demo.available;

  const write = (patch: { tool?: ToolId; prompt?: string; settings?: Settings }) => {
    const nextTool = patch.tool ?? tool;
    saveDraft({
      tool: nextTool,
      prompt: patch.prompt ?? prompt,
      settings: patch.settings ?? (patch.tool && patch.tool !== tool ? defaultSettings(nextTool) : settings),
      source: "studio",
      referenceSample: nextTool === "edit" ? draft?.referenceSample : undefined,
    });
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TOOL_ORDER.indexOf(tool);
    let next: ToolId | null = null;
    if (e.key === "ArrowRight") next = TOOL_ORDER[(i + 1) % TOOL_ORDER.length];
    if (e.key === "ArrowLeft") next = TOOL_ORDER[(i - 1 + TOOL_ORDER.length) % TOOL_ORDER.length];
    if (e.key === "Home") next = TOOL_ORDER[0];
    if (e.key === "End") next = TOOL_ORDER[TOOL_ORDER.length - 1];
    if (next) {
      e.preventDefault();
      write({ tool: next });
      tabRefs.current[next]?.focus();
    }
  };

  const submit = () => {
    if (tool === "edit") {
      write({});
      router.push("/studio/edit");
      return;
    }
    if (prompt.trim().length < 3) {
      setError(`${TOOLS[tool].promptLabel} in a few words before generating.`);
      promptRef.current?.focus();
      return;
    }
    if (insufficient) return;
    const job = submitJob({ tool, title: titleFrom(prompt), prompt: prompt.trim(), settings, credits, outcome: "success", media: pickMedia(tool, settings, prompt) });
    if (job) router.push(TOOLS[tool].href);
  };

  const available = modelsFor(tool).filter((m) => m.availability !== "maintenance");
  const actionLabel = tool === "edit" ? "Add a reference in the edit studio" : `Generate for ${fmtCredits(credits)}`;

  return (
    <div>
      <div className="flex justify-center">
        <div role="tablist" aria-label="Choose a tool" className="scroll-none flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md">
          {TOOL_ORDER.map((t) => {
            const Icon = ICON[t];
            const selected = t === tool;
            return (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                role="tab"
                type="button"
                id={`${tabIds}-tab-${t}`}
                aria-selected={selected}
                aria-controls={`${tabIds}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => write({ tool: t })}
                onKeyDown={onTabKey}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors sm:px-5",
                  selected ? "bg-brand-blue text-white shadow-[0_8px_24px_-10px_rgb(37_63_246/0.9)]" : "text-muted hover:bg-white/[0.06] hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {TOOLS[t].label}
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-tab-${tool}`} className="console-frame mt-5 p-3 sm:p-4">
        <div className="flex gap-3 sm:gap-4">
          {tool === "edit" ? (
            <Link
              href="/studio/edit"
              onClick={() => write({})}
              className="group grid size-[84px] shrink-0 place-items-center rounded-2xl border border-dashed border-white/30 bg-white/[0.03] text-muted transition-colors hover:border-brand-blue-bright hover:text-ink sm:size-24"
            >
              <span className="flex flex-col items-center gap-1 px-1 text-center">
                <Plus aria-hidden className="size-6 transition-transform group-hover:scale-110" />
                <span className="text-[11px] leading-tight font-semibold">Add reference</span>
              </span>
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <label htmlFor="home-prompt" className="block px-1 pt-1 text-sm font-semibold text-ink">
              {TOOLS[tool].promptLabel}
            </label>
            <textarea
              ref={promptRef}
              id="home-prompt"
              value={prompt}
              maxLength={LIMIT}
              onChange={(e) => {
                write({ prompt: e.target.value });
                if (error && e.target.value.trim().length >= 3) setError(null);
              }}
              placeholder={TOOLS[tool].promptPlaceholder}
              aria-invalid={Boolean(error)}
              aria-describedby={cn("home-prompt-note", error && "home-prompt-error") || undefined}
              className="mt-1 block min-h-[104px] w-full resize-none bg-transparent px-1 py-1 text-[17px] leading-relaxed text-ink placeholder:text-subtle focus-visible:outline-none sm:min-h-[120px] sm:text-lg"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 border-t border-white/[0.08] pt-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ChipSelect
              label="Model"
              icon={Sparkles}
              value={model.id}
              onChange={(v) => write({ settings: reconcileSettings(settings, modelById(v)!) })}
              options={available.map((m) => ({ value: m.id, label: m.availability === "experimental" ? `${m.name} (experimental)` : m.name }))}
            />
            {model.ratios.length > 1 ? (
              <ChipSelect label="Ratio" icon={RectangleHorizontal} value={settings.ratio} onChange={(v) => write({ settings: { ...settings, ratio: v } })} options={model.ratios.map((r) => ({ value: r, label: r }))} />
            ) : null}
            {model.qualities ? (
              <ChipSelect
                label="Quality"
                icon={Gem}
                value={settings.quality ?? model.qualities[0]}
                onChange={(v) => write({ settings: { ...settings, quality: v } })}
                options={model.qualities.map((q) => ({ value: q, label: q }))}
              />
            ) : null}
            {model.durations ? (
              <ChipSelect
                label="Length"
                icon={Timer}
                value={String(settings.duration ?? model.durations[0])}
                onChange={(v) => write({ settings: { ...settings, duration: Number(v) } })}
                options={model.durations.map((d) => ({ value: String(d), label: `${d}s` }))}
              />
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-3">
            {tool !== "edit" ? (
              <p className="text-right text-sm leading-tight">
                <span className="block font-semibold text-ink tabular">{fmtCredits(credits)}</span>
                <span className="block text-xs text-muted tabular">{fmtNum(demo.available)} available</span>
              </p>
            ) : (
              <p className="text-sm text-muted">Reference needed</p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={insufficient}
              aria-describedby="home-prompt-note"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-blue text-white shadow-[0_12px_32px_-10px_rgb(37_63_246/0.9)] transition-colors hover:bg-brand-blue-hover disabled:cursor-not-allowed disabled:bg-elevated disabled:text-subtle disabled:shadow-none"
            >
              {tool === "edit" ? <ArrowRight aria-hidden className="size-5" /> : <ArrowUp aria-hidden className="size-5" />}
              <span className="sr-only">{actionLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p id="home-prompt-error" className="mt-3 text-center text-sm text-error-on-dark">
          {error}
        </p>
      ) : null}
      {insufficient ? (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 text-center text-sm text-orange-on-dark">
          You need {fmtCredits(credits - demo.available)} more for this job.
          <Link href="/studio/credits?return=%2Fstudio" className="font-semibold text-link underline-offset-4 hover:underline">
            Top up — your draft stays here
          </Link>
        </p>
      ) : null}
      <p id="home-prompt-note" className="mt-3 flex items-start justify-center gap-1.5 px-2 text-center text-sm text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {tool === "edit"
            ? "Edits start from your own image: add it in the edit studio, then check the cost."
            : "Credits are reserved when you generate and charged only when the file is saved."}{" "}
          <Link href={TOOLS[tool].href} className="font-semibold text-link underline-offset-4 hover:underline">
            More settings in the {TOOLS[tool].studioTitle.toLowerCase()}
          </Link>
        </span>
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm font-medium text-subtle">Prompt ideas:</span>
        {TOOLS[tool].starters.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => write({ prompt: s })}
            className="inline-flex h-9 items-center rounded-full border border-white/[0.12] bg-white/[0.03] px-3.5 text-sm text-muted transition-colors hover:border-white/30 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipSelect({
  label,
  icon: Icon,
  value,
  onChange,
  options,
}: {
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.05] pl-3 transition-colors hover:bg-white/[0.08] has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-[var(--focus-ring)]">
      <Icon aria-hidden className="size-4 shrink-0 text-muted" />
      <label htmlFor={id} className="text-xs font-medium text-subtle">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-8 text-sm font-semibold text-ink focus-visible:outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23A3ABAB' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 10px center",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-raised text-ink">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
