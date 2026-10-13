# 01 · Client brief analysis — Genlixs

## 1. Project snapshot

| Item | Value |
| --- | --- |
| Client / product | Genlixs — AI creation platform for images, reference-image edits and short videos |
| Brief | *Genlixs — Website and Product Design Guide* v1.0, 13 Oct 2026 (Markdown + 32-page PDF) |
| Deliverable named by the brief | Design brief and execution guide for four surfaces: public website, customer studio, admin console, affiliate portal (§Header, §18) |
| Delivered in this run | Working, responsive Next.js design preview of all four surfaces with simulated data, plus this handoff set |
| Repository | `lonadonia/Genlixs` (GitHub, **public**), branch `claude/nice-curie-ispn6l` |
| Phase | Design / prototype. Backend, payments, auth and payouts are explicitly not built (§16: "Do not treat static mockups as proof of API … functionality") |

## 2. Verified sources

| Source | Status | Notes |
| --- | --- | --- |
| `Genlixs_Design_Guide_EN.md` | Read in full | Primary source of truth for this work |
| `Genlixs_Design_Guide_EN.pdf` (32 pp.) | Pages 1–23 viewed; 24–32 mirror the Markdown | Branded schematics on pp. 11, 14, 18, 21 used for hierarchy only |
| `Logo.zip` | Extracted and inspected | `Logo-white.png`, `logo-black.png` (RGBA), `Untitled-1.png`, `logo-fullwhite.png` (RGB, baked `#040A19`), all 21,627 × 4,487 px — matches §03 |
| `Genlixs_Project_Blueprint_v2.md` (v2.1) | **NOT SUPPLIED** | Governs capabilities, pricing, financial algorithms, permissions. Every dependent value is a labelled placeholder |
| `image.png` (palette) | NOT SUPPLIED | Hex values taken from guide §04, which states they were sampled from it |
| Pollo / Higgsfield screenshots and sites | NOT SUPPLIED / not used | The guide already records the reference analysis (§02); no reference assets, copy or branding were reproduced |

## 3. What the client actually wants

- **Objective (§01):** a recognisable Genlixs experience where visitors understand the product by seeing useful work and a clear creation entry point; customers focus on prompt and result; operators and affiliates understand operational and financial state "without interpretation".
- **Tone:** usability of a creation console + confidence of an editorial media gallery; suitable for creators and businesses.
- **Principles:** next action beside the information needed to take it; artwork gets space while settings, pricing and status stay readable; one brand and component system with role-specific density.
- **Success definition:** "a usable creation journey and a coherent visual identity. A striking hero alone does not satisfy this brief."

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
| REQ-001 | CONSTRAINT | §03 | Use supplied wordmark; white on dark, dark on light; never redraw/stretch | MUST | `components/brand/logo.tsx`, exports in `public/brand/` (trim + resize only) | Verified |
| REQ-002 | EXPLICIT | §03 | Optimised delivery exports; never ship the 97 MP masters; preserve masters | MUST | 480/960 px PNG+WebP exports; masters in `brand/source/` (not served) | Verified |
| REQ-003 | EXPLICIT | §03 | Header wordmark 160–184 px desktop, 136–152 px mobile, ≥ 8 px clear space | SHOULD | 168 px / 136 px with 8 px padding | Verified |
| REQ-004 | EXPLICIT | §03 | Collapsed rail / favicon use the extracted supplied symbol | SHOULD | `genlixs-symbol-*.png`, `app/icon.png`, `favicon.ico`, `apple-icon.png` | Verified |
| REQ-005 | CONSTRAINT | §04 | Exact core colours `#1C5DFF #ADDB5A #763DFF #FE5511`; blue owns primary actions | MUST | `globals.css` `@theme` tokens; all primary buttons blue | Verified |
| REQ-006 | EXPLICIT | §04 | Neutral + semantic token table | MUST | `--color-canvas … --color-warning` | Verified |
| REQ-007 | EXPLICIT | §04 | Contrast rules: no small text in base blue/violet on dark; dark text on lime/orange | MUST | Derived tints `#A9C1FF`, `#C4A6FF`, `#FF7A45`, `#FF8FA0` for dark text; ratios in 02 | Verified |
| REQ-008 | CONSTRAINT | §04 | Decoration limited: one subtle glow / branded divider / editorial accent | MUST | One blue→violet glow behind composer; "layer-stack" accent; 4-colour brand rule | Verified |
| REQ-009 | EXPLICIT | §05 | Inter; type scale; body 1.45–1.65, headline 1.05–1.15 | MUST | Self-hosted Inter Variable; h1 32→56 px, line-height 1.08 | Verified |
| REQ-010 | EXPLICIT | §05 | Spacing scale, 32–48 px desktop gutters, 16–20 px mobile, 64–96 px public sections, 44–48 px controls | SHOULD | `px-4 sm:px-6 lg:px-10`, `py-16 lg:py-24`, `h-11/h-12` controls | Verified |
| REQ-011 | EXPLICIT | §05 | Radii 10–12 / 16 / 20 px; fine borders; shadows only on dropdowns/dialogs/light cards | SHOULD | `--radius-control/media/dialog`; `--shadow-pop/lift` | Verified |
| REQ-012 | EXPLICIT | §06 | Public top nav Tools, Examples, Pricing, Partners, Help + Sign in / Create | MUST | `public-header.tsx` | Verified |
| REQ-013 | EXPLICIT | §06 | Customer rail: Overview, Image, Edit, Video, Library, Credits, Billing, Support; credits, notifications, account | MUST | `studio-shell.tsx` | Verified |
| REQ-014 | EXPLICIT | §06 | Rail 224–240 px; collapsed ≈ 72 px with labels/tooltips; mobile drawer keeps names | MUST | 232 px ≥ 1280, 72 px 1024–1279 with tooltips + aria-labels, labelled drawer < 1024 | Verified |
| REQ-015 | EXPLICIT | §06 | "Customer studio / Partner portal" switch; never combine cash earnings and credits | MUST | Switch in both headers; balances are separate everywhere | Verified |
| REQ-016 | EXPLICIT | §06 | Admin role-gated and visually explicit | MUST | Role badge in rail; role-dependent actions (prototype role switch) | Verified (simulated) |
| REQ-017 | EXPLICIT | §07 | 72 px header; eyebrow; headline "Turn your ideas into images and videos."; sentence "Create images, edit a reference, or generate a short video in one workspace." | MUST | `(public)/page.tsx` hero — copy verbatim | Verified |
| REQ-018 | EXPLICIT | §07 | 720–880 px composer: Image / Edit image / Video tabs, 100–160 px prompt, reference slot, settings row, action; Image default | MUST | `composer.tsx` (max-w 880 px, 112–132 px prompt) | Verified |
| REQ-019 | EXPLICIT | §07 | Guest action "Open image/video studio"; draft saved before sign-in; no invented price for guests; studio shows "Generate for N credits" | MUST | Draft in `demo-store`; `/sign-in?next=` | Verified (FLOW-1) |
| REQ-020 | EXPLICIT | §07 | Guest reference action asks to sign in, retains prompt; never implies anonymous upload | MUST | Edit tab: "Sign in to add reference" | Verified |
| REQ-021 | EXPLICIT | §07 | Media rail: featured output, edit comparison, video example; model/tool info; "Use this prompt" | MUST | Hero "Curated examples" rail | Verified |
| REQ-022 | EXPLICIT | §07 | Section order: header, creation stage, featured gallery, prompt-to-result, use cases, before/after + motion, four steps, model cards, price preview, partner invitation, FAQ, footer | MUST | Same order in `(public)/page.tsx` | Verified |
| REQ-023 | EXPLICIT | §07 | Layouts reflect content; no repeated three-card pattern | SHOULD | Asymmetric gallery, tabbed story, scroll row, wide comparison, joined step strip, tool columns, contained pricing block | Verified |
| REQ-024 | EXPLICIT | §07 | 16:9 / 3:2 / 9:16 frames, text below media, hover + touch actions, poster + explicit playback, no autoplay audio | MUST | `MediaFrame`, native `<video controls preload="none">` | Verified |
| REQ-025 | EXPLICIT | §07 | Home responsive behaviour at 1024 / 768 / 390 / 360 | MUST | Nav collapses < 1024; one featured card < 640 | Verified |
| REQ-026 | EXPLICIT | §08 | Overview: "What would you like to create?", draft card, active tasks, recent outputs, credit badge; no revenue charts | MUST | `overview.tsx` | Verified |
| REQ-027 | EXPLICIT | §08 | Studio: ≈ 224 nav / 360 settings / canvas; cost + Generate at the bottom of settings, visible | MUST | `workspace.tsx` sticky price/action block | Verified |
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

## 6. Current experience audit

No existing site or code was supplied; the repository was empty (`git log`: no commits). Nothing to preserve.

## 7. Reference analysis

The guide's own analysis (§02) is adopted: creator-console composer + curated, reusable examples; public top nav, customer rail. No reference visuals were available in this session, and none were reproduced.

## 8. Assumptions, contradictions and missing inputs

| ID | Assumption | Confidence | Risk if wrong | Validation |
| --- | --- | --- | --- | --- |
| A-001 | Model slots are named by capability ("Standard image", "Short video"…) until the blueprint catalog is supplied | High | Low — single data file | Replace `MODELS` in `catalog.ts` |
| A-002 | A monthly plan exists alongside credit packs (guide §08 mentions subscription cancel flow) | Medium | Billing page may be unnecessary | Confirm against blueprint |
| A-003 | USD is the display currency for samples | Medium | Formatting only | Confirm launch currencies |
| A-004 | Admin roles: Operations admin, Support agent, Finance approver; support cannot adjust credits; only finance approves payouts; approver ≠ preparer | Medium | Permissions copy | Confirm against blueprint permissions |
| A-005 | Delayed = running > expected duration + 4 s in the simulation | Low (simulation only) | None in production | Production uses observed p95 data (§08) |
| A-006 | Payout threshold $50 and 72 h payout-detail cooldown are sample policy | Low | Copy | Replace with approved terms |

Contradiction noted: §07 asks the composer to include an "optional reference slot", while §07 also says the guest reference action must request sign-in. Resolved by showing the reference slot only on the Edit tab (where a reference is required) with a sign-in action, avoiding an implied anonymous upload.

## 9. Dependencies and risks

- **Blueprint v2.1 missing** — every financial number, price and permission is a placeholder. High risk if the preview is mistaken for real terms; mitigated by persistent "Design preview / Sample data" labelling and `noindex`.
- **Public repository** — the repo is public, so the supplied logo masters and this handoff are publicly visible. Make it private if that is not intended.
- **Concept media** — procedural artwork, not model output; must be replaced before launch.

## 10. Immediate recommendation

Approve the design system and journeys in this preview, then (1) supply the blueprint, approved media, legal copy and pricing, and (2) replace `demo-store.ts` / `admin-data.ts` with authenticated services while keeping the component layer.
