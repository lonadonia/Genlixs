# 03 · Claude Code master prompt — Genlixs (continue from the design preview)

Paste this into a fresh Claude Code session opened on the `lonadonia/Genlixs` repository.

---

You are continuing the Genlixs project: an AI platform where customers create images, edit a reference image, and generate short videos with credits, plus an admin console and an affiliate (partner) portal. A complete, responsive **design preview** already exists in this repository. Your job is to keep it working, extend it, and — when the services exist — replace its simulated data layer with real ones. **Write and run code; do not stop at plans or documents.** Commit and push to the authorised branch and keep the project Vercel-ready.

## 1. Read first (source of truth, in priority order)

1. `Genlixs_Project_Blueprint_v2.md` (English v2.1) — capabilities, financial behaviour, privacy, permissions. **Not in the repo yet.** If it is still missing, do not invent prices, rates, model names or financial rules; keep placeholders data-driven and labelled.
2. The *Genlixs Website and Product Design Guide v1.0* plus the client's **v2 brand revision** (new logo package, palette Night `#0F1212` · Lime `#E1FF01` · White · Electric Blue `#253FF6`, three reference screenshots) — summarised in `design-handoff/genlixs/01_CLIENT_BRIEF_ANALYSIS.md` (requirement matrix REQ-001 … REQ-064) and `02_CREATIVE_DESIGN_BLUEPRINT.md` (v2 tokens, contrast table, components, page specs). Where v2 and the guide differ, v2 wins (it is the later client instruction).
3. `design-handoff/genlixs/04_QA_ACCEPTANCE_CHECKLIST.md` and `05_GITHUB_VERCEL_HANDOFF.md` for the current verified state.
4. `README.md`, `AGENTS.md` (Next.js 16 notes: read `node_modules/next/dist/docs/` before using unfamiliar APIs).

Run `git status`, `git log --oneline -5`, `git remote -v` and read `package.json` before editing. Never discard or overwrite uncommitted work.

## 2. Stack and guardrails

- Next.js 16.3.8 App Router (Turbopack), React 19.2, TypeScript, Tailwind CSS 4 (`src/app/globals.css` `@theme` tokens), Inter Variable (`@fontsource-variable/inter`) for UI and Archivo Variable (`@fontsource-variable/archivo/wdth.css`, `.font-display`) for headlines, Lucide icons. Keep this stack. `next/image`'s `priority` is deprecated in Next 16 — use `loading="eager"` (the `Logo`/`MediaFrame` `priority` props map to it).
- Do not add a backend, auth provider, payment provider or database unless the user authorises it and supplies credentials via environment variables. Never commit secrets; extend `.env.example` with names only.
- Never force-push, rewrite history, or deploy to production. Preview deployments only.
- Keep `robots: noindex` until real content and pricing are approved.

## 3. Immovable requirements (from the guide)

- **Brand (v2):** use only the supplied v2 logo exports in `public/brand/` via `components/brand/logo.tsx` (`header` white mark + wordmark on dark, `dark` on light, `mono` on colour/photos). Never redraw, recolour, stretch or rotate. Masters live in `brand/source/` and must not be served; re-export with `brand/export_logo.py`.
- **Colours (v2):** electric blue `#253FF6` is **the primary colour** (client instruction) — every primary button (`Button` variant `primary`), selected tab, active navigation item, announcement bar and brand band; white text on it (6.7 : 1). On dark, never set text in raw `#253FF6` (2.8 : 1): use `brand-blue-bright` `#5165F8` for display accents/icons (large text only) and `text-link` `#A9B4FF` for small text. Lime `#E1FF01` is a sparing secondary accent (hero underline, signal dots, success, focus ring on dark) and is never used on white (1.1 : 1). Token table and ratios: 02 §3.
- **Decoration (v2, client-directed):** electric glows behind creation areas, one drawn lime underline in the hero (the only large lime element), capsule media columns, brand rule. No rainbow borders, particles, parallax or sound. Any auto-moving region must sit in `MotionRegion` (visible Pause/Play, WCAG 2.2.2) and stop under reduced motion.
- **Media:** every visual comes from `src/lib/media.ts`. Placeholders carry `placeholder: true` and show the "Placeholder" tag; approved client media replaces `src`/`poster`, sets `placeholder: false` and records `credit`. Optional muted previews use `AutoplayVideo` / `HoverVideo` (visible-only, reduced-motion and save-data aware); story/result clips use native controls.
- **Public homepage section order:** header → creation stage (hero: eyebrow, “Turn your ideas into images and videos.”, “Create images, edit a reference, or generate a short video in one workspace.”; then the `#create` composer + curated rail) → featured gallery → prompt-to-result → use cases → before/after + motion → four steps → (electric band) → model capability cards → price preview → partner invitation → FAQ → (closing band) → footer.
- **Guest flow:** the composer saves a draft; guest action reads “Open image studio” / “Open edit studio” / “Open video studio”; no price is shown to guests; sign-in returns to the studio with the draft intact; inside the studio the action reads “Generate for N credits” from the quote.
- **Credits:** Available, Reserved and Used-this-period are always separate. Generate reserves; a saved file charges; failure or pre-submission cancel returns credits. Payment shows “Verifying payment” until confirmed — never success from a redirect alone. After top-up the user returns to the unchanged draft and must press Generate again.
- **Job states:** waiting, submitting, generating, saving, ready; delayed (“This is taking longer than usual”); failed (cause + whether credits were returned); unconfirmed submission (“We're checking whether the request was accepted” — never invite a blind resubmit). No fake percentage bars.
- **Admin:** dark rail, light canvas, white panels; metric cards define their numbers and link to records; tables right-align money, have copyable IDs, labelled actions, visible pagination, preserved filters; financial actions require reason, preview of effect and confirmation, are disabled with a stated reason when role/state disallows, surface stale data first; uncertain transfers stay reserved; “Mark paid” is never a toggle.
- **Partner:** main link first with Copy; performance counts separate from money; Pending / Available / Reserved / Paid never summed; holds show reason and date; disabled payout explains the unmet condition; referrals masked.
- **Content honesty:** no competitor assets, fabricated testimonials or counts, unapproved percentages or “unlimited” claims. Temporary media must carry the “Concept media” tag.

## 4. Where things live

- Pages: `src/app/(public)`, `src/app/sign-in`, `src/app/studio`, `src/app/admin`, `src/app/partner`.
- Components: `src/components/{ui,public,studio,admin,partner,console,brand}`; `motion-region.tsx` for pausable motion; `public/hero.tsx`, `public/composer.tsx`; studio Home composer in `studio/overview.tsx`; demo-only media picking in `studio/demo-helpers.ts`.
- Data seam: `src/lib/catalog.ts` (tools, model slots, demo quote, examples), `src/lib/packs.ts`, `src/lib/media.ts` (media manifest), `src/lib/demo-store.ts` (browser-only simulation), `src/lib/admin-data.ts` (sample records). Replace these with service clients rather than editing components.
- Brand tooling: `brand/export_logo.py` (logo exports), `brand/placeholder_renders.py` (v2 placeholder stills + loop; `python3 brand/placeholder_renders.py <out_dir> all`), `brand/concept_media.py` (v1 placeholders).

## 5. Typical next tasks

1. When the blueprint arrives: replace `MODELS`, `demoQuote`, `PACKS`, partner thresholds and admin records with typed, server-fetched data; keep labels and states.
2. Integrate real auth (draft must survive sign-in), quotes (versioned, with expiry), job submission/polling (phases from the server), ledger, payments (webhook-confirmed), payouts (preparer ≠ approver).
3. Build remaining screens with the existing shells: admin customers, models, pricing, payments, credits, affiliates, commissions, support, audit; auth verification/recovery; tool and model detail pages.
4. Replace placeholder media with validated outputs — first the client's Drive folder (REQ-063) once it is reachable (allow `drive.google.com`, `drive.usercontent.google.com` and `*.googleusercontent.com` in the environment's network access, or have the client upload curated files ≤ 10 MB each); record rights, tool, model and settings per item in `media.ts`.

## 6. Verification you must run and report

- `npm run lint`, `npm run typecheck`, `npm run build` — report exit status.
- Browser checks (Playwright is preinstalled in this environment at `/opt/node-tools/node_modules/playwright`) at **1440, 1024, 768, 390, 360 px**: no horizontal page overflow, no console errors, focus visible, dialogs restore focus, reduced motion respected.
- Re-run the journeys listed in `04_QA_ACCEPTANCE_CHECKLIST.md` §3 and update their status with evidence. Mark anything you could not run as `NOT_TESTED`.
- Optional: axe-core WCAG 2.x A/AA scan of every route.

## 7. Delivery

- Commit with descriptive messages; push with `git push -u origin <branch>` to the branch you were given (currently `claude/nice-curie-ispn6l`). Do not open a PR unless asked.
- Vercel: the project needs no `vercel.json`. A preview deploys from any pushed branch once the repo is imported in Vercel. Only report a preview URL you actually opened.
- Final report: files changed, commands + results, REQ status changes, repo URL / branch / commit SHA, preview URL if verified, and remaining blockers.
