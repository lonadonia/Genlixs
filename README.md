# Genlixs — design preview

A coded, responsive design preview of the Genlixs AI image / edit / short-video platform, built from the **Genlixs Website and Product Design Guide v1.0** (13 Oct 2026) and restyled to the client's **brand v2** (new logo package; palette Night `#0F1212`, Lime `#E1FF01`, White and **Electric Blue `#253FF6` as the primary colour**; reference-led hero and creation dashboard). It covers the four surfaces the guide defines:

| Surface | Routes | What it shows |
| --- | --- | --- |
| Public website | `/`, `/help`, `/status`, `/terms`, `/privacy`, `/acceptable-use`, `/partners/apply`, `/sign-in` | Headline hero with capsule media columns, lit composer, bento gallery and the guide's section order; guest draft → sign-in → studio hand-off; partner application |
| Customer studio | `/studio`, `/studio/image`, `/studio/edit`, `/studio/video`, `/studio/library`, `/studio/credits`, `/studio/billing`, `/studio/support` | Floating rail, Home with tool tabs and a glowing composer (exact cost beside a round Generate), capability-driven settings, credit reservation, real job phases, delayed / failed / unconfirmed states, results, library, top-up with payment verification |
| Admin console | `/admin`, `/admin/jobs`, `/admin/jobs/[id]`, `/admin/payouts` | Operations overview, filterable jobs table, job investigation with a guarded credit-return dialog, payout batch approval with role separation |
| Partner portal | `/partner`, `/partner/links`, `/partner/referrals`, `/partner/commissions`, `/partner/payouts`, `/partner/resources`, `/partner/settings` | Main link first, separate performance counts and money balances, link builder, payout readiness, uncertain transfers kept reserved |

> **This is a design preview, not the platform.** Sign-in, generation, payments, sharing and payouts are simulated in the browser (`src/lib/demo-store.ts`). Examples are procedurally rendered **placeholder media** (`brand/placeholder_renders.py`, `brand/concept_media.py`), not model output — the client's Drive media could not be fetched from the build environment and can be swapped in through `src/lib/media.ts`. Model names, prices and program terms are sample values pending the approved catalog and price version from `Genlixs_Project_Blueprint_v2.md`, which was not supplied. Every surface says so in the UI.

## Stack

- Next.js 16.3.8 (App Router, Turbopack) · React 19.2 · TypeScript 5
- Tailwind CSS 4 with design tokens in `src/app/globals.css`
- Inter (variable, UI/body) and Archivo (variable width, display headlines) self-hosted via `@fontsource-variable/*` (SIL OFL 1.1)
- Lucide icons
- No backend, database or third-party services

## Commands

Requires Node.js ≥ 20.9 and npm.

```bash
npm install          # install from package-lock.json
npm run dev          # http://localhost:3000
npm run lint         # ESLint (flat config, next/core-web-vitals + typescript)
npm run typecheck    # route type generation + tsc --noEmit
npm run build        # production build
npm run start        # serve the production build
```

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | No | Absolute base URL for metadata / Open Graph image URLs. Defaults to `http://localhost:3000`. |

No secrets are used. See `.env.example`.

## Deploying to Vercel

The project uses Vercel's default Next.js settings — no `vercel.json` is needed.

1. In Vercel, **Add New → Project → Import** the `lonadonia/Genlixs` GitHub repository.
2. Framework preset: **Next.js** (auto-detected). Build command `next build`, output handled by Vercel. Install command `npm install`.
3. Optional: set `NEXT_PUBLIC_SITE_URL` for the Preview environment.
4. Every push to a non-production branch (for example `claude/nice-curie-ispn6l`) creates a **Preview Deployment**. Do not promote to production until the brief's open items below are resolved.

The site sets `robots: noindex` because it contains sample data.

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
public/brand/            web exports of the supplied v2 logo (no redraw)
public/media/concept/    temporary placeholder media (replace before launch)
brand/source/            the four supplied v2 logo masters, 20,171 × 4,487 px (not served)
brand/*.py               scripts that produced the logo exports and placeholder media
design-handoff/genlixs/  brief analysis, design blueprint, master prompt, QA evidence, delivery status
```

## Before production

- Replace `src/lib/demo-store.ts` and `src/lib/admin-data.ts` with the blueprint's authenticated services (auth, quotes, jobs, ledger, payments, payouts).
- Replace the model catalog, prices, pack values and partner terms with approved, data-driven values.
- Replace all placeholder media with validated Genlixs outputs (for example from the client's Drive folder) and record rights/settings for each in `src/lib/media.ts`.
- Supply approved legal text for the policy pages and a public support contact.

See `design-handoff/genlixs/` for the full requirement matrix, design system and QA evidence.
