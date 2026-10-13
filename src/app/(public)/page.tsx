import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown, Clapperboard, Download, ImagePlus, ListChecks, PenLine, Play, ScanEye, WandSparkles } from "lucide-react";
import { Composer } from "@/components/public/composer";
import { StoryTabs } from "@/components/public/story-tabs";
import { StarterButton, UsePromptButton } from "@/components/public/prompt-buttons";
import { CompareSlider } from "@/components/compare-slider";
import { MediaFrame } from "@/components/ui/media-frame";
import { Badge, ConceptTag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EXAMPLES, MODELS, TOOLS, TOOL_ORDER, modelById, type Example } from "@/lib/catalog";
import { MEDIA } from "@/lib/media";
import { PACKS } from "@/lib/packs";
import { cn } from "@/lib/format";

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!;

function meta(e: Example) {
  const m = modelById(e.settings.modelId);
  const parts = [TOOLS[e.tool].label, m?.name, e.settings.ratio !== "Original" ? e.settings.ratio : undefined, e.settings.duration ? `${e.settings.duration}s` : undefined];
  return parts.filter(Boolean).join(" · ");
}

function SectionHead({ eyebrow, title, intro, id, action }: { eyebrow?: string; title: string; intro?: string; id: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-sm font-semibold text-brand-lime">{eyebrow}</p> : null}
        <h2 id={id} className="mt-2 text-[1.625rem] leading-[1.15] font-semibold tracking-tight text-balance text-ink sm:text-3xl lg:text-[2.25rem]">
          {title}
        </h2>
        {intro ? <p className="mt-3 max-w-2xl text-base text-pretty text-muted sm:text-[17px]">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

const wrap = "mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-10";

export default function HomePage() {
  const spheres = ex("ex-spheres");
  const edit = ex("ex-edit-dusk");
  const clip = ex("ex-aurora-clip");
  const gallery = { big: ex("ex-dunes"), tall: ex("ex-aurora-still"), a: ex("ex-product"), b: ex("ex-dunes-noon") };

  return (
    <>
      {/* 2 · Creation stage */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden">
        <div className={cn(wrap, "relative pt-10 pb-12 sm:pt-14 lg:pt-16 lg:pb-16")}>
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">
              <span className="size-1.5 rounded-full bg-brand-lime" aria-hidden />
              Image · Edit · Short video
            </p>
            <h1 id="hero-title" className="mt-5 text-[2rem] leading-[1.08] font-bold tracking-tight text-balance text-ink sm:text-[2.75rem] lg:text-[3.5rem]">
              Turn your ideas into images and videos.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted sm:text-lg">
              Create images, edit a reference, or generate a short video in one workspace.
            </p>
          </div>

          <div id="create" className="relative mx-auto mt-8 max-w-[880px] scroll-mt-28">
            <div aria-hidden className="creation-glow pointer-events-none absolute -inset-10 -z-10" />
            <Composer />
          </div>

          {/* Supporting media rail: featured output, edit comparison, video example */}
          <div className="mx-auto mt-12 max-w-[1120px]">
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-ink">Curated examples</p>
              <Link href="#examples" className="text-sm font-semibold text-link hover:underline">
                See more examples
              </Link>
            </div>
            <ul className="grid gap-4 sm:grid-cols-3">
              <li className="group">
                <MediaFrame media={spheres.media} ratio="16:9" sizes="(min-width: 640px) 33vw, 100vw" />
                <div className="mt-3 flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">{spheres.title}</p>
                    <p className="truncate text-[13px] text-muted">{meta(spheres)}</p>
                  </div>
                  <UsePromptButton exampleId={spheres.id} look="link" label="Use prompt" context={spheres.title} />
                </div>
              </li>
              <li className="hidden sm:block">
                <div className="relative aspect-video overflow-hidden rounded-[var(--radius-media)] border border-line">
                  <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                    <Image src={MEDIA.dunesNoon.src} alt={`Original: ${MEDIA.dunesNoon.alt}`} fill sizes="33vw" className="object-cover object-left" />
                  </div>
                  <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
                    <Image src={MEDIA.dunesDusk.src} alt={`Edited: ${MEDIA.dunesDusk.alt}`} fill sizes="33vw" className="object-cover object-right" />
                  </div>
                  <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90" />
                  <ConceptTag className="absolute top-3 left-3" />
                  <span className="absolute bottom-3 left-3 rounded-full bg-[rgb(11_15_26/0.78)] px-2 py-0.5 text-[11px] font-semibold">Original</span>
                  <span className="absolute right-3 bottom-3 rounded-full bg-[rgb(11_15_26/0.78)] px-2 py-0.5 text-[11px] font-semibold">Edited</span>
                </div>
                <div className="mt-3 flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">{edit.title}</p>
                    <p className="truncate text-[13px] text-muted">{meta(edit)}</p>
                  </div>
                  <UsePromptButton exampleId={edit.id} look="link" label="Use prompt" context={edit.title} />
                </div>
              </li>
              <li className="hidden sm:block">
                <Link href="#before-after" className="group relative block" aria-label={`${clip.title}: go to the playable clip`}>
                  <MediaFrame media={clip.media} ratio="16:9" sizes="33vw">
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid size-12 place-items-center rounded-full bg-[rgb(11_15_26/0.72)] text-white ring-1 ring-white/40 backdrop-blur-sm transition-transform group-hover:scale-105">
                        <Play aria-hidden className="ml-0.5 size-5" />
                      </span>
                    </span>
                    <span className="absolute right-3 bottom-3 rounded-full bg-[rgb(11_15_26/0.78)] px-2 py-0.5 text-[11px] font-semibold tabular">0:06</span>
                  </MediaFrame>
                </Link>
                <div className="mt-3 flex flex-col lg:flex-row lg:items-start lg:justify-between lg:gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">{clip.title}</p>
                    <p className="truncate text-[13px] text-muted">{meta(clip)}</p>
                  </div>
                  <UsePromptButton exampleId={clip.id} look="link" label="Use prompt" context={clip.title} />
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 3 · Featured gallery */}
      <section id="examples" aria-labelledby="examples-title" className="scroll-mt-20 border-t border-line py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="examples-title"
            eyebrow="Featured examples"
            title="Start from work that already looks right."
            intro="Every example keeps the exact prompt and settings behind it, so “Use this prompt” brings the whole recipe into your draft."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-12">
            <div className="grid gap-4 lg:col-span-7">
              <GalleryCard e={gallery.big} ratio="3:2" sizes="(min-width: 1024px) 55vw, 100vw" featured />
              <div className="grid gap-4 sm:grid-cols-2">
                <GalleryCard e={gallery.a} ratio="1:1" sizes="(min-width: 1024px) 27vw, (min-width: 640px) 50vw, 100vw" />
                <GalleryCard e={gallery.b} ratio="1:1" sizes="(min-width: 1024px) 27vw, (min-width: 640px) 50vw, 100vw" />
              </div>
            </div>
            <div className="lg:col-span-5">
              <GalleryCard e={gallery.tall} ratio="9:16" sizes="(min-width: 1024px) 38vw, 100vw" tall />
            </div>
          </div>
        </div>
      </section>

      {/* 4 · Prompt-to-result story */}
      <section aria-labelledby="story-title" className="border-t border-line bg-surface/40 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="story-title"
            eyebrow="Prompt to result"
            title="See the input, the output and the exact settings."
            intro="Nothing hidden between the words you write and the file you download."
          />
          <div className="mt-8">
            <StoryTabs />
          </div>
        </div>
      </section>

      {/* 5 · Use-case row */}
      <section aria-labelledby="usecases-title" className="border-t border-line py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead id="usecases-title" eyebrow="Use cases" title="Made for the formats you publish." />
          <ul className="scroll-thin -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {[
              {
                title: "Social posts and stories",
                body: "Vertical and square frames sized for feeds and stories, with a short clip when a still is not enough.",
                media: "auroraVertical" as const,
                ratio: "aspect-[4/5]",
                tool: "image" as const,
                starter: "Vertical story background, calm night landscape, space for a headline at the top",
                settings: { ratio: "9:16" },
                tags: ["9:16", "1:1", "Short video"],
              },
              {
                title: "Product imagery",
                body: "Clean studio scenes for product listings and launches. Use edit to change a background on your own photo.",
                media: "product" as const,
                ratio: "aspect-[4/5]",
                tool: "image" as const,
                starter: "Product on a cream pedestal, soft warm studio light, plain backdrop, square crop",
                settings: { modelId: "img-detail", ratio: "1:1" },
                tags: ["1:1", "4:5", "High detail"],
              },
              {
                title: "Creative concepts",
                body: "Explore moods, palettes and compositions quickly before committing to a direction.",
                media: "spheres" as const,
                ratio: "aspect-[4/5]",
                tool: "image" as const,
                starter: "Abstract still life of glossy spheres on a pale floor, soft shadows, calm palette",
                settings: { ratio: "3:2" },
                tags: ["3:2", "16:9", "Variations"],
              },
            ].map((u) => (
              <li key={u.title} className="w-[78vw] max-w-sm shrink-0 snap-start md:w-auto md:max-w-none">
                <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-media)] border border-line bg-surface">
                  <div className={cn("relative", u.ratio)}>
                    <Image src={MEDIA[u.media].src} alt={MEDIA[u.media].alt} fill sizes="(min-width: 768px) 30vw, 78vw" className="object-cover" />
                    <ConceptTag className="absolute top-3 left-3" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-lg font-semibold text-ink">{u.title}</h3>
                    <p className="mt-2 flex-1 text-[15px] text-muted">{u.body}</p>
                    <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Typical formats">
                      {u.tags.map((t) => (
                        <li key={t} className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">
                          {t}
                        </li>
                      ))}
                    </ul>
                    <StarterButton tool={u.tool} prompt={u.starter} settings={u.settings} label="Start with this idea" className="mt-5 self-start" />
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 6 · Before/after and motion */}
      <section id="before-after" aria-labelledby="ba-title" className="scroll-mt-20 border-t border-line bg-surface/40 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="ba-title"
            eyebrow="Edit and motion"
            title="Change what you have. Set it in motion."
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
              <div className="relative overflow-hidden rounded-[var(--radius-media)] border border-line bg-black">
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

      {/* 7 · Four-step explanation */}
      <section aria-labelledby="steps-title" className="border-t border-line py-16 lg:py-20" data-reveal>
        <div className={wrap}>
          <SectionHead id="steps-title" eyebrow="How it works" title="Four steps, and you approve the cost first." />
          <ol className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius-media)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: ListChecks, title: "Choose", body: "Pick image, edit or video, then a model that fits the job." },
              { icon: PenLine, title: "Describe", body: "Write what you want. Add a reference when you are editing." },
              { icon: ScanEye, title: "Review", body: "Check the settings and the exact credit cost before anything runs." },
              { icon: Download, title: "Generate and download", body: "Results save to your library with their prompt and settings." },
            ].map((s, i) => (
              <li key={s.title} className="relative bg-canvas p-6">
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-10 place-items-center bg-brand-blue text-sm font-bold text-white tabular"
                    style={{ clipPath: "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)" }}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <s.icon aria-hidden className="size-5 text-muted" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-1.5 text-[15px] text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 8 · Model capability cards */}
      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-20 border-t border-line bg-surface/40 py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <SectionHead
            id="tools-title"
            eyebrow="Tools and models"
            title="Three tools. Models described by what they are good at."
            intro="Catalog preview: model names, limits and availability come from the verified catalog at launch."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {TOOL_ORDER.map((t) => {
              const Icon = t === "image" ? ImagePlus : t === "edit" ? WandSparkles : Clapperboard;
              return (
                <article key={t} className="flex flex-col rounded-[var(--radius-media)] border border-line bg-surface">
                  <header className="flex items-center gap-3 border-b border-line p-5">
                    <span className={cn("grid size-10 place-items-center rounded-[10px]", t === "video" ? "bg-[rgb(118_61_255/0.18)] text-violet-on-dark" : "bg-[rgb(28_93_255/0.16)] text-link")}>
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-ink">{TOOLS[t].label}</h3>
                      <p className="text-sm text-muted">{TOOLS[t].summary}</p>
                    </div>
                  </header>
                  <ul className="flex-1 divide-y divide-line">
                    {MODELS.filter((m) => m.tool === t).map((m) => (
                      <li key={m.id} className="p-5">
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
                        <p className="mt-2 text-xs text-muted">
                          {[m.ratios.join(" / "), m.durations ? m.durations.map((d) => `${d}s`).join(" / ") : null, m.resolutions?.join(" / "), m.audio ? "optional audio" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-line p-5">
                    <Link href={TOOLS[t].href} className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline">
                      Open {TOOLS[t].studioTitle.toLowerCase()} <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 9 · Price preview */}
      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-line py-16 lg:py-24" data-reveal>
        <div className={wrap}>
          <div className="overflow-hidden rounded-[22px] border border-line bg-surface">
            <div className="grid lg:grid-cols-12">
              <div className="border-b border-line p-6 sm:p-8 lg:col-span-5 lg:border-r lg:border-b-0 lg:p-10">
                <p className="text-sm font-semibold text-brand-lime">Pricing</p>
                <h2 id="pricing-title" className="mt-2 text-[1.625rem] leading-tight font-semibold tracking-tight sm:text-3xl">
                  Pay with credits. See the cost before every job.
                </h2>
                <ol className="mt-6 space-y-4">
                  {[
                    { k: "Quote", v: "The studio shows the exact credit cost for your settings." },
                    { k: "Reserve", v: "When you press Generate, those credits are reserved — not spent yet." },
                    { k: "Settle", v: "Saved result: credits are charged. Failed job: reserved credits come back." },
                  ].map((s, i) => (
                    <li key={s.k} className="flex gap-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold text-muted tabular">{i + 1}</span>
                      <p className="text-[15px] text-muted">
                        <strong className="font-semibold text-ink">{s.k}.</strong> {s.v}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="p-6 sm:p-8 lg:col-span-7 lg:p-10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Credit packs</h3>
                  <Badge tone="attention">Sample values — not approved pricing</Badge>
                </div>
                <ul className="mt-5 grid gap-3 sm:grid-cols-3">
                  {PACKS.map((p, i) => (
                    <li key={p.id} className={cn("flex flex-col rounded-[var(--radius-media)] border p-5", i === 1 ? "border-brand-blue bg-[rgb(28_93_255/0.08)]" : "border-line bg-canvas/40")}>
                      <p className="text-sm font-semibold text-muted">{p.name}</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink tabular">{p.credits.toLocaleString("en-US")}</p>
                      <p className="text-sm text-muted">credits</p>
                      <p className="mt-4 text-lg font-semibold text-ink tabular">{p.priceLabel}</p>
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
          </div>
        </div>
      </section>

      {/* 10 · Partner invitation */}
      <section id="partners" aria-labelledby="partners-title" className="scroll-mt-20 border-t border-line bg-surface/40 py-16 lg:py-24" data-reveal>
        <div className={cn(wrap, "grid items-center gap-10 lg:grid-cols-12")}>
          <div className="lg:col-span-6">
            <p className="text-sm font-semibold text-brand-lime">Partner program</p>
            <h2 id="partners-title" className="mt-2 text-[1.625rem] leading-tight font-semibold tracking-tight sm:text-3xl lg:text-[2.25rem]">
              Share Genlixs with your audience. Earn on eligible paid referrals.
            </h2>
            <p className="mt-4 text-[17px] text-muted">
              For creators and educators who already make things with AI. Commission rates, holding periods and payout thresholds are set in the published
              program agreement — you see them before you apply.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/partners/apply">Apply to the program</ButtonLink>
              <ButtonLink href="/partner" variant="secondary">
                Preview the partner portal
              </ButtonLink>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-6">
            {[
              { t: "One link to share", b: "Copy your main link or create a campaign link for each platform." },
              { t: "Clear eligibility", b: "Each referral shows when it became eligible and why." },
              { t: "Separate balances", b: "Pending, available, reserved and paid are never mixed into one number." },
              { t: "Payout readiness", b: "See exactly which condition is still open before you can request a payout." },
            ].map((f) => (
              <li key={f.t} className="rounded-[var(--radius-media)] border border-line bg-canvas p-5">
                <span className="block h-1 w-8 rounded-full bg-brand-lime" aria-hidden />
                <h3 className="mt-4 font-semibold text-ink">{f.t}</h3>
                <p className="mt-1 text-sm text-muted">{f.b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 11 · FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t border-line py-16 lg:py-24" data-reveal>
        <div className={cn(wrap, "grid gap-10 lg:grid-cols-12")}>
          <div className="lg:col-span-4">
            <p className="text-sm font-semibold text-brand-lime">FAQ</p>
            <h2 id="faq-title" className="mt-2 text-[1.625rem] leading-tight font-semibold tracking-tight sm:text-3xl">
              Questions before you create
            </h2>
            <p className="mt-3 text-muted">
              More answers in the{" "}
              <Link href="/help" className="font-semibold text-link underline-offset-4 hover:underline">
                help centre
              </Link>
              .
            </p>
          </div>
          <div className="divide-y divide-line rounded-[var(--radius-media)] border border-line bg-surface lg:col-span-8">
            {FAQ.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-ink hover:bg-raised/60">
                  {f.q}
                  <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-5 pb-5 text-[15px] text-muted">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

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

function GalleryCard({ e, ratio, sizes, featured, tall }: { e: Example; ratio: string; sizes: string; featured?: boolean; tall?: boolean }) {
  return (
    <article className={cn("group flex flex-col", tall && "h-full")}>
      <MediaFrame media={e.media} ratio={ratio} sizes={sizes} className={cn(tall && "lg:aspect-auto lg:min-h-0 lg:flex-1")} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("line-clamp-2 font-semibold text-ink", featured ? "text-lg" : "text-[15px]")}>{e.title}</h3>
          <p className="truncate text-[13px] text-muted">{meta(e)}</p>
        </div>
        <UsePromptButton exampleId={e.id} context={e.title} look={featured || tall ? "outline" : "link"} label={featured || tall ? "Use this prompt" : "Use prompt"} className="shrink-0" />
      </div>
    </article>
  );
}
