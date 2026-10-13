"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, type ComponentType, type KeyboardEvent } from "react";
import { ArrowUpRight, Clapperboard, ImagePlus, Info, Plus, RectangleHorizontal, Sparkles, Timer, WandSparkles } from "lucide-react";
import {
  TOOL_ORDER,
  TOOLS,
  defaultSettings,
  exampleById,
  modelById,
  modelsFor,
  reconcileSettings,
  type Settings,
  type ToolId,
} from "@/lib/catalog";
import { saveDraft, useDemo } from "@/lib/demo-store";
import { cn } from "@/lib/format";
import { Button } from "@/components/ui/button";

const ICONS = { image: ImagePlus, edit: WandSparkles, video: Clapperboard };
const LIMIT = 1000;

/**
 * Public creation console (lit composer from the reference direction). Guests never see a price here:
 * the draft travels to the studio, which quotes the exact cost before anything runs.
 */
export function Composer() {
  const router = useRouter();
  const { draft, signedIn, hydrated } = useDemo();
  const tabIds = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tool: ToolId = draft?.tool ?? "image";
  const prompt = draft?.prompt ?? "";
  const settings: Settings = draft?.settings ?? defaultSettings(tool);
  const model = modelById(settings.modelId) ?? modelsFor(tool)[0];
  const example = draft?.source === "example" && draft.exampleId ? exampleById(draft.exampleId) : undefined;
  const authed = hydrated && signedIn;

  const write = (patch: { tool?: ToolId; prompt?: string; settings?: Settings; keepExample?: boolean }) => {
    const nextTool = patch.tool ?? tool;
    saveDraft({
      tool: nextTool,
      prompt: patch.prompt ?? prompt,
      settings: patch.settings ?? (patch.tool && patch.tool !== tool ? defaultSettings(nextTool) : settings),
      source: patch.keepExample && draft?.source === "example" ? "example" : "composer",
      exampleId: patch.keepExample ? draft?.exampleId : undefined,
    });
  };

  const selectTool = (t: ToolId) => write({ tool: t });

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TOOL_ORDER.indexOf(tool);
    let next: ToolId | null = null;
    if (e.key === "ArrowRight") next = TOOL_ORDER[(i + 1) % TOOL_ORDER.length];
    if (e.key === "ArrowLeft") next = TOOL_ORDER[(i - 1 + TOOL_ORDER.length) % TOOL_ORDER.length];
    if (e.key === "Home") next = TOOL_ORDER[0];
    if (e.key === "End") next = TOOL_ORDER[TOOL_ORDER.length - 1];
    if (next) {
      e.preventDefault();
      selectTool(next);
      tabRefs.current[next]?.focus();
    }
  };

  const open = () => {
    write({ keepExample: true });
    const href = TOOLS[tool].href;
    router.push(authed ? href : `/sign-in?next=${encodeURIComponent(href)}`);
  };

  const requestReference = () => {
    write({ keepExample: true });
    router.push(authed ? "/studio/edit" : `/sign-in?next=${encodeURIComponent("/studio/edit")}&reason=reference`);
  };

  const available = modelsFor(tool).filter((m) => m.availability !== "maintenance");

  return (
    <div>
      <div className="flex justify-center">
        <div role="tablist" aria-label="Choose a tool" className="scroll-none flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md">
          {TOOL_ORDER.map((t) => {
            const Icon = ICONS[t];
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
                onClick={() => selectTool(t)}
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
        {example ? (
          <p className="mb-3 flex items-start gap-2 rounded-2xl bg-[rgb(37_63_246/0.16)] px-3.5 py-2.5 text-sm text-link">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>Loaded from the example “{example.title}” with its settings. Edit anything before you continue.</span>
          </p>
        ) : null}

        <div className="flex gap-3 sm:gap-4">
          {tool === "edit" ? (
            <button
              type="button"
              onClick={requestReference}
              className="group grid size-[84px] shrink-0 place-items-center rounded-2xl border border-dashed border-white/30 bg-white/[0.03] text-muted transition-colors hover:border-brand-blue-bright hover:text-ink sm:size-24"
            >
              <span className="flex flex-col items-center gap-1 px-1 text-center">
                <Plus aria-hidden className="size-6 transition-transform group-hover:scale-110" />
                <span className="text-[11px] leading-tight font-semibold">{authed ? "Add reference in studio" : "Sign in to add reference"}</span>
              </span>
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <label htmlFor="composer-prompt" className="block px-1 pt-1 text-sm font-semibold text-ink">
              {TOOLS[tool].promptLabel}
            </label>
            <textarea
              id="composer-prompt"
              value={prompt}
              maxLength={LIMIT}
              onChange={(e) => write({ prompt: e.target.value, keepExample: true })}
              placeholder={TOOLS[tool].promptPlaceholder}
              aria-describedby="composer-help composer-count"
              className="mt-1 block min-h-[104px] w-full resize-none bg-transparent px-1 py-1 text-[17px] leading-relaxed text-ink placeholder:text-subtle focus-visible:outline-none sm:min-h-[120px] sm:text-lg"
            />
          </div>
        </div>

        {tool === "edit" ? (
          <p className="mt-2 px-1 text-sm text-muted">
            <span className="font-semibold text-ink">Reference image required.</span>{" "}
            {authed ? "Upload it in the edit studio." : "Sign in to upload. Your instruction and settings stay saved."}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3 border-t border-white/[0.08] pt-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ChipSelect
              label="Model"
              icon={Sparkles}
              value={model.id}
              onChange={(v) => {
                const m = modelById(v)!;
                write({ settings: reconcileSettings(settings, m), keepExample: true });
              }}
              options={available.map((m) => ({ value: m.id, label: m.availability === "experimental" ? `${m.name} (experimental)` : m.name }))}
            />
            {model.ratios.length > 1 ? (
              <ChipSelect
                label="Ratio"
                icon={RectangleHorizontal}
                value={settings.ratio}
                onChange={(v) => write({ settings: { ...settings, ratio: v }, keepExample: true })}
                options={model.ratios.map((r) => ({ value: r, label: r }))}
              />
            ) : null}
            {model.durations ? (
              <ChipSelect
                label="Length"
                icon={Timer}
                value={String(settings.duration ?? model.durations[0])}
                onChange={(v) => write({ settings: { ...settings, duration: Number(v) }, keepExample: true })}
                options={model.durations.map((d) => ({ value: String(d), label: `${d} seconds` }))}
              />
            ) : null}
            <span id="composer-count" className="ml-1 text-xs text-subtle tabular">
              {prompt.length}/{LIMIT}
            </span>
          </div>
          <Button
            size="lg"
            onClick={open}
            className="h-12 pr-2 pl-6 shadow-[0_12px_32px_-10px_rgb(37_63_246/0.85)]"
            icon={
              <span aria-hidden className="order-last grid size-8 place-items-center rounded-full bg-white text-brand-blue">
                <ArrowUpRight className="size-4" />
              </span>
            }
          >
            {authed ? `Continue in ${TOOLS[tool].studioTitle.toLowerCase()}` : TOOLS[tool].guestAction}
          </Button>
        </div>
      </div>

      <p id="composer-help" className="mt-3 px-2 text-center text-sm text-muted">
        No credits are used here. The exact cost is shown in the studio before you generate. Your draft is saved in this browser.
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
