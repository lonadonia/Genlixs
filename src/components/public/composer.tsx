"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, type KeyboardEvent } from "react";
import { ArrowRight, Clapperboard, ImagePlus, Info, Upload, WandSparkles } from "lucide-react";
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
    <div className="layer-stack rounded-[22px]">
      <div className="rounded-[22px] border border-line bg-surface p-3 sm:p-4">
        <div role="tablist" aria-label="Choose a tool" className="flex gap-1.5 overflow-x-auto pb-1">
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
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-3.5 text-sm font-semibold transition-colors",
                  selected ? "bg-brand-blue text-white" : "bg-raised text-muted hover:text-ink",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {TOOLS[t].label}
              </button>
            );
          })}
        </div>

        <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-tab-${tool}`} className="mt-3">
          {example ? (
            <p className="mb-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-[rgb(28_93_255/0.12)] px-3 py-2 text-sm text-link">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Loaded from the example “{example.title}” with its settings. Edit anything before you continue.
              </span>
            </p>
          ) : null}

          <label htmlFor="composer-prompt" className="mb-1.5 block px-1 text-sm font-medium text-muted">
            {TOOLS[tool].promptLabel}
          </label>
          <textarea
            id="composer-prompt"
            value={prompt}
            maxLength={LIMIT}
            onChange={(e) => write({ prompt: e.target.value, keepExample: true })}
            placeholder={TOOLS[tool].promptPlaceholder}
            aria-describedby="composer-help composer-count"
            className="block min-h-[112px] w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-raised px-3.5 py-3 text-base leading-relaxed text-ink placeholder:text-[#8794ab] focus:border-link sm:min-h-[132px]"
          />
          <div className="mt-1 flex justify-between px-1 text-xs text-muted">
            <span id="composer-help">Your draft is saved in this browser.</span>
            <span id="composer-count" className="tabular">
              {prompt.length}/{LIMIT}
            </span>
          </div>

          {tool === "edit" ? (
            <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-canvas/40 p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-raised text-link">
                  <Upload aria-hidden className="size-5" />
                </span>
                <div className="text-sm">
                  <p className="font-semibold text-ink">Reference image required</p>
                  <p className="text-muted">
                    {authed ? "Upload it in the edit studio." : "Sign in to upload. Your instruction and settings stay saved."}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={requestReference} className="sm:shrink-0">
                {authed ? "Add reference in studio" : "Sign in to add reference"}
              </Button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex flex-1 flex-wrap gap-2">
              <SelectField
                label="Model"
                value={model.id}
                onChange={(v) => {
                  const m = modelById(v)!;
                  write({ settings: reconcileSettings(settings, m), keepExample: true });
                }}
                options={available.map((m) => ({ value: m.id, label: m.availability === "experimental" ? `${m.name} (experimental)` : m.name }))}
              />
              {model.ratios.length > 1 ? (
                <SelectField
                  label="Ratio"
                  value={settings.ratio}
                  onChange={(v) => write({ settings: { ...settings, ratio: v }, keepExample: true })}
                  options={model.ratios.map((r) => ({ value: r, label: r }))}
                />
              ) : null}
              {model.durations ? (
                <SelectField
                  label="Length"
                  value={String(settings.duration ?? model.durations[0])}
                  onChange={(v) => write({ settings: { ...settings, duration: Number(v) }, keepExample: true })}
                  options={model.durations.map((d) => ({ value: String(d), label: `${d} seconds` }))}
                />
              ) : null}
            </div>
            <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
              <Button size="lg" onClick={open} icon={<ArrowRight aria-hidden className="order-last size-4" />}>
                {authed ? `Continue in ${TOOLS[tool].studioTitle.toLowerCase()}` : TOOLS[tool].guestAction}
              </Button>
            </div>
          </div>
          <p className="mt-2 px-1 text-xs text-muted lg:text-right">
            No credits are used here. The exact cost is shown in the studio before you generate.
          </p>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-raised pl-3 focus-within:border-link">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 cursor-pointer appearance-none bg-transparent pr-8 text-sm font-medium text-ink focus-visible:outline-offset-4"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23AAB6C8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")",
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
