"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clapperboard, FileText, ImagePlus, Play, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { TOOLS, TOOL_ORDER, settingsSummary } from "@/lib/catalog";
import { PHASE_LABEL, isTerminal, jobPhase, useDemo, useNow } from "@/lib/demo-store";
import { cn, fmtDate } from "@/lib/format";
import { MEDIA } from "@/lib/media";

const ICON = { image: ImagePlus, edit: WandSparkles, video: Clapperboard };

export function Overview() {
  const demo = useDemo();
  const now = useNow();
  const active = demo.jobs.filter((j) => !j.removed && !isTerminal(jobPhase(j, now)));
  const recent = demo.jobs.filter((j) => !j.removed && !j.expired && j.settled === "charged").slice(0, 4);
  const hasHistory = demo.jobs.some((j) => j.settled === "charged");
  const draft = demo.draft && demo.draft.prompt ? demo.draft : null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.75rem] font-semibold tracking-tight sm:text-[2rem]">What would you like to create?</h1>
        <p className="text-muted">Pick a tool. You&apos;ll see the exact credit cost before anything runs.</p>
      </div>

      {/* Lead with Continue draft + recent work once the creator has history (guide §08). */}
      {draft ? (
        <section aria-labelledby="draft-h" className="layer-stack rounded-[var(--radius-media)]">
          <div className="flex flex-col gap-4 rounded-[var(--radius-media)] border border-line bg-surface p-5 sm:flex-row sm:items-center">
            <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[rgb(173_219_90/0.14)] text-brand-lime">
              <FileText aria-hidden className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="draft-h" className="font-semibold text-ink">
                Continue your {TOOLS[draft.tool].label.toLowerCase()} draft
              </h2>
              <p className="truncate text-sm text-muted">“{draft.prompt}”</p>
              <p className="text-xs text-muted">{settingsSummary(draft.settings)}</p>
            </div>
            <ButtonLink href={TOOLS[draft.tool].href} icon={<ArrowRight aria-hidden className="order-last size-4" />}>
              Continue draft
            </ButtonLink>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="tools-h">
        <h2 id="tools-h" className="sr-only">
          Tools
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {TOOL_ORDER.map((t) => {
            const Icon = ICON[t];
            return (
              <li key={t}>
                <Link
                  href={TOOLS[t].href}
                  className="group flex h-full items-start gap-4 rounded-[var(--radius-media)] border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-raised"
                >
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-[12px]", t === "video" ? "bg-[rgb(118_61_255/0.18)] text-violet-on-dark" : "bg-[rgb(28_93_255/0.16)] text-link")}>
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      {t === "image" ? "Create an image" : t === "edit" ? "Edit an image" : "Create a short video"}
                      <ArrowRight aria-hidden className="size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{TOOLS[t].summary}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="active-h" className="rounded-[var(--radius-media)] border border-line bg-surface p-5 lg:col-span-1">
          <h2 id="active-h" className="font-semibold text-ink">
            Active jobs
          </h2>
          {active.length ? (
            <ul className="mt-3 divide-y divide-line">
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
            <Link href="/studio/library" className="text-sm font-semibold text-link hover:underline">
              Open library
            </Link>
          </div>
          {hasHistory ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {recent.map((j) => {
                const m = MEDIA[j.media];
                return (
                  <li key={j.id}>
                    <Link href={`/studio/library?job=${j.id}`} className="group block">
                      <div className="relative aspect-square overflow-hidden rounded-[12px] border border-line bg-raised">
                        <Image src={m.kind === "video" ? m.poster! : m.src} alt={m.alt} fill sizes="(min-width: 640px) 20vw, 45vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        {m.kind === "video" ? (
                          <span className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-[rgb(11_15_26/0.8)]">
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
            <div className="mt-3 rounded-[var(--radius-media)] border border-dashed border-line-strong p-6 text-sm text-muted">
              Your first results will appear here. Try a starter prompt in the image studio.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
