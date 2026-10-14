# 01 · Client brief analysis — Genlixs

| Revision | Date | Inputs | Result |
| --- | --- | --- | --- |
| v1 | 13 Oct 2026 | Design Guide v1.0 (MD + PDF), `Logo.zip` (v1 masters) | First working preview of the four surfaces |
| **v2** | 13–14 Oct 2026 | New logo package (`logo.zip`), new 4-colour palette (follow-up note: **the primary colour must be `#253FF6`**), three reference screenshots (a full-page AI-video-site capture, the "REDNIT" NFT hero, an AI-creation dashboard), a Google Drive media folder | Brand v2 across all surfaces, reference-led homepage hero, lit composer, reference-led customer dashboard, refreshed admin/partner rail. Rows changed by v2 are marked **v2** below |
| **v2.1** | 14 Oct 2026 | Client follow-up (Arabic, with a screenshot of the hero columns): retry the Drive media; hero cards should follow the size of the image or video they hold, with corners that are neither sharp nor very round | 14 client images + 1 clip added (`CLIENT_MEDIA.md`); hero tiles now use each file's own ratio with 18 px corners |

## 1. Project snapshot

| Item | Value |
| --- | --- |
| Client / product | Genlixs — AI creation platform for images, reference-image edits and short videos |
| Brief | *Genlixs — Website and Product Design Guide* v1.0, 13 Oct 2026 (Markdown + 32-page PDF) |
| Deliverable named by the brief | Design brief and execution guide for four surfaces: public website, customer studio, admin console, affiliate portal (§Header, §18) |
| Delivered | Working, responsive Next.js design preview of all four surfaces with simulated data, plus this handoff set (v2 restyle on top of v1 behaviour) |
| Repository | `lonadonia/Genlixs` (GitHub, **public**), branch `claude/nice-curie-ispn6l` |
| Phase | Design / prototype. Backend, payments, auth and payouts are explicitly not built (§16: "Do not treat static mockups as proof of API … functionality") |

## 2. Verified sources

| Source | Status | Notes |
| --- | --- | --- |
| `Genlixs_Design_Guide_EN.md` | Read in full | Primary source of truth for this work |
| `Genlixs_Design_Guide_EN.pdf` (32 pp.) | Pages 1–23 viewed; 24–32 mirror the Markdown | Branded schematics on pp. 11, 14, 18, 21 used for hierarchy only |
| `Logo.zip` (v1) | Extracted and inspected — **superseded by v2** | `Logo-white.png`, `logo-black.png` (RGBA), `Untitled-1.png`, `logo-fullwhite.png` (RGB, baked `#040A19`), all 21,627 × 4,487 px |
| `logo.zip` (**v2**, current) | Extracted and inspected | `Website-header-logo.png`, `white-logo.png`, `Full white-logo.png` (RGB, baked near-black `#101211`), `dark-logo.png` (RGBA), all 20,171 × 4,487 px (90.5 MP). Exported by colour-to-alpha against the baked background, trim and resize only (`brand/export_logo.py`) |
| Palette image (**v2**) | Read from the attachment | Night `#0F1212` (swatch labelled "Lime" in the image — treated as a labelling slip), Lime `#E1FF01`, White `#FFFFFF`, Electric Blue `#253FF6`. Replaces the guide's §04 colours by client instruction |
| Reference screenshots (**v2**) | Viewed as attachments | (1) full-page capture of an AI video/image site — section rhythm, lit composer, bento tool cards, FAQ, closing video band; (2) "REDNIT" NFT hero — huge headline with one accent word and a hand-drawn underline, pill CTAs, capsule portrait columns, three icon features under a hairline; (3) AI-creation dashboard — floating rounded sidebar with groups and a bottom icon row, top-right upgrade/credits/account, centred title, tool pill tabs, large glowing composer with upload tile, settings chips, cost and round submit, promo cards. Used for layout and interaction patterns only — no assets, copy, logos or brand names reproduced |
| Google Drive folder (**v2**) | **PARTIAL** — 25 files of 10 MB or less fetched through the Drive connector; 14 images + 1 clip used (see `CLIENT_MEDIA.md`) | Direct `drive.google.com` access is still denied by the egress proxy (HTTP 403), and that was not worked around. The connector returns files of 10 MB or less, so 26 of the 27 videos (12–43 MB) and 9 large PNGs could not be fetched. Files with watermarks or third-party brand marks were excluded |
| `Genlixs_Project_Blueprint_v2.md` (v2.1) | **NOT SUPPLIED** | Governs capabilities, pricing, financial algorithms, permissions. Every dependent value is a labelled placeholder |
| `image.png` (v1 palette) | NOT SUPPLIED in v1 | v1 used guide §04 values; superseded by the v2 palette image |

## 3. What the client actually wants

- **Objective (§01):** a recognisable Genlixs experience where visitors understand the product by seeing useful work and a clear creation entry point; customers focus on prompt and result; operators and affiliates understand operational and financial state "without interpretation".
- **Tone:** usability of a creation console + confidence of an editorial media gallery; suitable for creators and businesses.
- **Principles:** next action beside the information needed to take it; artwork gets space while settings, pricing and status stay readable; one brand and component system with role-specific density.
- **Success definition:** "a usable creation journey and a coherent visual identity. A striking hero alone does not satisfy this brief."
- **v2 follow-up (client note, Arabic):** "the primary colour must be 253FF6" — electric blue is the main brand and action colour; lime stays only as a small secondary accent.
- **v2.1 follow-up (client note, Arabic, paraphrased):** "Try again now [the Drive media], plus this small change: these [hero cards] should follow the size of the video or image placed in them, with edges that are not sharp and not too rounded, like in the screenshot."
- **v2 request (client message, Arabic, paraphrased):** use the new logo package and palette; make the whole site more professional and beautiful, inspired by the attached site capture; model the hero on the attached hero image and the customer dashboard on the attached dashboard; use the images and videos in the Drive folder as visual inspiration for visitors.

## 4. Scope boundary

| In scope (built) | Out of scope / not built |
| --- | --- |
| All four surfaces' primary screens and states (see matrix) | Real auth, generation APIs, payment/payout providers, database |
| Guest draft → sign-in → studio prototype; quote → reserve → phases → result; top-up with verification; failure settlement; partner apply → link; admin investigation + guarded financial action; payout approval with uncertain transfer | Figma file (no Figma tooling in this environment; coded components and tokens delivered instead) |
| Tokens, components, responsive layouts, motion, accessibility | Arabic / RTL (guide: only "if Arabic is enabled"; not enabled) |
| Concept media clearly labelled temporary | Validated model outputs, approved prices, program terms, legal copy |
| | Admin customers / models / pricing / payments / credits / affiliates / commissions / support / audit screens (shown as "Later" in the admin rail) |
| | Auth verification, recovery and reset screens; dedicated tool-detail, examples and model-detail pages |

## 5. Requirements traceability matrix

Classification: `EXPLICIT` (stated in guide), `CONSTRAINT`, `DEPENDENCY`, `PROPOSED`. Status reflects evidence in `04_QA_ACCEPTANCE_CHECKLIST.md`.

| ID | Class | Source | Requirement | Priority | Implementation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| REQ-001 | CONSTRAINT | §03, **v2** | Use the supplied wordmark (now the v2 package); light on dark, dark on light; never redraw/stretch | MUST | `components/brand/logo.tsx` variants header / color / dark / mono; exports in `public/brand/` (colour-to-alpha, trim + resize only) | Verified |
| REQ-002 | EXPLICIT | §03 | Optimised delivery exports; never ship the 90 MP masters; preserve masters | MUST | 480/960 px PNG+WebP exports (≤ 53 KB); masters in `brand/source/` (not served) | Verified |
| REQ-003 | EXPLICIT | §03 | Header wordmark 160–184 px desktop, 136–152 px mobile, ≥ 8 px clear space | SHOULD | v2 wordmark is wider (4.87 : 1), so 150 px desktop / 128 px phone gives the same cap height as v1's 168 / 136 px; 6 px padding inside a 76 px header | Verified (adjusted for the v2 ratio) |
| REQ-004 | EXPLICIT | §03 | Collapsed rail / favicon use the extracted supplied symbol | SHOULD | `genlixs-symbol-tile-*.png` / `-color-*.png`, `app/icon.png`, `favicon.ico`, `apple-icon.png`, `opengraph-image.png` | Verified |
| REQ-005 | CONSTRAINT | §04 → **v2** | Exact core colours, now **Night `#0F1212`, Lime `#E1FF01`, White, Electric Blue `#253FF6`** (client v2 palette); **Electric Blue is the primary colour** (client note) | MUST | `globals.css` `@theme`: `brand-blue` fills every primary button, selected tab, active nav item, announcement bar and brand band (white text 6.7 : 1); `brand-blue-bright` `#5165F8` for display accents and icons on dark; lime only for the hero underline, signal dots, success states and the focus ring | Verified |
| REQ-006 | EXPLICIT | §04 | Neutral + semantic token table | MUST | Night-tinted neutrals `canvas … elevated`, `line`, `line-strong`; light `paper … rule-strong`; semantic tints | Verified |
| REQ-007 | EXPLICIT | §04, **v2** | Contrast: no text in raw electric blue on dark (2.8 : 1); dark text on lime | MUST | Accent headlines use `#5165F8` (4.1 : 1 on night, ≥ 3.5 : 1 in glow areas — large text only); small blue-family text uses `link` `#A9B4FF` (9.0–9.6 : 1); lime never used as text/graphic on white (1.1 : 1); ratios in 02 §3 | Verified (computed) |
| REQ-008 | CONSTRAINT | §04 → **v2** | Decoration limited (guide) vs. the client's v2 request for a richer, reference-led look | MUST | Client direction applied within limits: electric-blue glows behind the creation areas, one hand-drawn lime underline (hero), capsule media columns, brand rule; no particles, parallax, rainbow borders or sound | Verified (client-directed change) |
| REQ-009 | EXPLICIT | §05, **v2** | Inter; type scale; body 1.45–1.65, headline 1.05–1.15 | MUST | Inter Variable for UI/body; **Archivo Variable (expanded, OFL)** for display headlines to match the references' wide grotesk; hero h1 40 → 68 px, line-height 1.04 | Verified |
| REQ-010 | EXPLICIT | §05 | Spacing scale, 32–48 px desktop gutters, 16–20 px mobile, 64–96 px public sections, 44–48 px controls | SHOULD | `px-4 sm:px-6 lg:px-10`, `py-16 lg:py-24`, `h-11/h-12` controls | Verified |
| REQ-011 | EXPLICIT | §05 | Radii 10–12 / 16 / 20 px; fine borders; shadows only on dropdowns/dialogs/light cards | SHOULD | `--radius-control/media/dialog`; `--shadow-pop/lift` | Verified |
| REQ-012 | EXPLICIT | §06 | Public top nav Tools, Examples, Pricing, Partners, Help + Sign in / Create | MUST | `public-header.tsx` | Verified |
| REQ-013 | EXPLICIT | §06, **v2** | Customer rail: Overview, Image, Edit, Video, Library, Credits, Billing, Support; credits, notifications, account | MUST | `studio-shell.tsx`: grouped Create / Your work / Account (Overview is labelled "Home"), "New creation" action, balance card, bottom icon row (Partner portal, Help, Status); header Top up, credits, notifications, account | Verified |
| REQ-014 | EXPLICIT | §06 | Rail 224–240 px; collapsed ≈ 72 px with labels/tooltips; mobile drawer keeps names | MUST | Floating rounded rail: 236 px ≥ 1280, 72 px 1024–1279 with tooltips + aria-labels, labelled drawer < 1024 | Verified |
| REQ-015 | EXPLICIT | §06 | "Customer studio / Partner portal" switch; never combine cash earnings and credits | MUST | Switch in both headers; balances are separate everywhere | Verified |
| REQ-016 | EXPLICIT | §06 | Admin role-gated and visually explicit | MUST | Role badge in rail; role-dependent actions (prototype role switch) | Verified (simulated) |
| REQ-017 | EXPLICIT | §07, **v2** | Header; eyebrow; headline "Turn your ideas into images and videos."; sentence "Create images, edit a reference, or generate a short video in one workspace." | MUST | `public/hero.tsx` — copy verbatim in the reference-led layout (76 px header) | Verified |
| REQ-018 | EXPLICIT | §07, **v2** | 720–880 px composer: Image / Edit image / Video tabs, 100–160 px prompt, reference slot, settings row, action; Image default | MUST | `public/composer.tsx`: lit console (max-w 880 px), blue pill tabs, 104–120 px prompt, "+" reference tile on Edit, settings chips, blue action; prompt ideas below | Verified |
| REQ-019 | EXPLICIT | §07 | Guest action "Open image/video studio"; draft saved before sign-in; no invented price for guests; studio shows "Generate for N credits" | MUST | Draft in `demo-store`; `/sign-in?next=` | Verified (FLOW-1) |
| REQ-020 | EXPLICIT | §07 | Guest reference action asks to sign in, retains prompt; never implies anonymous upload | MUST | Edit tab: "Sign in to add reference" | Verified |
| REQ-021 | EXPLICIT | §07 | Media rail: featured output, edit comparison, video example; model/tool info; "Use this prompt" | MUST | "Curated examples" rail under the composer | Verified |
| REQ-022 | EXPLICIT | §07, **v2** | Section order: header, creation stage, featured gallery, prompt-to-result, use cases, before/after + motion, four steps, model cards, price preview, partner invitation, FAQ, footer | MUST | Same order; the creation stage is now hero + composer section; v2 adds an electric CTA band after the four steps and a closing video band before the footer | Verified |
| REQ-023 | EXPLICIT | §07 | Layouts reflect content; no repeated three-card pattern | SHOULD | Bento gallery (4-col, dense), tabbed story, scroll row, wide comparison, numeral step cards, tool columns, split pricing, partner split panel, accordion | Verified |
| REQ-024 | EXPLICIT | §07 | 16:9 / 3:2 / 9:16 frames, text below media, hover + touch actions, poster + explicit playback, no autoplay audio | MUST | `MediaFrame`; gallery "Use prompt" on hover/focus, always visible on touch; v2.2: every clip on the public site (hero, gallery, curated rail, story tab, use case, edit-and-motion, tool card, showcase wall) uses `ShowcaseVideo` — muted autoplay only while on screen, sound only after a click on the clip (REQ-069), one clip audible at a time, pauses offscreen and when the tab is hidden; reduced motion/Save-Data keep the poster until pressed; the closing band keeps its decorative muted loop (guide §07, §12) | Verified |
| REQ-025 | EXPLICIT | §07 | Home responsive behaviour at 1024 / 768 / 390 / 360 | MUST | Nav collapses < 1024; one featured card < 640 | Verified |
| REQ-026 | EXPLICIT | §08, **v2** | Overview: "What would you like to create?", draft card, active tasks, recent outputs, credit badge; no revenue charts | MUST | `overview.tsx` (studio Home): centred title, tool tabs, lit composer holding the saved draft with exact cost beside a round Generate, promo cards, active jobs, recent work; balance in rail + header | Verified |
| REQ-027 | EXPLICIT | §08 | Studio: ≈ 224 nav / 360 settings / canvas; cost + Generate at the bottom of settings, visible | MUST | `workspace.tsx`: 380 px floating settings panel with sticky price/action block | Verified |
| REQ-028 | EXPLICIT | §08 | Capability-driven settings; model picker explains purpose; cost change refreshes quote; demo vs personal output distinct | MUST | `ModelPicker`, `reconcileSettings`, "Updating quote…", "Example — not your output" | Verified |
| REQ-029 | EXPLICIT | §08 | Image: ratio rectangles, example + starter on empty canvas, zoom with Escape, original download, metadata panel | MUST | `RatioChips`, `ResultMedia`, `ResultDetails` | Verified |
| REQ-030 | EXPLICIT | §08 | Edit: reference first (thumb, name/type, Remove, Replace); labelled versions; slider + discrete buttons; no mask/layers | MUST | `ReferenceUploader`, `CompareSlider` | Verified |
| REQ-031 | EXPLICIT | §08 | Video: validated options only; poster-backed native player with controls and download | MUST | Capability-driven length/resolution/audio; native player | Verified |
| REQ-032 | EXPLICIT | §08 | Real phases, elapsed time, "taking longer than usual", failure explains returned credits, unknown submission must not invite resubmission, cancel only while allowed, no 99 % bar | MUST | `JobStatus` | Verified (FLOW-2/3) |
| REQ-033 | EXPLICIT | §08 | Library grid + filters; stable ratios; detail; share privacy dialog + revoke; delete keeps financial history; expired card | MUST | `library.tsx`, `result-view.tsx` | Verified (FLOW-5) |
| REQ-034 | EXPLICIT | §08 | Available / Reserved / Used separate; lots and ledger; top-up preserves draft; "Verifying payment"; no confetti; user re-initiates generation | MUST | `credits.tsx` | Verified (FLOW-4) |
| REQ-035 | EXPLICIT | §08 | Billing: plan, cycle, invoices, payment/refund status, provider-managed method, cancel flow explaining end of period | SHOULD | `billing.tsx` (sample plan) | Verified |
| REQ-036 | EXPLICIT | §08 | Mobile: Input / Status / Result; Generate beside quote above safe area, steps aside for keyboard; visible download/share | MUST | Tabs + sticky bar with `:has(:focus)` release | Verified (layout); keyboard behaviour NOT_TESTED on a real device |
| REQ-037 | EXPLICIT | §09 | Admin overview composition incl. metric definitions linking to records | MUST | `admin/page.tsx` | Verified |
| REQ-038 | EXPLICIT | §09 | Jobs list: filters, status totals, sortable, required columns, filters kept, pagination + count, empty state | MUST | `jobs-table.tsx` (URL state) | Verified (FLOW-6) |
| REQ-039 | EXPLICIT | §09 | Job detail: header/status, facts, event timeline, action panel | MUST | `job-detail.tsx` | Verified |
| REQ-040 | EXPLICIT | §09 | 44–52 px rows, money right-aligned, copyable IDs, labelled actions, contained table scroll, phone record cards | MUST | Admin and partner tables | Verified |
| REQ-041 | EXPLICIT | §09 | Guarded financial dialogs; disabled with reason; uncertain transfer stays reserved; no unguarded "Mark paid"; stale data surfaced first | MUST | Credit return dialog; payout approval; stale-data gate | Verified (FLOW-6/7) |
| REQ-042 | EXPLICIT | §09 | Remaining admin screens (customers, models, pricing, payments, credits, affiliates, commissions, support, audit) | COULD (this preview) | Rail entries marked "Later" | Not built |
| REQ-043 | EXPLICIT | §10 | Partner overview order 1–6; main link easiest to find; counts separate from money; holds have reason + date | MUST | `partner/page.tsx` | Verified |
| REQ-044 | EXPLICIT | §10 | Application/status, links with exact URL preview + copy, masked referrals, commission fields, payouts readiness, resources, settings separation | MUST | `/partners/apply`, `/partner/*` | Verified (FLOW-8) |
| REQ-045 | EXPLICIT | §10 | Partner mobile: copy link first, next payout action, stacked balances, cards | MUST | Mobile layout + payout hint in link card | Verified |
| REQ-046 | EXPLICIT | §11 | Component states table (buttons, prompt, model, ratio, uploader, credit summary, media card, badge, dialog, table, notice, skeleton) | MUST | See 02 §5 | Verified (see QA) |
| REQ-047 | EXPLICIT | §11 | Outcome-led copy; no raw supplier codes for customers; optimistic updates only for reversible non-financial actions | MUST | Favorite is optimistic; balances settle via store only | Verified |
| REQ-048 | EXPLICIT | §12 | Motion timings; reduced motion; no fake progress, no count-ups | MUST | 150 ms controls, 400 ms CSS scroll reveal, `prefers-reduced-motion` | Verified (KBD-8) |
| REQ-049 | EXPLICIT | §13 | 1440 / 1024 / 768 / 390 / 360 without clipping or page overflow | MUST | — | Verified (125 checks) |
| REQ-050 | EXPLICIT | §13 | Labels, focus, alt text, dialog focus management, no colour-only status, no drag-only, touch targets | MUST | axe + keyboard checks | Verified (automated + scripted) |
| REQ-051 | CONSTRAINT | §02, §14 | No competitor assets, fake testimonials, fabricated counts, unapproved percentages, unlimited claims; label temporary media | MUST | "Concept media" tags; "Sample data" badges; no rates shown | Verified |
| REQ-052 | EXPLICIT | §14 | Compressed media, reserved space, lazy secondary media, no full masters | SHOULD | `next/image`, `preload="none"` video, 320 KB clip | Verified |
| REQ-053 | EXPLICIT | §15 | Seven required prototypes | MUST | See 04 §3 | Verified (simulated) |
| REQ-054 | EXPLICIT | §15 | Full screen inventory (auth recovery, examples page, model/tool detail, etc.) | SHOULD | Primary flows only | Partially built |
| REQ-055 | EXPLICIT | §15 | Editable design file (Figma if chosen) | SHOULD | Not producible here; coded components + tokens + screenshots | BLOCKED_EXTERNAL |
| REQ-056 | DEPENDENCY | §13 | Arabic / RTL only if enabled | COULD | Not enabled | NOT_APPLICABLE |
| REQ-057 | DEPENDENCY | Blueprint | Real catalog, prices, credit rules, partner terms | MUST (for launch) | Data-driven placeholders in `catalog.ts`, `packs.ts`, `admin-data.ts` | BLOCKED_EXTERNAL |
| REQ-058 | EXPLICIT | **v2** client | Use the new logo package | MUST | v2 masters in `brand/source/`; header / color / dark / mono exports, symbols, favicon, OG image | Verified |
| REQ-059 | EXPLICIT | **v2** client | Use the new colour palette | MUST | Tokens in `globals.css`; v1 colours removed from all surfaces (grep-verified) | Verified |
| REQ-060 | EXPLICIT | **v2** client | Make the whole site more professional and beautiful, inspired by the attached site capture | MUST | Display typography, section eyebrows, bento gallery, lit composer, numeral steps, electric band, closing video band, rounded 24–32 px panels, refreshed info pages and sign-in | Verified (visual review) |
| REQ-061 | EXPLICIT | **v2** client | Hero modelled on the attached hero image | MUST | `public/hero.tsx`: oversized headline with an electric-blue accent phrase + drawn lime underline, blue "Start creating ↗" + outline "See examples ▷", three icon features under a hairline, three capsule columns scrolling in alternate directions (horizontal strip on phones) | Verified |
| REQ-062 | EXPLICIT | **v2** client | Customer dashboard modelled on the attached dashboard | MUST | `studio-shell.tsx` + `overview.tsx` (see REQ-013, 014, 026) | Verified |
| REQ-063 | EXPLICIT | **v2** client | Use the images and videos in the shared Drive folder as visual inspiration | SHOULD | v2.2: the client handed over the full `images` and `Videos` folders locally. 50 client images and 21 clips (sound kept, muted by default) are now in `public/media/client/`, used in the hero, showcase wall, gallery, story tabs, use cases, bands, tool cards, sign-in panel and studio. 21 images and 6 clips were excluded (watermark, creator credit, real brand marks, smoking); see `CLIENT_MEDIA.md`. Still open: rights and model records | Verified (rights record open) |
| REQ-064 | CONSTRAINT | WCAG 2.2.2 | Auto-moving content (> 5 s) needs a pause control | MUST | `MotionRegion` keeps a visible Pause/Play button on the closing band. **v2.2:** the client asked for the hero button to be removed (REQ-068), so the hero columns and phone strip rely on hover/focus pause and reduced motion only — a known gap against WCAG 2.2.2 for the hero, accepted by the client | Changed by client (REQ-068) |
| REQ-065 | EXPLICIT | **v2** client note | "The primary colour must be `#253FF6`" | MUST | See REQ-005; no lime primary buttons remain (grep); screenshots `01`, `07`, `11`, `18`, `23` | Verified |
| REQ-066 | EXPLICIT | **v2.1** client note | Hero media cards follow the aspect ratio of the image/video they hold; corners neither sharp nor pill-shaped | MUST | `MediaTile` in `hero.tsx` sets `aspect-ratio` from the manifest's width/height (desktop columns) or a fixed 176 px height with the width derived from it (phone strip); `rounded-[18px]` / `rounded-2xl`. Margins replace gaps so the −50 % marquee loop stays seamless | Verified (V2-15, V2-16) |
| REQ-067 | EXPLICIT | **v2.2** client | Put the images and videos from the `images` and `Videos` folders on the site | MUST | 36 new images and 20 new clips, plus the knight clip re-encoded with its sound, in `public/media/client/` and `src/lib/media.ts`. New showcase wall `#showcase` shows all 71 items (filters All / Videos / Images, first 24 then "Show all"); new clips also in the hero, gallery ("Giant astronaut in Midtown") and the "Social posts" use case | Verified (V2-5, V2-17, axe) |
| REQ-068 | EXPLICIT | **v2.2** client | Remove the Pause/Play button of the hero animation | MUST | `hero.tsx` no longer wraps the columns or the phone strip in `MotionRegion`; hover/focus still hold the columns, reduced motion stops them | Verified (V2-2, V2-3) |
| REQ-069 | EXPLICIT | **v2.2** client | Videos play on their own, professionally, without sound until the visitor clicks the video to turn the sound on | MUST | `ui/showcase-video.tsx`: muted loop while ≥ 25 % on screen; a click anywhere on the clip turns the sound on (pill shows "Tap for sound" → "Sound on" with level bars); every other clip mutes; leaving the screen pauses and re-mutes; clips without a sound track toggle play/pause | Verified (V2-5, V2-6, V2-17, V2-18) |
| REQ-070 | EXPLICIT | **v2.2** client | Clips sit among the hero images; add one more column on the right | MUST | Four hero columns with 9 clips among the stills; columns run to the viewport's right edge at every width (1920: 199 px columns; 1440: 139 px; 1024: 96 px); phone strip interleaves the same items | Verified (V2-4, V2-15) |

## 6. Current experience audit

No existing site or code was supplied; the repository was empty (`git log`: no commits). Nothing to preserve.

## 7. Reference analysis

v1 adopted the guide's own analysis (§02): creator-console composer + curated, reusable examples; public top nav, customer rail.

v2 adds the client's three screenshots. What was taken (patterns only) and what was deliberately not:

| Reference | Patterns adopted | Not adopted |
| --- | --- | --- |
| Full-page AI video/image site | Dark canvas with electric glow, lit composer as the main entry, tool cards with media headers, bento example grid, FAQ cards, closing video band, pill nav | Their logos, model names, thumbnails, copy, testimonials, user counts, "unlimited" or discount claims |
| "REDNIT" hero | Oversized headline with one accent phrase + hand-drawn underline, pill CTAs (filled + outline), capsule media columns, three icon features under a hairline | NFT content, illustration style, any artwork |
| AI-creation dashboard | Floating rounded sidebar with groups and a bottom icon row, top-right upgrade / credits / account, centred title, tool pill tabs, glowing composer with upload tile, settings chips, cost + round submit, promo cards | Their product names, models, promos and pricing |

## 8. Assumptions, contradictions and missing inputs

| ID | Assumption | Confidence | Risk if wrong | Validation |
| --- | --- | --- | --- | --- |
| A-001 | Model slots are named by capability ("Standard image", "Short video"…) until the blueprint catalog is supplied | High | Low — single data file | Replace `MODELS` in `catalog.ts` |
| A-002 | A monthly plan exists alongside credit packs (guide §08 mentions subscription cancel flow) | Medium | Billing page may be unnecessary | Confirm against blueprint |
| A-003 | USD is the display currency for samples | Medium | Formatting only | Confirm launch currencies |
| A-004 | Admin roles: Operations admin, Support agent, Finance approver; support cannot adjust credits; only finance approves payouts; approver ≠ preparer | Medium | Permissions copy | Confirm against blueprint permissions |
| A-005 | Delayed = running > expected duration + 4 s in the simulation | Low (simulation only) | None in production | Production uses observed p95 data (§08) |
| A-006 | Payout threshold $50 and 72 h payout-detail cooldown are sample policy | Low | Copy | Replace with approved terms |
| A-007 (v2) | The palette swatch labelled "Lime" with value `#0F1212` is the night/background colour (a labelling slip); lime is `#E1FF01` | High | Low — token rename only | Confirm with the client |
| A-008 (v2) | **Resolved by the client:** electric blue `#253FF6` is the primary colour on every surface; lime is a secondary accent | — | — | Confirmed by client note |
| A-009 (v2) | Archivo (expanded, OFL) is an acceptable display face beside Inter; the guide names only Inter | Medium | Low — one token (`--font-display`) | Confirm or supply the brand display face |

Contradiction noted: §07 asks the composer to include an "optional reference slot", while §07 also says the guest reference action must request sign-in. Resolved by showing the reference slot only on the Edit tab (where a reference is required) with a sign-in action, avoiding an implied anonymous upload.

## 9. Dependencies and risks

- **Blueprint v2.1 missing** — every financial number, price and permission is a placeholder. High risk if the preview is mistaken for real terms; mitigated by persistent "Design preview / Sample data" labelling and `noindex`.
- **Public repository** — the repo is public, so the supplied logo masters and this handoff are publicly visible. Make it private if that is not intended.
- **Client media** — supplied by Genlixs; rights, tool licence and model/settings still need confirming (`CLIENT_MEDIA.md`). **Placeholder media** (abstract loop, dune edit pair) are procedural renders, not model output, and must be replaced before launch.

## 10. Immediate recommendation

Approve the design system and journeys in this preview, then (1) supply the blueprint, approved media, legal copy and pricing, and (2) replace `demo-store.ts` / `admin-data.ts` with authenticated services while keeping the component layer.
