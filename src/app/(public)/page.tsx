import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Clapperboard, Download, ImagePlus, ListChecks, PenLine, Play, Plus, ScanEye, WandSparkles } from "lucide-react";
import { Hero } from "@/components/public/hero";
import { Composer } from "@/components/public/composer";
import { StoryTabs } from "@/components/public/story-tabs";
import { StarterButton, UsePromptButton } from "@/components/public/prompt-buttons";
import { CompareSlider } from "@/components/compare-slider";
import { MotionRegion } from "@/components/motion-region";
import { AutoplayVideo } from "@/components/ui/autoplay-video";
import { HoverVideo } from "@/components/ui/hover-video";
import { Badge, ConceptTag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EXAMPLES, MODELS, TOOLS, TOOL_ORDER, modelById, type Example, type ToolId } from "@/lib/catalog";
import { MEDIA, stillOf, type MediaKey } from "@/lib/media";
import { PACKS } from "@/lib/packs";
import { cn } from "@/lib/format";

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const wrap = "mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10";

function meta(e: Example) {
  const m = modelById(e.settings.modelId);
  const parts = [TOOLS[e.tool].label, m?.name, e.settings.ratio !== "Original" ? e.settings.ratio : undefined, e.settings.duration ? `${e.settings.duration}s` : undefined];
  return parts.filter(Boolean).join(" · ");
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" />
      {children}
    </p>
  );
}

const h2 = "font-display mt-4 text-[1.875rem] leading-[1.05] font-extrabold text-balance text-ink sm:text-[2.5rem] lg:text-[3rem]";

function SectionHead({ eyebrow, title, intro, id, action, center }: { eyebrow: string; title: ReactNode; intro?: string; id: string; action?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-5", center ? "items-center text-center" : "md:flex-row md:items-end md:justify-between")}>
      <div className={cn("max-w-3xl", center && "flex flex-col items-center")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className={h2}>
          {title}
        </h2>
        {intro ? <p className="mt-4 max-w-2xl text-base text-pretty text-muted sm:text-lg">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Static half-and-half preview of an edit (the interactive slider lives further down the page). */
function SplitPreview({ before, after, sizes }: { before: MediaKey; after: MediaKey; sizes: string }) {
  return (
    <>
      <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
        <Image src={stillOf(before)} alt={`Original: ${MEDIA[before].alt}`} fill sizes={sizes} className="object-cover object-left" />
      </div>
      <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
        <Image src={stillOf(after)} alt={`Edited: ${MEDIA[after].alt}`} fill sizes={sizes} className="object-cover object-right" />
      </div>
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white" />
      <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-[rgb(15_18_18/0.78)] px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur-md">Original</span>
      <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[rgb(15_18_18/0.78)] px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur-md">Edited</span>
    </>
  );
}

/**
 * Example card: fixed media frame, text below (guide §07). The "Use prompt" action appears on
 * hover/focus for pointer devices and is always visible on touch screens.
 */
function ExampleCard({
  e,
  className,
  frame,
  sizes,
  level = "h3",
}: {
  e: Example;
  className?: string;
  frame: string;
  sizes: string;
  level?: "h3" | "h4";
}) {
  const m = MEDIA[e.media];
  const Title = level;
  return (
    <article data-hover-play className={cn("group flex min-w-0 flex-col", className)}>
      <div className={cn("relative overflow-hidden rounded-[var(--radius-media)] border border-white/[0.08] bg-raised", frame)}>
        {e.reference ? (
          <SplitPreview before={e.reference} after={e.media} sizes={sizes} />
        ) : m.kind === "video" ? (
          <HoverVideo media={e.media} label={e.title} className="absolute inset-0" controlClassName="right-3 bottom-3 sm:top-3 sm:bottom-auto" />
        ) : (
          <Image src={m.src} alt={m.alt} fill sizes={sizes} className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
        )}
        {m.placeholder ? <ConceptTag className="pointer-events-none absolute top-3 left-3" /> : null}
        <UsePromptButton
          exampleId={e.id}
          look="glass"
          label="Use prompt"
          context={e.title}
          className={cn(
            "absolute right-3 z-10 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:hidden [@media(hover:none)]:opacity-100",
            e.reference ? "top-3" : "bottom-3",
          )}
        />
      </div>
      <div className="mt-3 flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <Title className="line-clamp-2 text-[15px] font-semibold text-ink sm:truncate">{e.title}</Title>
          <p className="truncate text-[13px] text-muted">{meta(e)}</p>
        </div>
        {/* Narrow phones: the action sits beside the caption instead of over the media. */}
        <UsePromptButton exampleId={e.id} look="icon" label="Use prompt" context={e.title} className="sm:hidden" />
      </div>
    </article>
  );
}

const TOOL_ICON: Record<ToolId, typeof ImagePlus> = { image: ImagePlus, edit: WandSparkles, video: Clapperboard };

export default function HomePage() {
  const featured = ex("ex-torus");
  const edit = ex("ex-edit-dusk");
  const loop = ex("ex-loop");
  const clip = ex("ex-aurora-clip");

  /* Bento order is chosen so grid-flow-dense leaves no holes at 2 and 4 columns. */
  const one = "(min-width: 1024px) 23vw, 50vw";
  const wide = "(min-width: 1024px) 46vw, 50vw";
  const gallery: { e: Example; cell: string; frame: string; sizes: string }[] = [
    { e: ex("ex-torus"), cell: "lg:row-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: one },
    { e: ex("ex-orbs"), cell: "col-span-2", frame: "aspect-[16/9]", sizes: "(min-width: 1024px) 46vw, 100vw" },
    { e: ex("ex-pills"), cell: "lg:row-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: one },
    { e: loop, cell: "lg:col-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: wide },
    { e: ex("ex-product"), cell: "", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: one },
    { e: ex("ex-dunes"), cell: "lg:col-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: wide },
    { e: ex("ex-aurora-still"), cell: "lg:row-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: one },
    { e: edit, cell: "lg:col-span-2", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: "(min-width: 1024px) 23vw, 25vw" },
    { e: ex("ex-spheres"), cell: "", frame: "aspect-[4/5] md:aspect-[4/3]", sizes: one },
  ];

  return (
    <>
      {/* 1 · Creation stage: headline hero + lit composer */}
      <Hero />

      <section id="create" aria-labelledby="create-title" className="relative isolate scroll-mt-24 overflow-hidden pt-14 pb-16 lg:pt-20 lg:pb-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="dot-field absolute inset-0" />
          <div className="glow-electric absolute top-[12%] left-1/2 h-[460px] w-[min(1100px,100%)] -translate-x-1/2" />
        </div>
        <div className={wrap}>
          <div className="mx-auto max-w-[880px]">
            <div className="flex flex-col items-center text-center">
              <Eyebrow>Start here</Eyebrow>
              <h2 id="create-title" className={h2}>
                What will you <span className="text-brand-blue-bright">make</span> today?
              </h2>
              <p className="mt-3 max-w-xl text-base text-muted sm:text-lg">Pick a tool, describe it, and take your draft straight into the studio.</p>
            </div>
            <div className="mt-8">
              <Composer />
            </div>
          </div>

          {/* Media rail: featured output, edit comparison, video example (guide §07) */}
          <div className="mx-auto mt-16 max-w-[1180px]">
            <div className="mb-4 flex items-end justify-between gap-4">
              <h3 className="text-lg font-semibold text-ink">Curated examples</h3>
              <Link href="#examples" className="text-sm font-semibold text-link underline-offset-4 hover:underline">
                See more examples
              </Link>
            </div>
            <div className="grid gap-x-4 gap-y-6 sm:grid-cols-3">
              <ExampleCard e={featured} level="h4" frame="aspect-[4/3]" sizes="(min-width: 640px) 33vw, 100vw" />
              <ExampleCard e={edit} level="h4" frame="aspect-[4/3]" sizes="(min-width: 640px) 17vw, 50vw" className="hidden sm:flex" />
              <ExampleCard e={loop} level="h4" frame="aspect-[4/3]" sizes="(min-width: 640px) 33vw, 100vw" className="hidden sm:flex" />
            </div>
          </div>
        </div>
      </section>

      {/* 2 · Featured gallery */}
      <section id="examples" aria-labelledby="examples-title" className="scroll-mt-24 border-t border-white/[0.06] py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="examples-title"
            eyebrow="Featured examples"
            title={
              <>
                Start from work that already <span className="text-brand-blue-bright">looks right.</span>
              </>
            }
            intro="Every example keeps the prompt idea and settings behind it, so “Use prompt” loads the whole recipe into your draft."
            action={
              <ButtonLink href="/studio/image" variant="secondary" icon={<ArrowUpRight aria-hidden className="order-last size-4" />}>
                Open the image studio
              </ButtonLink>
            }
          />
          <div className="mt-10 grid grid-flow-dense grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 lg:grid-cols-4 lg:auto-rows-[300px]">
            {gallery.map(({ e, cell, frame, sizes }) => (
              <ExampleCard
                key={e.id}
                e={e}
                className={cn(cell, "lg:[&>div:first-child]:min-h-0 lg:[&>div:first-child]:flex-1")}
                frame={cn(frame, "lg:aspect-auto")}
                sizes={sizes}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 3 · Prompt-to-result story */}
      <section aria-labelledby="story-title" className="border-t border-white/[0.06] bg-surface/50 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="story-title"
            eyebrow="Prompt to result"
            title="See the input, the output and the exact settings."
            intro="Nothing hidden between the words you write and the file you download."
          />
          <div className="mt-10">
            <StoryTabs />
          </div>
        </div>
      </section>

      {/* 4 · Use cases */}
      <section aria-labelledby="usecases-title" className="border-t border-white/[0.06] py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead id="usecases-title" eyebrow="Use cases" title="Made for the formats you publish." />
          <div
            role="region"
            aria-label="Use cases"
            tabIndex={0}
            className="scroll-thin relative -mx-4 mt-10 snap-x snap-mandatory overflow-x-auto px-4 pb-3 md:mx-0 md:overflow-visible md:px-0 md:pb-0"
          >
          <ul className="flex gap-4 md:grid md:grid-cols-3">
            {USE_CASES.map((u) => (
              <li key={u.title} className="w-[80vw] max-w-sm shrink-0 snap-start md:w-auto md:max-w-none">
                <article className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-surface">
                  <div className="relative aspect-[4/5] overflow-hidden">
                    <Image src={stillOf(u.media)} alt={MEDIA[u.media].alt} fill sizes="(min-width: 768px) 30vw, 80vw" className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
                    <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-surface to-transparent" />
                    <ConceptTag className="absolute top-4 left-4" />
                  </div>
                  <div className="-mt-6 flex flex-1 flex-col px-6 pb-6">
                    <h3 className="font-display relative text-[1.375rem] leading-tight font-bold text-ink">{u.title}</h3>
                    <p className="mt-2 flex-1 text-[15px] text-muted">{u.body}</p>
                    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Typical formats">
                      {u.tags.map((t) => (
                        <li key={t} className="rounded-full border border-white/[0.12] px-2.5 py-0.5 text-xs font-medium text-muted">
                          {t}
                        </li>
                      ))}
                    </ul>
                    <StarterButton tool={u.tool} prompt={u.starter} settings={u.settings} label="Start with this idea" className="mt-6 self-start" />
                  </div>
                </article>
              </li>
            ))}
          </ul>
          </div>
        </div>
      </section>

      {/* 5 · Before/after and motion */}
      <section id="before-after" aria-labelledby="ba-title" className="scroll-mt-24 border-t border-white/[0.06] bg-surface/50 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="ba-title"
            eyebrow="Edit and motion"
            title={
              <>
                Change what you have. <span className="text-brand-blue-bright">Set it in motion.</span>
              </>
            }
            intro="Edits keep your original as its own version. Clips start on a poster and only play when you press play."
          />
          <div className="mt-10 grid gap-8 lg:grid-cols-12">
            <figure className="lg:col-span-7">
              <CompareSlider
                before={MEDIA.dunesNoon.src}
                after={MEDIA.dunesDusk.src}
                beforeAlt={`Original: ${MEDIA.dunesNoon.alt}`}
                afterAlt={`Edited: ${MEDIA.dunesDusk.alt}`}
              />
              <figcaption className="mt-3 text-sm text-muted">
                Instruction: “{edit.prompt}” · {meta(edit)}
              </figcaption>
            </figure>
            <figure className="lg:col-span-5">
              <div className="relative overflow-hidden rounded-[var(--radius-media)] border border-white/[0.08] bg-black">
                <video controls playsInline preload="none" poster={MEDIA.auroraClip.poster} className="block aspect-video w-full" aria-label={MEDIA.auroraClip.alt}>
                  <source src={MEDIA.auroraClip.src} type="video/mp4" />
                </video>
                <ConceptTag className="pointer-events-none absolute top-3 left-3" />
              </div>
              <figcaption className="mt-3 text-sm text-muted">
                “{clip.prompt}” · {meta(clip)} · no audio
              </figcaption>
              <div className="mt-4">
                <UsePromptButton exampleId={clip.id} context={clip.title} />
              </div>
            </figure>
          </div>
        </div>
      </section>

      {/* 6 · Four steps */}
      <section id="how" aria-labelledby="steps-title" className="border-t border-white/[0.06] py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead id="steps-title" eyebrow="How it works" title="Four steps, and you approve the cost first." />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-white/[0.08] bg-surface p-6">
                <div className="flex items-start justify-between">
                  <span aria-hidden className="font-display text-[3.75rem] leading-none font-extrabold text-transparent tabular [-webkit-text-stroke:1.5px_rgb(255_255_255/0.3)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={cn("grid size-11 place-items-center rounded-full", i === 3 ? "bg-brand-blue text-white" : "bg-white/[0.07] text-ink")}>
                    <s.icon aria-hidden className="size-5" />
                  </span>
                </div>
                <h3 className="mt-8 text-lg font-semibold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-1.5 text-[15px] text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Electric band */}
      <section aria-labelledby="band-title" className="py-4 lg:py-8">
        <div className={wrap}>
          <div className="relative isolate overflow-hidden rounded-[32px] bg-brand-blue px-6 py-12 sm:px-10 sm:py-14 lg:px-16 lg:py-20">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <div className="absolute -top-1/2 -right-1/4 h-[160%] w-[70%] rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.22),transparent)]" />
              <div className="absolute right-0 bottom-0 hidden h-full w-[42%] md:block">
                <Image src={MEDIA.pills.src} alt="" fill sizes="40vw" className="object-cover object-[50%_60%] mix-blend-luminosity opacity-40 [mask-image:linear-gradient(to_left,#000_30%,transparent)]" />
              </div>
            </div>
            <div className="max-w-2xl">
              <h2 id="band-title" className="font-display text-[2rem] leading-[1.02] font-extrabold text-balance text-white sm:text-5xl lg:text-[3.5rem]">
                Your next post starts with one sentence.
              </h2>
              <p className="mt-5 max-w-xl text-lg text-white/90">Write it, check the exact cost, and keep the original file with its prompt and settings.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/#create" size="lg" variant="inverse" icon={<ArrowUpRight aria-hidden className="order-last size-5" />}>
                  Start creating
                </ButtonLink>
                <ButtonLink href="/#pricing" size="lg" variant="outline-on-color">
                  See pricing
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7 · Tools and model cards */}
      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-24 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="tools-title"
            eyebrow="Creative suite"
            title="Three tools. Models described by what they are good at."
            intro="Catalog preview: model names, limits and availability come from the verified catalog at launch."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {TOOL_ORDER.map((t) => (
              <ToolCard key={t} tool={t} />
            ))}
          </div>
        </div>
      </section>

      {/* 8 · Price preview */}
      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24 border-t border-white/[0.06] bg-surface/50 py-16 lg:py-24" data-reveal>
        <div className={cn(wrap, "grid gap-10 lg:grid-cols-12 lg:gap-12")}>
          <div className="lg:col-span-5">
            <Eyebrow>Pricing</Eyebrow>
            <h2 id="pricing-title" className={h2}>
              Pay with credits. <span className="text-brand-blue-bright">See the cost first.</span>
            </h2>
            <ol className="mt-8 space-y-5">
              {[
                { k: "Quote", v: "The studio shows the exact credit cost for your settings." },
                { k: "Reserve", v: "When you press Generate, those credits are reserved — not spent yet." },
                { k: "Settle", v: "Saved result: credits are charged. Failed job: reserved credits come back." },
              ].map((s, i) => (
                <li key={s.k} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/20 text-sm font-semibold text-ink tabular">{i + 1}</span>
                  <p className="pt-1 text-[15px] text-muted">
                    <strong className="font-semibold text-ink">{s.k}.</strong> {s.v}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink">Credit packs</h3>
              <Badge tone="attention">Sample values — not approved pricing</Badge>
            </div>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {PACKS.map((p, i) => (
                <li
                  key={p.id}
                  className={cn(
                    "relative flex flex-col overflow-hidden rounded-[24px] border p-6",
                    i === 1 ? "border-brand-blue bg-[radial-gradient(120%_80%_at_50%_0%,rgb(37_63_246/0.35),transparent_70%)] bg-raised" : "border-white/[0.08] bg-raised",
                  )}
                >
                  <p className="text-sm font-semibold text-muted">{p.name}</p>
                  <p className="font-display mt-3 text-[2.5rem] leading-none font-extrabold text-ink tabular">{p.credits.toLocaleString("en-US")}</p>
                  <p className="mt-1 text-sm text-muted">credits</p>
                  <p className="mt-6 text-xl font-semibold text-ink tabular">{p.priceLabel}</p>
                  <p className="mt-1 text-xs text-muted">One-time purchase · expiry follows the approved policy</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">
              Final packs, currencies, taxes and expiry rules publish from the approved price version. Prices shown here are placeholders for layout review.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/studio/credits">View credit options</ButtonLink>
              <ButtonLink href="/help#credits" variant="secondary">
                How credits work
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* 9 · Partner invitation */}
      <section id="partners" aria-labelledby="partners-title" className="scroll-mt-24 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <div className="grid overflow-hidden rounded-[32px] border border-white/[0.08] bg-surface lg:grid-cols-12">
            <div className="relative isolate p-6 sm:p-10 lg:col-span-6 lg:p-14">
              <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(37_63_246/0.3),transparent)]" />
              <Eyebrow>Partner program</Eyebrow>
              <h2 id="partners-title" className="font-display mt-4 text-[1.75rem] leading-[1.08] font-extrabold text-balance text-ink sm:text-[2.25rem] lg:text-[2.5rem]">
                Share Genlixs with your audience. <span className="text-brand-blue-bright">Earn on eligible paid referrals.</span>
              </h2>
              <p className="mt-5 text-[17px] text-muted">
                For creators and educators who already make things with AI. Commission rates, holding periods and payout thresholds are set in the published
                program agreement — you see them before you apply.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/partners/apply">Apply to the program</ButtonLink>
                <ButtonLink href="/partner" variant="secondary">
                  Preview the partner portal
                </ButtonLink>
              </div>
            </div>
            <ul className="grid gap-px border-t border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 lg:col-span-6 lg:border-t-0 lg:border-l">
              {[
                { t: "One link to share", b: "Copy your main link or create a campaign link for each platform." },
                { t: "Clear eligibility", b: "Each referral shows when it became eligible and why." },
                { t: "Separate balances", b: "Pending, available, reserved and paid are never mixed into one number." },
                { t: "Payout readiness", b: "See exactly which condition is still open before you can request a payout." },
              ].map((f, i) => (
                <li key={f.t} className="bg-surface p-6 sm:p-8">
                  <span className={cn("block h-1 w-10 rounded-full", i % 2 ? "bg-brand-lime" : "bg-brand-blue")} aria-hidden />
                  <h3 className="mt-5 text-lg font-semibold text-ink">{f.t}</h3>
                  <p className="mt-1.5 text-[15px] text-muted">{f.b}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 10 · FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 border-t border-white/[0.06] py-16 lg:py-24" data-reveal>
        <div className={cn(wrap, "grid gap-10 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <Eyebrow>FAQ</Eyebrow>
            <h2 id="faq-title" className={h2}>
              Questions before you create
            </h2>
            <p className="mt-4 text-muted">
              More answers in the{" "}
              <Link href="/help" className="font-semibold text-link underline-offset-4 hover:underline">
                help centre
              </Link>
              .
            </p>
          </div>
          <div className="space-y-3 lg:col-span-8">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-[20px] border border-white/[0.08] bg-surface transition-colors open:border-white/[0.16] open:bg-raised">
                <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-[20px] px-5 py-4 text-left text-[17px] font-semibold text-ink sm:px-6">
                  {f.q}
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-ink transition-transform group-open:rotate-45 group-open:border-brand-blue group-open:bg-brand-blue group-open:text-white">
                    <Plus aria-hidden className="size-4" />
                  </span>
                </summary>
                <div className="px-5 pb-6 text-[15px] leading-relaxed text-muted sm:px-6">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing band */}
      <section aria-labelledby="closing-title" className="pb-20 lg:pb-28">
        <div className={wrap}>
          <MotionRegion className="isolate overflow-hidden rounded-[32px] border border-white/10" label="closing background loop" controlClassName="right-4 bottom-4">
            <div aria-hidden className="absolute inset-0 -z-10">
              <AutoplayVideo media="loop" decorative className="absolute inset-0" />
              <div className="absolute inset-0 bg-[rgb(15_18_18/0.72)]" />
              <div className="absolute inset-0 bg-[radial-gradient(70%_80%_at_50%_100%,rgb(37_63_246/0.35),transparent)]" />
            </div>
            <ConceptTag className="absolute top-4 left-4" />
            <div className="flex flex-col items-center px-6 py-20 text-center sm:py-24 lg:py-32">
              <h2 id="closing-title" className="font-display max-w-3xl text-[2.5rem] leading-[1] font-extrabold text-balance text-white sm:text-6xl lg:text-7xl">
                Start with a <span className="rounded-2xl bg-brand-blue px-3 text-white [box-decoration-break:clone] sm:rounded-3xl">sentence.</span>
              </h2>
              <p className="mt-5 max-w-xl text-lg text-white/90">Image, edit or short video — your draft waits for you in the studio, with the cost shown before anything runs.</p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <ButtonLink href="/#create" size="xl" icon={<ArrowUpRight aria-hidden className="order-last size-5" />}>
                  Start creating
                </ButtonLink>
                <ButtonLink href="/studio" size="xl" variant="secondary">
                  Open the studio
                </ButtonLink>
              </div>
            </div>
          </MotionRegion>
        </div>
      </section>
    </>
  );
}

function ToolCard({ tool }: { tool: ToolId }) {
  const Icon = TOOL_ICON[tool];
  return (
    <article className="flex flex-col overflow-hidden rounded-[28px] border border-white/[0.08] bg-surface">
      <div className="relative aspect-[16/10] overflow-hidden bg-raised">
        {tool === "edit" ? (
          <SplitPreview before="dunesNoon" after="dunesDusk" sizes="(min-width: 1024px) 15vw, 50vw" />
        ) : (
          <Image
            src={stillOf(tool === "image" ? "orbs" : "loop")}
            alt={tool === "image" ? MEDIA.orbs.alt : MEDIA.loop.alt}
            fill
            sizes="(min-width: 1024px) 30vw, 100vw"
            className="object-cover"
          />
        )}
        {tool === "video" ? (
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-[rgb(15_18_18/0.6)] text-white ring-1 ring-white/30 backdrop-blur-md">
              <Play className="ml-0.5 size-5" />
            </span>
          </span>
        ) : null}
        <ConceptTag className="pointer-events-none absolute top-3 left-3" />
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-11 place-items-center rounded-full", tool === "image" ? "bg-brand-blue text-white" : tool === "edit" ? "bg-white text-brand-night" : "bg-brand-lime text-brand-night")}>
            <Icon aria-hidden className="size-5" />
          </span>
          <div>
            <h3 className="font-display text-[1.375rem] leading-tight font-bold text-ink">{TOOLS[tool].label}</h3>
            <p className="text-sm text-muted">{TOOLS[tool].summary}</p>
          </div>
        </div>
        <ul className="mt-6 flex-1 divide-y divide-white/[0.06] border-y border-white/[0.06]">
          {MODELS.filter((m) => m.tool === tool).map((m) => (
            <li key={m.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">{m.name}</p>
                {m.availability === "available" ? (
                  <Badge tone="success">Available</Badge>
                ) : m.availability === "experimental" ? (
                  <Badge tone="violet">Experimental</Badge>
                ) : (
                  <Badge tone="warning">Maintenance</Badge>
                )}
              </div>
              <p className="mt-1.5 text-sm text-muted">{m.purpose}</p>
              <p className="mt-2 text-xs text-subtle">
                {[m.ratios.join(" / "), m.durations ? m.durations.map((d) => `${d}s`).join(" / ") : null, m.resolutions?.join(" / "), m.audio ? "optional audio" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        <Link href={TOOLS[tool].href} className="mt-5 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-link underline-offset-4 hover:underline">
          Open {TOOLS[tool].studioTitle.toLowerCase()} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}

const USE_CASES = [
  {
    title: "Social posts and stories",
    body: "Vertical and square frames sized for feeds and stories, with a short clip when a still is not enough.",
    media: "pills" as const,
    tool: "image" as const,
    starter: "Vertical story background, three glossy capsules on a dark floor, space for a headline at the top",
    settings: { ratio: "9:16" },
    tags: ["9:16", "1:1", "Short video"],
  },
  {
    title: "Product imagery",
    body: "Clean studio scenes for product listings and launches. Use edit to change a background on your own photo.",
    media: "product" as const,
    tool: "image" as const,
    starter: "Product on a cream pedestal, soft warm studio light, plain backdrop, square crop",
    settings: { modelId: "img-detail", ratio: "1:1" },
    tags: ["1:1", "4:5", "High detail"],
  },
  {
    title: "Creative concepts",
    body: "Explore moods, palettes and compositions quickly before committing to a direction.",
    media: "torus" as const,
    tool: "image" as const,
    starter: "Abstract still life, glossy torus and sphere on a dark floor, electric-blue glow, calm palette",
    settings: { ratio: "3:2" },
    tags: ["3:2", "16:9", "Variations"],
  },
];

const STEPS = [
  { icon: ListChecks, title: "Choose", body: "Pick image, edit or video, then a model that fits the job." },
  { icon: PenLine, title: "Describe", body: "Write what you want. Add a reference when you are editing." },
  { icon: ScanEye, title: "Review", body: "Check the settings and the exact credit cost before anything runs." },
  { icon: Download, title: "Generate and download", body: "Results save to your library with their prompt and settings." },
];

const FAQ = [
  {
    q: "How much does a generation cost?",
    a: "Each job has a credit cost that depends on the tool, model and settings such as quality, length or resolution. The studio shows the exact cost next to the Generate button, and changing a cost-related setting refreshes it.",
  },
  {
    q: "What if a job takes longer than usual?",
    a: "Jobs keep running if you leave the page and stay in your library. If a job is slower than usual we say so and show what you can do. We never ask you to resubmit while we are still checking whether a request was accepted.",
  },
  {
    q: "What happens to my credits if a job fails?",
    a: "Credits are reserved when you press Generate and only charged when the result is saved. If the job fails or is cancelled before submission, the reserved credits are returned to your available balance and the job shows that they were returned.",
  },
  {
    q: "Who can see what I create?",
    a: "Your uploads and results are private to your account by default. A public link is only created after you confirm it in the share dialog, and you can revoke it at any time.",
  },
  {
    q: "Can I use the results commercially?",
    a: "Usage rights depend on the Terms of Service and the terms of the model used for each job. Read the Terms before publishing work commercially; this preview does not grant any rights.",
  },
];
