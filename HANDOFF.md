# HANDOFF — Genlixs (design preview + live backend)

This file lets a new Claude Code session, on any account, continue exactly where the last one stopped. Read it in full before you change anything. Then read the documents listed in §9 in the order given.

- **Last updated:** 19 Oct 2026
- **Latest work (19 Oct 2026):** **v3.6 — two-page Admin and automatic KIE-based pricing.** The four catalog pages became two: **Models & pricing** (`/admin/catalog`: pricing panel with *Markup on KIE cost (%)* and *USD value of one Genlixs credit* + **Save & apply**; one row per model with its example price in credits and USD, serving supplier and whole-request cost, effective markup, On/Off; model drawer; packages collapsed; *Add models*) and **Providers & balances** (`/admin/providers`: one row per provider with status, balance, spending, switch, key, refresh; drawer and on-demand details). `/admin/pricing` → `/admin/catalog`, `/admin/balances` and `/admin/kie` → `/admin/providers` (307). Every price follows one global policy in the database (credits = ceil(KIE reference × (1 + markup) ÷ credit value) per request); per-model and bulk price editing are retired (`PRICING_AUTOMATIC`); new KIE price data re-prices automatically. Migration `20261018232513_automatic_pricing` is applied: policy v1 = +100 % at $0.02, which reproduced all 21 published prices (no price changed). Owner guide: `docs/CATALOG_AND_PRICING.md`; evidence: `docs/VERIFICATION.md` §00000. No paid generation or provider test was run.
- **Before that (18 Oct 2026):** **v3.5.1 — catalog pages for multi-supplier routing.** Admin › Models shows every model once with the supplier serving it, the default request's cost/price/margin and the cheapest other supplier (with the missing step); its *Available at suppliers* tab lists the 50 products outside the catalog, each once, cheapest supplier first. Pricing & packages has summary cards and three tabs; **Supplier balances** (`/admin/balances`) replaces the KIE balance page (`/admin/kie` redirects) and covers all six suppliers. One read-only function, migration `20261018194110_catalog_supply` (applied). Owner guide: `docs/CATALOG_AND_PRICING.md`; evidence: `docs/VERIFICATION.md` §0000. Turning the 50 products into customer models needs an integration per product, keys, paid tests and prices (§7, task 0).
- **Before that (applied and deployed 18 Oct 2026):** **v3.5 — multi-provider routing** — six suppliers behind one catalog, keys in Vault from Admin, cheapest verified route per request, supplier cost ledger, Admin › Providers & routing. Migrations `20261018181012`…`20261018182418_multi_provider_routing_part01`…`part12` are applied to production. Every model still routes to its original KIE route; all 119 new offers are off and the five new suppliers are disabled with no key — nothing is activated until the owner adds keys and verifies offers (§7, task 0). Guide: `docs/PROVIDERS_AND_ROUTING.md`; evidence: `docs/VERIFICATION.md` §000.
- **Previous work:** **v3.4 — UI refinement, Image Edit references, walkthroughs and Motion Library** (deployed 18 Oct 2026; migration `20261018013256` applied; see §0, first block) on top of **v3.3 — generation repair, three video modes and the shared generation preview** (see §0, first block;
  evidence in `docs/VERIFICATION.md` §0), on top of **v3.2 — simplified admin and explicit credit pricing** (Models with one On/Off switch, Pricing & packages with two reference values, package editor and per-setting price editor, KIE balance page; migrations `20261014203016`–`20261014203957`, 18 in total) on top of **v3.1 — admin catalog, bulk pricing and KIE monitoring** and **v3 — live backend** (`claude/nice-curie-ispn6l`, see `git log`). v3 implemented `Genlixs_Backend_Implementation_Guide_EN.md` v1.0; v3.1 adds the Models & pricing workspace, 18 curated KIE models, bulk markup pricing, private staff tests and the KIE balance panel (4 more migrations, 14 in total). Start with §0.
- **Repository:** https://github.com/lonadonia/Genlixs (public)

---

## 0. v3 backend — state at a glance

**v3.4 (18 Oct 2026) — UI refinement, Image Edit references, walkthroughs and Motion Library. Pushed and deployed with
the owner's go-ahead; evidence in `docs/VERIFICATION.md` §00.**
- Studio about 10 % more compact by real layout values (rail 236 → 212 px, header 68 → 60, buttons 44 → 40 / 48 → 44,
  tabs 48 → 44, option chips 44 → 40); refined panels, buttons (lower edge), segments and icon tiles. Dark `SelectMenu`
  (`src/components/ui/select-menu.tsx`) replaces the native selects. Studio focus rings use #6b7cff; settings panels scroll
  without a visible track (`.panel-scroll`). The stray line beside the form was the focus outline of `<main id="main">`
  (skip-link target) — removed in `globals.css`; controls keep their rings.
- Edit lives inside Image (Generate / Edit, one draft per mode). `/studio/edit` answers 307 to `/studio/image?mode=edit`
  with its query (`src/proxy.ts`, page redirect as fallback; `src/lib/studio-routes.ts`).
- One `ModelPicker` for Image and Video with provider marks (`src/components/live/studio/model-logo.tsx`, Simple Icons
  CC0 paths; FLUX.2 shows a "BFL" monogram because no vetted mark is available).
- Image Edit takes several references in order (`src/lib/live/references.ts`, `image/reference-collection.tsx`).
  Migration `20261018013256_image_edit_multi_reference` (applied 18 Oct 2026 with the owner's go-ahead) sets the
  per-model limits 16/16/8/8/10 from the KIE docs, keeps the reference order from quote to provider and re-binds the
  prices unchanged; rollback in `supabase/rollbacks/` (not applied). `supabase/tests/07` passes on production.
- Video canvas: History / Motion Library / How it works (`?view=history|library|how`). The studio opens on How it works
  (owner's request, 18 Oct 2026); a job link or a reused file opens History, and Generate switches to History. On a
  phone How it works sits above the tools with a "Start creating" button. Walkthrough carousel
  (`video/how-it-works.tsx`, `src/lib/tutorials.ts`), Motion Control banner (`video/motion-banner.tsx`), Motion Library
  (9 clips, `src/lib/motion-library.ts`, `video/motion-library.tsx`): Recreate uploads the library clip itself as the motion
  video, the customer's image as the character, keeps the prompt; Motion Control prices it and nothing runs until Generate.
- Media: demo clips on `/sign-in` and in the landing "Video" section (`#reel`); new wordmark `genlixs-header-v3-*`. All
  choices and exclusions: `design-handoff/genlixs/CLIENT_MEDIA.md` (v3.4).
- Isolated database tests: `supabase/local-test/` (embedded PostgreSQL 17 + Supabase stand-in; never touches production).
- Open for the owner: a paid live run of a multi-reference edit and of Recreate (not run: cost-bearing).

**v3.3 (15 Oct 2026) — production state:**
- Generation works end to end in production (image, Veo 3.1 Lite text and start-frame video) with polling; video editing
  and Motion Control work as private tests. Root causes fixed: Vault worker origin (unresolvable example domain), KIE 402
  account refusals now an explicit account state with a 5-minute quote pause, result-host setting that parsed to nothing
  (reviewed KIE hosts always apply; production value corrected), app/callback base URLs, a quote that was never renewed.
- Owner's catalog: 18 models enabled with published prices (+100 % on KIE cost at $0.02 per Genlixs credit). Three new
  entries — Seedance 2.5 Edit, Kling 3.0 Motion Control, Veo 3.1 Extend — are **off with draft prices** awaiting the
  owner (`docs/CATALOG_AND_PRICING.md`, "Video modes").
- Code: `src/components/live/studio/video/` (studio, composer controls, inputs, model picker),
  `src/components/live/studio/preview/` (generation preview card with the white emblem, job card, signed media),
  `src/lib/live/video-studio.ts` (composer rules, contract-tested), `src/lib/live/{uploads,use-job,use-quote,progress}.ts`;
  migrations `20261015025200`–`20261015032953` (reliability, typed inputs, video-mode catalog, reads, reuse of outputs).
- Tests: contracts 54, SQL suites 01–06 (57 groups), browser checks of the signed-in production studio (desktop + phone).
- Open for the owner: ~~approve the three draft prices and switch the modes on~~ (done: all 21 models are on; since v3.6
  every price follows the global policy and drafts no longer exist); `KIE_WEBHOOK_HMAC_KEY` (polling covers it);
  a live test of Veo 3.1 Extend and of 1080p/4K results; check the KIE key limits if 402 refusals return.
- QA accounts: the temporary accounts of 15 Oct were closed through the runbook procedure (`docs/RUNBOOKS.md`, Accounts);
  their jobs, ledger and test evidence remain as records.

- **Read first:** `docs/BACKEND.md` (architecture, module and API map), `docs/SETUP_AND_ACTIVATION.md` (owner configuration, in order), `docs/RUNBOOKS.md`, `docs/VERIFICATION.md` (evidence + readiness verdict: **not production-ready until activation and real-account checks**).
- **Modes:** `LIVE` (`src/lib/config.ts`) is true when both `NEXT_PUBLIC_SUPABASE_*` values are set. The owner has set the production variables on Vercel (names in `docs/SETUP_AND_ACTIVATION.md`; `KIE_WEBHOOK_HMAC_KEY` was missing), so production runs in live mode. **Pushing this branch deploys to production.** Local live QA uses an ignored `.env.local` with the public values only (no secret key, no KIE key).
- **v3.2 pricing:** charges are valued at the Genlixs credit value (reference, seeded as the illustrative $5 / 250 credits, labelled unconfirmed) and KIE costs at the KIE purchase reference ($5 / 1,000); the cheapest-package rule is gone. A priced model can be switched on without a paid test (status stays truthful). Owner quick guide (three tasks) at the top of `docs/CATALOG_AND_PRICING.md`.
- **v3.1 catalog:** owner guide and model reference in `docs/CATALOG_AND_PRICING.md`. All 18 models are disabled, unpriced and "Untested"; no paid KIE test has been run. The admin UI lives in `src/components/live/admin/catalog/`; SQL in migrations `20261014065744`–`20261014161256`.
- **Supabase:** org "Genlixs", project `qlpxdrbadakbyzdyfrnk` (eu-west-1). Migrations in `supabase/migrations/` are named with the applied remote versions (byte-identical). Models disabled, products/agreement in draft. Real accounts exist and the owner is bootstrapped; treat the database as production (additive migrations, rolled-back tests, temporary QA accounts deleted after use).
- **MCP notes:** `apply_migration` refuses statements it considers destructive (e.g. `DROP FUNCTION`) with "Invalid or expired requestState"; write migrations additively (the bind-verification migration keeps a refusing stub instead of dropping). `execute_sql` works for tests and reads.
- **Tests:** `supabase/tests/` (41 groups in 01–04, run via `execute_sql`, always rolled back), `npm run test:contracts` (27), local live API smoke (36), pricing API checks (26), pricing browser flows (78) and the v3 browser flows (30) — scripts in `design-handoff/genlixs/qa-scripts/`; results in `docs/VERIFICATION.md`.
- **MCP note (v3.2):** the account changed during the session; the claude.ai Supabase connector returned 404 and the Supabase plugin MCP (OAuth) was used instead. It asks the owner to confirm statements that delete rows; large migrations were applied in parts (≈ 30 KB each).
- **MCP note (v3.1):** `apply_migration` accepted `ALTER TABLE … DROP CONSTRAINT / DROP NOT NULL`; only function/table drops were refused earlier.
- **Not done (needs the owner):** `KIE_WEBHOOK_HMAC_KEY`, SMTP + Auth URLs (status unknown), funding KIE and running private paid tests, publishing prices/packages/terms and enabling models, payment gateway choice and adapter, domain, Vercel Pro for commercial use, leaked-password protection. Not implemented: subscription change/cancel endpoints, self-service account deletion, transactional email sending, resumable uploads for imports over the Storage standard-upload limit.

---

## 1. Resume in 5 minutes

```bash
git clone https://github.com/lonadonia/Genlixs.git && cd Genlixs
git checkout claude/nice-curie-ispn6l          # all work lives on this branch (no PR opened yet)
npm install                                     # Node >= 20.9 (built and tested on 22.22)
npm run lint && npm run typecheck && npm run build
npx next start -p 3200                          # production server used by all QA scripts
# or: npm run dev
```

Before you write code:

1. Read `CLAUDE.md` and `AGENTS.md`.
   - This is **Next.js 16.3.8**, so APIs differ from older versions. Check `node_modules/next/dist/docs/` before you use an API.
   - The `priority` prop of `next/image` is deprecated. Use `loading="eager"`. The `Logo` and `MediaFrame` components map their own `priority` prop to it.
2. Read `design-handoff/genlixs/03_CLAUDE_CODE_MASTER_PROMPT.md`. It holds the rules for changing this project.
3. Then follow §7 (pending tasks) and §8 (the rules you must keep).

The first message to send in the new session can be:

> "Read HANDOFF.md and the docs it lists, then continue with the pending tasks in §7. Develop on branch `claude/nice-curie-ispn6l`."

---

## 2. Project overview

**Genlixs** is an AI creation platform for images, reference-image edits and short videos. This repository is a **working design preview**, not the production platform. It contains four surfaces:

| Surface | Routes | Purpose |
| --- | --- | --- |
| Public site | `/`, `/help`, `/status`, `/terms`, `/privacy`, `/acceptable-use`, `/partners/apply`, `/sign-in` | Hero, lit composer, gallery, story tabs, use cases, before/after, steps, tools, pricing, partners, FAQ, closing band |
| Customer studio | `/studio`, `/studio/{image,edit,video,library,credits,billing,support}` | Dashboard modelled on the client's reference: quick create, generation flow with quote → reserve → charge or return, library, credits, billing |
| Admin console | `/admin`, `/admin/jobs`, `/admin/jobs/[id]`, `/admin/payouts` | Operations views with role gates and guarded actions |
| Partner portal | `/partner`, `/partner/{links,referrals,commissions,payouts,resources,settings}` | Affiliate program |

In v3 there are 34 page files and 41 route handlers (the build generates 97 entries). **In preview mode (no Supabase env) everything is simulated in the browser**; in live mode the same pages use the backend (see §0):
- `src/lib/demo-store.ts` holds the simulated studio state (localStorage key `genlixs-preview-v3`).
- `src/lib/admin-data.ts` holds the simulated admin data.

Nothing is generated, charged or paid out, and the UI must keep saying so. The preview banner and the "Preview · sample data" chips do this.

The client writes in **Arabic**. Reply to them in Arabic. Code, comments and docs are in English.

---

## 3. History and completed work

| Commit | What |
| --- | --- |
| `e15e273` | v1: full preview of the four surfaces from *Genlixs Design Guide v1.0* (via `/elite-design-director`) |
| `79c2e7e` | v1 docs: GitHub/Vercel delivery status |
| `98b2763` | **v2 brand redesign**: new logo package, new palette, REDNIT-style hero, Pollo-style homepage sections and customer dashboard. Client note: **primary colour is `#253FF6`** |
| `f8638dd` | v2 docs: delivery status, Drive blocker, QA results |
| `a7d543f` | **v2.1**: client Drive media added (14 images + 1 muted clip). Hero tiles now follow each file's own aspect ratio, with 18 px corners (client asked: "not sharp, not too round"). Examples, gallery, studio seeds and other sections switched to client media |
| `HANDOFF.md` commit | `HANDOFF.md` only, plus a pointer in `CLAUDE.md`. No functional change |
| *(v3.2 commit)* | **Simplified admin and explicit credit pricing.** Migrations `simplified_pricing`, `_prices`, `_packages`, `_fixes`: versioned append-only reference values (KIE purchase, Genlixs credit value), pricing at the credit value with the KIE reference rate, one-step model prices with concurrency token and audited below-cost acceptance, bulk markup with kept settings, availability without a paid-test gate (truthful status), package bonus credits and one-step package editing, settings/partner-terms reads. UI: Models (switch + Details), Pricing & packages (reference cards, package editor, price editor with linked credits/USD/markup and package comparison, bulk markup), KIE balance page, service settings on Overview, partner terms on Partners. Exact-decimal arithmetic in `src/lib/pricing/` (contract tests). |
| *(v3.1 commit)* | **Admin catalog, bulk pricing and KIE monitoring.** Migrations `catalog_admin_schema`, `catalog_curated_models`, `catalog_admin_functions`, `catalog_admin_fixes`: 18 curated KIE models (GPT Image 2.5 Flare/Sunburst, Nano Banana 2/Pro, FLUX.2 Pro, Seedream 5.0 Flash, Veo 3.1 Fast/Lite/Quality, Kling 3.0, Seedance 2.5 / 2.0 Fast, Wan 2.6; display alias "Flare" corrected), immutable KIE cost versions per configuration, table prices, bulk markup batches (stale-preview check, all-or-nothing, restore), one availability flow (owner may enable untested on documented cost, status stays untested), private staff tests through the normal pipeline, KIE balance/spend panel. New adapters + contract tests; Models & pricing workspace (`src/components/live/admin/catalog/`); studio badges/maintenance; docs `docs/CATALOG_AND_PRICING.md`. |
| *(v3 commit)* | **Live backend (guide v1.0).** 10 Supabase migrations (identity/staff/audit, catalog/pricing, wallet ledger, media/storage, generation queues + workers RPCs, billing, affiliates 30 %/50 %, operations/admin, FK indexes, verified task binding), 25 SQL test groups; Next.js API (`src/app/api/**`), proxy session refresh, KIE adapter + callback HMAC, SSRF-safe importer, fenced workers, billing gateway abstraction (`test` outside production), referral consent + signed cookie; live studio, partner portal, admin console (users, payments, catalog/prices/terms, partners, payouts, support, audit, staff), live pricing and auth (sign-up/in/out, reset). Docs in `docs/`. |
| *(v2.2 commit)* | **Full client media + clips with sound.** 36 new images and 20 new clips from the client's local `images` / `Videos` folders (21 images and 6 clips excluded, see `CLIENT_MEDIA.md`). New `ShowcaseVideo` player: every public clip autoplays muted while on screen and turns its sound on when clicked, one clip audible at a time (replaces `HoverVideo`, now deleted). Hero: Pause/Play button removed, fourth column added, 9 clips among the stills, columns run to the viewport's right edge. New showcase wall `#showcase` (all 71 items, filters, "Show all"). Gallery gains "Giant astronaut in Midtown"; the "Social posts" use case is now a clip. QA scripts take `PLAYWRIGHT_PATH` / `CHROME_PATH`; `v2checks.js` reworked (18 checks). Changed files: `src/lib/media.ts`, `src/lib/catalog.ts`, `src/components/public/{hero,showcase-wall,story-tabs}.tsx`, `src/components/ui/showcase-video.tsx` (new), `src/components/ui/hover-video.tsx` (deleted), `src/app/(public)/page.tsx`, `src/app/globals.css`, `public/media/client/*`, `design-handoff/**`, `README.md`, `HANDOFF.md` |

All of these pass the latest QA run (§6).

### Client requests, verbatim intent (for traceability)

1. v1: build the site from the design guide, with QA and docs. Push to GitHub. Make a Vercel preview only if an authorised account allows it. Summarise in Arabic.
2. v2 (Arabic): use the new logo and palette:
   - Night `#0F1212`, Lime `#E1FF01`, White, Electric Blue `#253FF6`.
   - Make the site more professional, inspired by the Pollo.ai full-page capture.
   - Model the hero on the REDNIT screenshot, and the customer dashboard on the Pollo dashboard.
   - Use the Drive folder's images and videos as visual inspiration.
3. v2 note: "the primary colour must be 253FF6".
4. v2.1: "retry Drive now". The hero cards must follow the size of the image or video inside them, with corners that are neither sharp nor very rounded.
5. v2.2 (Arabic): upload the videos and images from the `images` and `Videos` folders to the site. Videos must play on their own, professionally, without sound until the visitor clicks the video to turn the sound on. In the hero, remove the pause/play button of the animation, put the videos among the hero images, and add one more column on the right (REQ-067 … REQ-070).

The full requirement list (REQ-001 … REQ-070) is in `design-handoff/genlixs/01_CLIENT_BRIEF_ANALYSIS.md`.

---

## 4. Key decisions (keep unless the client says otherwise)

- **Colour roles:**
  - `brand-blue` `#253FF6` is the primary colour, with white text at 6.73 : 1. Use it for buttons, selected tabs, active nav, the banner and bands.
  - `brand-blue-bright` `#5165f8` is only for large text and icons on dark backgrounds.
  - `link` `#A9B4FF` is for small link text.
  - **Lime** is only for:
    - the hero squiggle underline;
    - signal dots;
    - success states;
    - the focus ring on dark backgrounds (on light backgrounds the focus ring is blue).
  - Do not add lime primary buttons.
- **Typography:** Archivo variable (`.font-display`, font-stretch 112 %) for display text and Inter variable for UI text. Both are self-hosted through `@fontsource-variable`.
- **One media manifest:** every visual comes from `src/lib/media.ts` (`MEDIA`, `MediaItem`, `stillOf`).
  - `placeholder: true` shows a "Placeholder" tag.
  - Studio results built from client files show a "Sample" tag.
  - Client media have `placeholder: false` and a `credit`.
- **Hero (`src/components/public/hero.tsx`):**
  - Four columns (v2.2), 6 tiles each, 9 of them clips. The columns run to the viewport's right edge at every width.
  - **No Pause/Play button** (client request, v2.2). Hover/focus still hold the columns (`.marquee-pause`), and reduced motion stops them. Do not add the button back unless the client asks.
  - `MediaTile` sets `aspect-ratio` from the manifest's width and height, with `rounded-[18px]`.
  - On phones the strip is 176 px tall, the width comes from the ratio, and tiles use `rounded-2xl`.
  - Margins replace gaps so the −50 % marquee loop is seamless.
  - Hero clips are real buttons (click for sound). The second copy of each marquee loop is `aria-hidden` and its buttons use `tabIndex=-1` (`copy` prop).
- **Motion and clips:**
  - Moving regions sit inside a `MotionRegion` with a visible Pause/Play control (WCAG 2.2.2), except the hero, as above.
  - `ShowcaseVideo` (`ui/showcase-video.tsx`) is the player for every public clip: muted loop while ≥ 25 % on screen; a click anywhere on the clip turns the sound on; every other clip mutes (window event `genlixs:clip-sound`); leaving the screen pauses and re-mutes; clips without a sound track (`audio: false`) toggle play/pause; reduced motion and Save-Data keep the poster until pressed.
  - `AutoplayVideo` stays only for the decorative closing-band loop.
  - Reduced motion stops the marquees, the squiggle and the reveals.
- **Honesty rules:**
  - Prompts and settings shown with the client media are *prompt ideas* written to match each file. They are not the recorded prompts. The gallery footnote and the Help page say this.
  - Do not show testimonials, user counts or "unlimited" claims.
  - Model names, prices and partner terms are sample values.
- **Excluded media:** files with a watermark (Higgsfield) or third-party brand marks (Balenciaga, Subway, Buc-ee's, Ferrari, Porsche, Désembre, MIALY, ASICS, a paddleboard brand) are not used. The full list is in `design-handoff/genlixs/CLIENT_MEDIA.md`.
- **The studio credit flow mirrors the blueprint:** quote with TTL, then reserve, then charge on save, or return on failure or cancel. Never ask the user to resubmit while a submission is unconfirmed.

---

## 5. Technical architecture

- **Stack:**
  - Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript.
  - Tailwind CSS 4: tokens live in `@theme` in `src/app/globals.css`, and there is no tailwind config file.
  - lucide-react for icons.
- **No backend, no env secrets.** `NEXT_PUBLIC_SITE_URL` is optional, and `.env.example` lists names only.

```
src/app/(public)/        public routes; page.tsx = homepage (ExampleCard, gallery bento, USE_CASES, ToolCard, FAQ…)
src/app/studio|admin|partner|sign-in/
src/components/public/   hero.tsx, showcase-wall.tsx, composer.tsx, story-tabs.tsx, prompt-buttons, prompt-actions.ts
src/components/studio/   studio-shell, overview (Home), workspace, controls, job-status, result-view, library,
                         credits, billing, support, reference-uploader, demo-helpers.ts (pickMedia, titleFrom)
src/components/console/  console-shell (admin + partner chrome)
src/components/ui/       button, badge (Badge, ConceptTag), media-frame, showcase-video, autoplay-video, copy-button
src/components/          motion-region.tsx, compare-slider.tsx, preview-banner.tsx, demo-runtime.tsx
src/lib/media.ts         media manifest (client + placeholder entries; `clientImage` / `clientClip` helpers; `SHOWCASE` order)
src/lib/catalog.ts       TOOLS, MODELS, EXAMPLES (curated examples), demoQuote, settings helpers
src/lib/demo-store.ts    useSyncExternalStore store: drafts, quotes, jobs, ledger, payments, partner state
src/lib/admin-data.ts    sample operational/financial records
public/brand/            web exports of the supplied v2 logo (unaltered: colour-to-alpha, trim, resize)
public/media/client/     client-supplied images (WebP, ≤1600 px) + 21 clips (H.264 + AAC, 540×960) + WebP posters
public/media/concept/    procedural placeholders (orbit loop, dunes pair, etc.)
brand/                   logo masters (not served) + scripts: export_logo*.py, placeholder_renders.py,
                         concept_media.py, client_media.py
design-handoff/genlixs/  01–05 docs, CLIENT_MEDIA.md, 24 screenshots, qa-scripts/
```

- **To add or replace media**, add one entry in `src/lib/media.ts` (`clientImage(...)` / `clientClip(...)` for client files; set `audio` for clips), then list it in `SHOWCASE` if it belongs on the wall. Components need no changes. Use the keys in `EXAMPLES` (`catalog.ts`), in the hero `COLUMNS`, and in `seedJobs` (`demo-store.ts`).
- **Demo state:** if you change the seed data, bump `KEY` in `demo-store.ts` so returning browsers pick up the new seeds. Then update the same key in `design-handoff/genlixs/qa-scripts/*.js`.

---

## 6. QA — how it was verified, and how to re-run it

Latest run, 14 Oct 2026 (v2.2), on the production build, Windows 11 + Node 24.21 + Chrome 155 via playwright-core 1.64:

| Check | Result |
| --- | --- |
| lint / typecheck / build | pass / pass / pass |
| `flows.js` (36 journey assertions) | 36 / 36, 0 console errors |
| `v2checks.js` (18: hero motion without a button, 4 columns, muted clips, click-for-sound with one voice, studio Home, hero tile ratio ≤ 2 %, 18 px corners) | 18 / 18 |
| `kbd.js` (keyboard, focus, reduced motion) | 8 / 8 |
| axe-core 4.10.3, WCAG 2.x A/AA, 27 routes | 0 violations (plus `/` with motion on and the showcase expanded: 0) |
| `ovpage.js`, 27 routes × 1440/1024/768/390/360 | 0 / 135 overflow, 0 console errors |
| **v3 re-run (preview mode):** flows 36/36, v2checks 18/18, kbd 8/8, axe 30 routes 0 violations, ovpage 30 routes × 5 widths 0 overflow / 0 console errors | pass |
| **v3 live mode (local build + real Supabase):** API smoke 36/36, browser flows 30/30 (incl. axe on 8 live pages), contract tests 15/15, SQL tests 25/25 | pass — details in `docs/VERIFICATION.md` |

Scripts and usage are in `design-handoff/genlixs/qa-scripts/README.md`.
- The scripts load Playwright from `PLAYWRIGHT_PATH` (default `/opt/node-tools/node_modules/playwright`, the Claude Code cloud image) and launch `CHROME_PATH` when set. `playwright-core` plus an installed Chrome is enough; no browser download is needed.
- On Windows (Git Bash) also set `MSYS_NO_PATHCONV=1`, otherwise route lists like `/,/help` are rewritten into Windows paths.
- `axe.js` needs `axe-core` installed (`npm i --no-save axe-core`). Pass it the path to `axe.min.js`.

Route list for axe and overflow:

```
/,/help,/status,/terms,/privacy,/acceptable-use,/partners/apply,/sign-in,/studio,/studio/image,/studio/edit,/studio/video,/studio/library,/studio/credits,/studio/billing,/studio/support,/admin,/admin/jobs,/admin/jobs/J-5CQC1,/admin/payouts,/partner,/partner/links,/partner/referrals,/partner/commissions,/partner/payouts,/partner/resources,/partner/settings
```

The QA scripts depend on these strings and selectors. Update the scripts if you change them:
- the library job title "Pup knight in the fog";
- the `.marquee-up` / `.marquee-down` classes inside the hero section (4 columns);
- clip button names `Turn sound on: …` / `Mute: …` / `Play with sound: …` (from `ShowcaseVideo`), and `#showcase`;
- `getByLabel('Status', { exact: true })`;
- `#home-prompt`, `#composer-prompt` and `#studio-prompt`.

**Gotcha:** never run `pkill -f "next dev"` or `pkill -f next`. It kills the calling shell. Kill by PID instead (on Windows: `Get-NetTCPConnection -LocalPort 3200 -State Listen` → `Stop-Process -Id <OwningProcess>`):

```bash
for p in $(ps -eo pid,args | grep -E "next start|next-server" | grep -v grep | awk '{print $1}'); do kill $p; done
```

---

## 7. Pending tasks (in priority order)

00. **Automatic pricing (v3.6):** applied 18 Oct 2026 (23:25 UTC) with policy v1 = +100 % on the KIE reference at $0.02
   per Genlixs credit; no price changed. The owner sets markup and credit value only in Admin › Models & pricing
   (**Save & apply**). Keep the KIE price lists current (model drawer → Technical details and tests → KIE cost): they now
   drive the prices directly. New migrations must insert capability or KIE cost versions and let the policy price them —
   never insert price versions. Rollback (not applied): `supabase/rollbacks/20261018232513_automatic_pricing.rollback.sql`.

0a. **Activate the cheaper suppliers (19 Oct 2026 state).** PoYo, APIMart, NezhaGate and Cuddler have saved keys and are
   on, but **no offer is eligible yet**, so none serves. Since `20261019010705_documented_activation` there are two ways
   (`docs/PROVIDERS_AND_ROUTING.md` §3a): **Live-tested** (a succeeded paid test of the offer, then *Mark live-tested*;
   a note alone is refused) or, owner only, **Activate: documented, not live-tested** in the offer drawer (Providers &
   balances › More › Routing & offers › offer › Details) when every documented check passes — tick the acknowledgement,
   give a reason; routing switches on and the first supplier refusal or failed job switches it off again. Qualifying on
   19 Oct (production simulation, rolled back: 236 of 528 settings cheaper, 0 dearer, prices unchanged): APIMart
   Seedance 2.5, Seedream 5.0 Flash image/edit; NezhaGate GPT Image 2.5 Flare image/edit (1K/4K; 2K left out after the
   supplier's 2K disruption notice), Nano Banana Pro image/edit; PoYo Kling 3.0 Motion Control. The balance check needs
   a reading from the last hour (refresh the provider first if the check says so). Still blocked: APIMart Seedance 2.0
   Fast and NezhaGate Sunburst (documentation questions — answer them in the drawer with a source), NezhaGate Seedance
   (top up: $0.15 cannot cover $0.375–$0.50), Cuddler ($0, result host undocumented: confirm it with a live test and add
   it to `MEDIA_FETCH_ALLOWED_HOSTS`, never guessed). Since `20261018235333_route_fallback_original`, a cheaper offer
   that is short of balance falls back to KIE (or the next offer up to KIE's cost) instead of refusing the request.
   Rollback (not applied): `supabase/rollbacks/20261019010705_documented_activation.rollback.sql`.

0. **Multi-provider routing (v3.5):** applied and deployed 18 Oct 2026 with everything new switched off. Next, only with
   the owner's go-ahead and a budget for paid tests: add each supplier's key in Admin, test the connection, run one
   authorised paid test per offer, mark it Verified, run *Review routing*. Replace the illustrative CNY / Duomi point
   rates with the rates actually paid; add Cuddler's confirmed result host to `MEDIA_FETCH_ALLOWED_HOSTS` (never a
   wildcard, never guessed). KIE's balance was 626 credits (~$3.13) on 18 Oct: jobs above the live balance are refused
   before charging until it is topped up. Details and the offer matrix: `docs/PROVIDERS_AND_ROUTING.md`.
   To grow the catalog from Admin › Models & pricing › *Add models* (each product once, cheapest supplier first): pick
   products with the owner, write the integration for the cheapest supplier, add a capability and its KIE reference
   price (the policy prices it; without a KIE reference it stays unpriced with "KIE reference needed"), run one paid
   test, then switch the model on — the router keeps one card per model whatever the supplier.

1. ~~**Remaining Drive videos (REQ-063).**~~ **Done in v2.2:** the client handed the full `images` and `Videos` folders over locally; 50 images and 21 clips are in. The old notes are kept below for reference.
   - 26 of the 27 videos are 12–43 MB. The Google Drive connector returns files of 10 MB or less only.
   - Direct `drive.google.com` access returns HTTP 403 from the cloud egress proxy. **Do not try to work around that proxy denial.**
   - Ways forward, either one:
     - (a) the client compresses the videos to under 10 MB (720p H.264, about 2–3 Mb/s, no audio) in the same folder;
     - (b) the user allows `drive.google.com`, `drive.usercontent.google.com` and `*.googleusercontent.com` in the environment's **Network access** setting.
   - Then, for each video:
     - re-encode it muted (`-an`, `-movflags +faststart`) and make a poster;
     - add it to `media.ts`;
     - use it in the hero columns, gallery and studio.
   - Drive IDs are in Appendix A.
2. **Vercel: project exists (`genlixs`, team "hakim's projects"), deploys this branch as production with no env vars (preview mode).** Switching to live mode and the rest of activation: `docs/SETUP_AND_ACTIVATION.md`. Notes below are from v1/v2.
   - The Vercel connector in the old session was authenticated as `mbanaoui147-4280`. Its ownership was **not** confirmed, because its GitHub namespace differs from the repo owner `lonadonia`.
   - Do not create a project or deploy until the user confirms which account to use.
   - Setup steps are in `design-handoff/genlixs/05_GITHUB_VERCEL_HANDOFF.md`. Use Preview deployments only, never production.
3. **Rights for client media.**
   - The file names carry an `hf_` prefix, which suggests a third-party generator.
   - The user must confirm the licence allows commercial use, plus the model and settings for each file (guide §14).
   - Record the answers in `media.ts` `credit` and in `CLIENT_MEDIA.md`.
4. ~~**Optional:** more Drive PNGs.~~ **Done in v2.2** (every image in the hand-over was screened; 21 excluded).
4b. **Confirm the brand names on the ad-style images** ("M. Atelier", "Apex & Summit", "Sonicfit", "Loud Kids Club", "Fascent", "Persone" bags in `shopping-bags`). They look invented, but the client should confirm none is a real company.
4c. **Hero motion control (REQ-064 vs REQ-068).** The client removed the hero Pause/Play button. If an accessibility audit is required before launch, propose a small, low-key control again.
5. **Replace the last placeholders:** the orbit loop (`loop`) and the dune edit pair (`dunesNoon` / `dunesDusk`). This needs a real before/after of the same scene.
6. **Blocked on the client (BLOCKED_EXTERNAL):**
   - `Genlixs_Project_Blueprint_v2.md`, which holds the real catalog, prices, credit rules, partner terms and services;
   - approved legal copy;
   - a support contact;
   - a Figma file.
7. **Not tested yet:**
   - screen readers (VoiceOver and NVDA);
   - 200 % zoom and long translated strings;
   - the mobile Generate bar's keyboard on real devices;
   - Lighthouse and Core Web Vitals — now more important: the homepage can stream up to ~38 MB of clips over a long visit (each clip loads only when on screen).
8. **Not built yet:** tool/model detail pages (REQ-054). (Admin screens and auth recovery exist in live mode since v3; in preview mode the extra admin pages show a "live console only" note.)
9. **When asked:** open a PR from `claude/nice-curie-ispn6l`. None has been opened, because none was requested.

## 8. Known issues and caveats

- **`npm audit`:**
  - Runtime: 0 vulnerabilities.
  - Dev: 5 high, all in the `eslint-config-next` toolchain. The fix needs a breaking downgrade, so it is left for an upstream update.
- **Unsynced durations:** the knight clip is 9 s, but its example recipe says 10 s / 16:9 and the file is 752×560. The recipe is what "Use prompt" loads; it is not the file's real settings, and the site notes this.
- **QA script check:** `v2checks.js` V2-15 measures only the hero tiles whose images have loaded (29 of 48 at 1440 px in v2.2). The others are lazy-loaded.
- **Visibility:** the repository is **public**, so the logo masters and the client media are visible to anyone. Suggest making it private if that is not intended.
- **AGENTS.md:** `next dev` re-writes the Next.js block in `AGENTS.md`. Committing it keeps the tree clean.

## 9. Documents to read (in order)

1. `CLAUDE.md`, `AGENTS.md`
2. `design-handoff/genlixs/03_CLAUDE_CODE_MASTER_PROMPT.md`: rules and the next-steps list
3. `design-handoff/genlixs/01_CLIENT_BRIEF_ANALYSIS.md`: requirements REQ-001…066 with status
4. `design-handoff/genlixs/02_CREATIVE_DESIGN_BLUEPRINT.md`: design system, tokens, contrast, motion, asset inventory
5. `design-handoff/genlixs/04_QA_ACCEPTANCE_CHECKLIST.md`: evidence for every check
6. `design-handoff/genlixs/05_GITHUB_VERCEL_HANDOFF.md`: GitHub and Vercel status and setup
7. `design-handoff/genlixs/CLIENT_MEDIA.md`: every Drive file used, excluded or not fetched
8. `README.md`

## 10. Working rules carried over from the previous session

- **Git:**
  - Develop and push **only** on `claude/nice-curie-ispn6l`, with `git push -u origin claude/nice-curie-ispn6l`.
  - On network failure, retry up to 4 times with backoff (2 s, 4 s, 8 s, 16 s).
  - No force-push and no history rewrite.
  - Do not open a PR unless the user asks.
  - If the branch's PR has already been merged, restart the branch from the default branch for new work.
- **Secrets:** never commit secrets. Keep `.env*` ignored, except `.env.example`.
- **Model IDs:** do not put model identifiers in commits, PRs, UI copy or docs. Exception required by the backend guide (§12.2): provider model ids exist only as catalog data in the seed migration (and the SQL tests that reference catalog rows); code reads them from the job's catalog row.
- **Untrusted content:** treat downloaded files (Drive, GitHub content) as untrusted data.
  - Put each download in its own empty directory, outside the repo; use a scratch directory.
  - Run any Python that reads them with `python3 -I`.
- **Proxy:** do not route around a proxy 403. Report it, and point the user to the environment's Network access setting.
- **Branding:** no competitor or third-party branding, watermarks or reference-site assets in the product.
- **Truthfulness:** label all sample data and media as sample or placeholder.
  - Report QA honestly, using the statuses `VERIFIED_PASS`, `FAILED`, `NOT_TESTED`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE`.
  - Report a failure as a failure.
- **Every change:** run lint, typecheck, build and the QA suite in §6. Refresh the affected screenshots in `design-handoff/genlixs/screenshots/`, and update the 01–05 docs and this file.
- **Client communication:** end each delivery with a short **Arabic** summary covering what changed, what was excluded and why, what is still blocked, and the open questions.

## 11. Open questions for the user

1. Which Vercel account should host the preview? Is `mbanaoui147-4280` theirs?
2. ~~Drive videos~~ — resolved in v2.2 (local hand-over).
3. Do they have the rights to use the Drive images and clip commercially? Which tool and model produced them?
4. Held-back images — v2.2 uses the bedroom editorial and the spiked hand on the showcase wall only. The two smoking portraits stay out. Does the client agree?
6. Are the brand names on the ad-style images invented (see §7, 4b)?
7. Should the remaining excluded files be edited to remove the brand marks, or replaced?
5. Should the repository stay public?
8. Backend: which payment gateway will the business use (Stripe does not support Morocco-based accounts)? Are the proposed partner terms (30-day window, 12-month renewals, 30-day hold, USD 50 threshold) approved? What are the approved prices per model and the credit packs/plans? Is the public model name "Veo 3.1" acceptable in the UI (catalog `public_name`)? (v3.1: display names now include the KIE model and tier, e.g. "GPT Image 2.5 Flare", "Veo 3.1 Fast"; confirm that real model names may be shown to customers.) Which markup and which models should launch first? Should Nano Banana 2.1 replace Nano Banana 2 after a side-by-side test?

---

## Appendix A — Google Drive references

- Root folder: https://drive.google.com/drive/folders/1mWgFhpT_1jC2fChoNkP_1tjwZEcn2HcA
- `IMAGES` folder id: `1tnk5myaj0KLW9Dfw3flW1NO8pGsrx_2R`, holding 19 `_min.webp` files (all fetched) and about 40 PNGs.
- `VIDEOS` folder id: `16sRT6HpjzERLl-WIEQyXpokD2pogGddb`, holding 27 mp4s.
  - Only `generation (19).mp4` (id `1sqQf9_PGOnRb8DwhUmydIx0nmSgu_UMO`, 4.18 MB) is 10 MB or less. It has been used.

**How to fetch:** use the Google Drive connector's `download_file_content` with a file id. It returns JSON `{content (base64), id, mimeType, title}`.
- Large results are saved to a tool-results file. Decode that file with a small Python script run under `python3 -I`, outside the repo.
- Call it a few files at a time: 6–8 parallel calls of 3–8 MB each once closed the connector with "message too large".

**PNGs of 10 MB or less, already fetched:**
- `1-T4L6B4yReTpEKAW-Y0PxBXqk3pkU8aG`
- `1kRoDI8Ol-q1PV_1DAapPKgSsEU4C_F1s`
- `1sv7z7IgRsXdsxE6YXYv0FVOgv0sVQ8d6`
- `1rnxX8c7u4MJjN_FkeO0IjENZ9S2W6i7l`
- `1-1hTBtM40r4Erpel3EriLVz4RyHsrJBh`
- `1IoU4AgviFVNnnvCHp-BSyZh6L3xQiCR_`

Only two of them are used: the drive-thru and the sofa.

**PNGs whose fetch failed** (the connector closed the connection; retry them one at a time):
- `1ESCxTINUApq5eQb98TI-6CknFp-AF9fB` (8.5 MB)
- `1NP9FBbXlHVk0o6LrtqUSuoYr2gvH8uT8` (6.6 MB)

**PNGs of 10 MB or less, not fetched yet:**

```
1Y3ZvSKIW4J3yEJ38By1GiPgPCS1-bXNu 1x5vzrbqjccVdxfhixibHVMAwz1juZi3X 1Q3h-WFe-Gk8fCPoxkLCV-yFq-w2tCdl9
1AFCCpiDbeihDGlPKtzyb0OYr5dnhT4df 1S0IA3DECP4ADDiqA_tvJ_KmChfVUia4b 1TxFcRBZE9Pz0BujDDp5wYj963oq2EqOD
1xiv2aGqvCdKdaBKLr65V4kqEQVbKrRbC 16h7MyW6iTBFA4rKM-dgfCsnU6Y7GlKCU 1hEbOlOp8JlxvVz9WYq03AUtkk56P_M9q
1gsYrROM2ZHvw6H44WEoKpYf8-mQejR7j 1pb1mNaCe-l1jFq-qXPT-Dj-74ix0C81D 1cQepx9IPyZcJd9Lnajhf8DtttvdjCprt
1n2hlzqLWduhwdHCVcP1QalsDq-Icu04X 1hrzJ-T6vNLOLJ6hQRM7IRIcbvyHc8GbH 1fJXmeLEn3b11lCkKdVSD74bEw2dbKnNy
1h-EygNWDRZk9Vug6o3RJLaDws6mLTlVr 1u8rJB4cTV96OHW6bLvHzLMRrPP3_Iiq0 1pagTzRkD9FCOo1qNMHwyBBM1_XT2_Ril
1A0bxz56a5fqYTcai06qh_bTVPqGHzsZH 173s_NHyIddyiu_bwYj0lO0zFYjXbRt5Z 1HFhz4zRvmwWlc1LIK4k3gGiPOirnDSBu
1NUvjZbiCkE7VXu7Z4cBQo3jEb_a7uY0n 1mfnSH1mhlVlQEJ01QITGXI74GA72-AQs 1FsONlr0w0JatlDl-M_U-dH6xCKcSAiBe
1UgIt4IYQflrHwU9bYbXRHyw87UdsEKV7 1UWJxCxAfNznwDaXbBggT8Y0rPR9EFiip 16FsEzWvh10Nryqcq-8PyMCBY6f8Mq11y
18yjaCvVm3IW5LilNOupEb54BApx1CMh7 1MKXiqkEjJnjiGO_i5_PjNA7Ziu61kIIu 19WyI_x6jT1X9qgUxae0oU2Yv7I_hyoTk
14bysYcZjgzAOeL8w8B-AZPS_5aBiX9T7 1VZwwOyzfqKtUHvRqVr-td7PWE2ax_UUB
```

**PNGs over 10 MB:** 9 files. They cannot be fetched through the connector.

**Processing:** resize images with `python3 -I brand/client_media.py <webp_dir> <png_dir> public/media/client` and edit its `PICK` list. Re-encode videos with the ffmpeg commands in that script's docstring.
