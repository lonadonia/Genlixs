# Genlixs — website, studio, admin and partner portal

> **Two modes.** Without Supabase configuration the site runs as the original **design preview** (everything simulated, clearly
> labelled). With the public Supabase values set it runs **live** against the real backend: Supabase Auth, credit wallet,
> generation jobs through KIE.ai, private files, billing, partner programme and admin console. Architecture: `docs/BACKEND.md`.
> What the owner still has to configure: `docs/SETUP_AND_ACTIVATION.md`. Models, pricing and KIE balance (owner guide):
> `docs/CATALOG_AND_PRICING.md`. Evidence and readiness: `docs/VERIFICATION.md`.

A coded, responsive design preview of the Genlixs AI image / edit / short-video platform, built from the **Genlixs Website and Product Design Guide v1.0** (13 Oct 2026) and restyled to the client's **brand v2** (new logo package; palette Night `#0F1212`, Lime `#E1FF01`, White and **Electric Blue `#253FF6` as the primary colour**; reference-led hero and creation dashboard). It covers the four surfaces the guide defines:

| Surface | Routes | What it shows |
| --- | --- | --- |
| Public website | `/`, `/help`, `/status`, `/terms`, `/privacy`, `/acceptable-use`, `/partners/apply`, `/sign-in` | Headline hero with client-media columns (each tile at its file's ratio), lit composer, bento gallery and the guide's section order; guest draft → sign-in → studio hand-off; partner application |
| Customer studio | `/studio`, `/studio/image`, `/studio/edit`, `/studio/video`, `/studio/library`, `/studio/credits`, `/studio/billing`, `/studio/support` | Floating rail, Home with tool tabs and a glowing composer (exact cost beside a round Generate), capability-driven settings, credit reservation, real job phases, delayed / failed / unconfirmed states, results, library, top-up with payment verification |
| Admin console | `/admin`, `/admin/jobs`, `/admin/jobs/[id]`, `/admin/payouts` | Operations overview, filterable jobs table, job investigation with a guarded credit-return dialog, payout batch approval with role separation |
| Partner portal | `/partner`, `/partner/links`, `/partner/referrals`, `/partner/commissions`, `/partner/payouts`, `/partner/resources`, `/partner/settings` | Main link first, separate performance counts and money balances, link builder, payout readiness, uncertain transfers kept reserved |

> **In preview mode** sign-in, generation, payments, sharing and payouts are simulated in the browser (`src/lib/demo-store.ts`). Most examples now use **client-supplied media**: 50 images and 21 clips in `public/media/client/`, recorded in `design-handoff/genlixs/CLIENT_MEDIA.md`. Clips play muted while on screen; a click on a clip turns its sound on. Their prompts and settings are prompt ideas written to match each file, not recorded prompts. The abstract loop and the dune edit pair are still procedural **placeholders**, tagged "Placeholder" in the UI. Model names, prices and program terms are sample values pending the approved catalog and price version from `Genlixs_Project_Blueprint_v2.md`, which was not supplied. Every surface says so in the UI.

## Stack

- Next.js 16.3.8 (App Router, Turbopack) · React 19.2 · TypeScript 5
- Tailwind CSS 4 with design tokens in `src/app/globals.css`
- Inter (variable, UI/body) and Archivo (variable width, display headlines) self-hosted via `@fontsource-variable/*` (SIL OFL 1.1)
- Lucide icons
- Backend (live mode): Supabase (Postgres + RLS + RPCs, Auth, private Storage, pgmq queues, Cron, pg_net, Vault) via
  `@supabase/supabase-js` / `@supabase/ssr`; Vercel route handlers and short workers; KIE.ai as the generation provider.
  Schema and business logic: `supabase/migrations/`; database tests: `supabase/tests/`.

## Commands

Requires Node.js ≥ 20.9 and npm.

```bash
npm install          # install from package-lock.json
npm run dev          # http://localhost:3000
npm run lint         # ESLint (flat config, next/core-web-vitals + typescript)
npm run typecheck    # route type generation + tsc --noEmit
npm run build        # production build
npm run start        # serve the production build
npm run test:contracts   # provider / webhook / safe-fetch / file-sniffing contract tests (Node test runner)
```

## Environment variables

All names, with placeholders, are in `.env.example` (guide §6). Only the two `NEXT_PUBLIC_SUPABASE_*` values are public;
everything else is server-only and entered in Vercel or an ignored `.env.local`. A missing value disables only the feature
that needs it, with an explicit "not available yet" answer — never a silent fake. `NEXT_PUBLIC_SITE_URL` (optional) sets the
metadata base URL.

## Deploying to Vercel

The project uses Vercel's default Next.js settings — no `vercel.json` is needed.

1. In Vercel, **Add New → Project → Import** the `lonadonia/Genlixs` GitHub repository.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`, output handled by Vercel. Install command `npm install`.
3. Optional: set `NEXT_PUBLIC_SITE_URL` for the Preview environment.
4. The existing Vercel project `genlixs` builds branch `claude/nice-curie-ispn6l` as production. With no environment
   variables it serves the design preview; follow `docs/SETUP_AND_ACTIVATION.md` to switch it to live mode.

The site sets `robots: noindex`; remove it when the live site launches on `genlixs.com`.

## Project map

```
src/app/(public)/        public site, help/status/policy templates, partner application
src/app/sign-in/         simulated sign-in that preserves the guest draft
src/app/studio/          customer studio (rail shell + pages)
src/app/admin/           admin console (dark rail, light data canvas)
src/app/partner/         partner portal
src/components/          ui primitives, public sections, studio, admin, partner, console shell
src/lib/catalog.ts       tools, capability-named model slots, demo quote, curated examples
src/lib/media.ts         media manifest (every image/clip; `placeholder` flag + credit for approved media)
src/lib/demo-store.ts    browser-only demo state: drafts, quotes, jobs, credits, payments
src/lib/admin-data.ts    sample operational and financial records
src/app/api/             live API (thin handlers over database RPCs), webhooks, internal workers
src/lib/{server,supabase,providers,media,jobs,billing,auth,live}/   backend modules (see docs/BACKEND.md)
src/components/live/     live versions of the studio, partner portal, admin console and public pricing
supabase/migrations/     versioned schema, RLS, RPCs, queues and cron (applied to the Supabase project)
supabase/tests/          database invariant tests (always rolled back)
tests/contracts/         provider and security contract tests
docs/                    backend architecture, activation steps, runbooks, verification evidence
public/brand/            web exports of the supplied v2 logo (no redraw)
public/media/client/     client-supplied images + clips with sound, muted by default (rights/model record to confirm)
public/media/concept/    temporary placeholder media (replace before launch)
brand/source/            the four supplied v2 logo masters, 20,171 × 4,487 px (not served)
brand/*.py               scripts that produced the logo exports, placeholder media and client-media resizes
design-handoff/genlixs/  brief analysis, design blueprint, master prompt, QA evidence, delivery status
```

## Before production

- Complete `docs/SETUP_AND_ACTIVATION.md` (Supabase Auth SMTP/URLs, Vercel variables, Vault worker secrets, owner bootstrap,
  KIE account, payment gateway, partner terms, domain) and the controlled checks in `docs/VERIFICATION.md`.
- In Admin → Models & pricing: test the models to offer, set prices (bulk markup above KIE cost or per model), publish them
  and enable the models; publish the approved packages and the partner agreement (all seeded as drafts / disabled).
- Confirm rights, tool licence, model and settings for each client file (`CLIENT_MEDIA.md`), and replace the remaining placeholders (abstract loop, dune edit pair) with validated outputs.
- Bring in the 26 Drive videos over 10 MB once they are compressed under 10 MB, or once Drive access is allowed in the environment's network settings.
- Supply approved legal text for the policy pages and a public support contact.

See `design-handoff/genlixs/` for the full requirement matrix, design system and QA evidence.
