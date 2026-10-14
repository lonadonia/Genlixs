# 04 · QA acceptance checklist — Genlixs design preview (brand v2)

All results below come from commands and scripted browser runs against the **production build** (`next build` + `next start`). The final run was on 14 Oct 2026, after the v2.2 follow-up: the client's full `images` and `Videos` folders added, clips autoplay muted with click-for-sound, hero Pause/Play button removed, fourth hero column added, showcase wall added.
- Environment (v2.2 run): Windows 11, Node 24.21, Chrome 155 via playwright-core 1.64 (`PLAYWRIGHT_PATH` / `CHROME_PATH`, see `qa-scripts/README.md`). Earlier runs: Linux, Node 22.22, Chromium via Playwright 1.56.
- Screenshots: `screenshots/01…26` (01, 03–06 refreshed and 25–26 added in v2.2). Scripts: `qa-scripts/`.
- Statuses: `VERIFIED_PASS`, `FAILED`, `NOT_TESTED`, `BLOCKED_EXTERNAL`, `NOT_APPLICABLE`.

## 1. Build and static checks

| ID | Check | Command | Result |
| --- | --- | --- | --- |
| QA-B1 | Lint | `npm run lint` | VERIFIED_PASS — exit 0, no warnings |
| QA-B2 | Types | `npm run typecheck` | VERIFIED_PASS — exit 0 |
| QA-B3 | Production build | `npm run build` | VERIFIED_PASS — exit 0, 64 pages generated (`/sign-in` and `/admin/jobs/[id]` dynamic) |
| QA-B4 | Dependency audit | `npm audit --omit=dev` / `npm audit` | Runtime: 0 vulnerabilities. Dev: 5 high, all in the ESLint toolchain (`eslint-config-next` chain). Unchanged from v1; the fix needs a breaking downgrade, so it is left for an upstream update |
| QA-B5 | Secrets | Tracked files reviewed; `.env*` ignored except `.env.example` (names only) | VERIFIED_PASS |
| QA-B6 | v1 colours removed | `grep` for v1 hex/rgb values and `brand-violet` / `brand-orange` across `src/` | VERIFIED_PASS — none |
| QA-B7 | Primary colour = `#253FF6` (client note) | `grep` for lime primary buttons; visual review of screenshots 01, 07, 11, 18, 23 | VERIFIED_PASS — primary buttons, selected tabs, active nav, banner and band use electric blue; lime remains only as a secondary accent |

## 2. Responsive and console

| ID | Check | Result |
| --- | --- | --- |
| QA-R1 | 27 routes × 1440 / 1024 / 768 / 390 / 360 px, horizontal page overflow (`scrollWidth − clientWidth`), signed-in state | VERIFIED_PASS — 0 of 135 |
| QA-R2 | Console errors / page errors during the same 135 loads | VERIFIED_PASS — 0 |
| QA-R3 | Visual review at 1440, 1280, 1024, 768, 390, 360 | VERIFIED_PASS — screenshots `01…24`. Fixed during review: (1) hero text column stretched by the phone image strip (grid `min-w-0`); (2) headline breaking "into" onto its own line (per-breakpoint sizes); (3) phone gallery play button colliding with the placeholder tag (moved, plus caption action on phones); (4) tablet gallery too tall (4:3 frames); (5) studio Credits/Billing overflowing on phones (block `main`); (6) Top up hidden on phones. v2.1 review: gallery crops re-balanced (landscape files in wide cells, the 4:3 clip in a near-square cell, object-position per file) |
| QA-R4 | Tables scroll inside a labelled, focusable region; phone uses record cards | VERIFIED_PASS |

## 3. Required prototypes and journeys (guide §15)

`flows.js`: 36 assertions — **36 passed, 0 failed, 0 console errors**. The library selector was tightened to `getByLabel('Status', { exact: true })` because the new rail has a "Service status" link.

| ID | REQ | Journey / assertion | Result |
| --- | --- | --- | --- |
| FLOW-1a–g | REQ-018–020 | Guest video prompt → "Open video studio" → no price → `/sign-in?next=/studio/video` → saved draft shown → field errors → studio restores the prompt with "Draft restored" | VERIFIED_PASS |
| FLOW-2a–h | REQ-027–029, 032 | Empty prompt blocked → quote refresh → "Generate for 8 credits" → Cancel while waiting → 8 reserved → "You can leave this page" → ready, 8 charged → Download original | VERIFIED_PASS |
| FLOW-3a–b | REQ-032 | Failure returns reserved credits · unconfirmed submission warns against generating again | VERIFIED_PASS |
| FLOW-4a–d | REQ-034 | Insufficient credits → top-up keeps draft → "Verifying payment" → credits only after confirmation → unchanged draft, nothing auto-generated | VERIFIED_PASS |
| FLOW-5a–c | REQ-033 | Library filter · detail dialog · Escape closes | VERIFIED_PASS |
| FLOW-6a–f | REQ-038–041 | Admin delayed filter, stale-data gate, guarded credit return, timeline, filters kept, support role blocked | VERIFIED_PASS |
| FLOW-7a–c | REQ-041 | Payout approval role gate, acknowledgement, uncertain transfer stays reserved | VERIFIED_PASS |
| FLOW-8a–c | REQ-044–045 | Application validation → acceptance → portal → exact link copied → payout readiness | VERIFIED_PASS |

`v2checks.js` (new in v2, extended in v2.1, reworked in v2.2): 18 assertions — **18 passed, 0 failed, 0 console errors**.

| ID | REQ | Assertion | Result |
| --- | --- | --- | --- |
| V2-1 | REQ-061 | Hero columns animate by default | VERIFIED_PASS |
| V2-2 | REQ-068 | Hero has no Pause/Play control (client request) | VERIFIED_PASS |
| V2-3 | REQ-064 | Hovering the hero columns holds them still | VERIFIED_PASS |
| V2-4 | REQ-070 | Hero has four media columns | VERIFIED_PASS |
| V2-17 | REQ-069, 070 | Hero clips play muted on load | VERIFIED_PASS — 5 playing at 1440 px, all muted |
| V2-18 | REQ-069 | Clicking a hero clip turns its sound on | VERIFIED_PASS — exactly 1 audible clip |
| V2-15 | REQ-066 | Hero tiles match the aspect ratio of the loaded image/video (within 2 %) | VERIFIED_PASS — v2.2: 29 of 48 tiles loaded and measured at 1440 px; worst deviation 0.33 % |
| V2-16 | REQ-066 | Hero tiles use 18 px corners, not pills | VERIFIED_PASS — all `18px` |
| V2-5–6 | REQ-024, 069 | Gallery clip ("Pup knight in the fog") plays muted once on screen; a click turns its sound on and every other clip stays muted | VERIFIED_PASS |
| V2-7–8 | REQ-048 | Reduced motion stops the marquee and keeps hero clips on their posters | VERIFIED_PASS |
| V2-9–13 | REQ-026, 062 | Studio Home title; empty prompt blocked; quality change updates the exact cost (4 → 6 credits); Generate from Home opens the image studio with the job running; Edit tab routes to the edit studio for the reference | VERIFIED_PASS |
| V2-14 | REQ-014 | Collapsed rail links keep accessible names | VERIFIED_PASS |

## 4. Accessibility

| ID | Check | Result |
| --- | --- | --- |
| QA-A1 | axe-core 4.10.3 (wcag2a/2aa/21a/21aa/22aa), 27 routes, signed-in, 1280 px | VERIFIED_PASS — 0 violations |
| QA-A2–A7 | `kbd.js`: skip link first, composer tabs with arrow keys, visible focus, mobile menu dialog + Escape + focus return, top-up dialog focus containment + restore, reduced motion disables reveal | VERIFIED_PASS — 8 / 8 |
| QA-A8 | Moving content has a visible pause control (WCAG 2.2.2) | VERIFIED_PASS (V2-1–3) |
| QA-A9 | Token contrast computed: text ≥ 4.5 : 1, large text and graphics ≥ 3 : 1, focus ring ≥ 3 : 1 against blue buttons (5.9 : 1) — see 02 §3 | VERIFIED_PASS (computed) |
| QA-A10 | Text over media at worst case (white pixel under the overlay) ≥ 4.5 : 1 (tags, chips, closing band) | VERIFIED_PASS (computed; the gallery chip overlay was raised from 55 % to 72 % to pass) |
| QA-A11 | Screen-reader listening test (VoiceOver / NVDA) | NOT_TESTED — no screen reader here |
| QA-A12 | 200 % zoom / long translated strings | NOT_TESTED |

## 5. Visual, content and brand

| ID | REQ | Check | Result |
| --- | --- | --- | --- |
| QA-V1 | REQ-001–004, 058 | v2 logo used unaltered (colour-to-alpha, trim, resize); symbol for collapsed rail, favicon, icons, OG | VERIFIED_PASS |
| QA-V2 | REQ-005, 059, 065 | v2 palette only; electric blue is the primary colour everywhere; lime limited to the underline, signal dots, success and focus | VERIFIED_PASS |
| QA-V3 | REQ-022 | Section order kept (plus the electric band and closing band) | VERIFIED_PASS |
| QA-V4 | REQ-017 | Headline and sentence verbatim | VERIFIED_PASS |
| QA-V5 | REQ-051 | Remaining placeholder media tagged "Placeholder"; studio results built from client files tagged "Sample"; gallery footnote and Help page say prompts are written to match the client files; sample numbers flagged; no testimonials, counts or "unlimited" claims | VERIFIED_PASS |
| QA-V8 | REQ-063 | Client media screened: files with a watermark or a third-party brand mark excluded (v2.2 local hand-over: 21 of 71 images and 6 of 27 clips excluded, listed in `CLIENT_MEDIA.md`); clips keep their sound track, muted by default | VERIFIED_PASS (contact sheets of every image and 4 frames per clip, zoomed on labels) |
| QA-V9 | REQ-063 | Text over the new media keeps contrast: sign-in panel gradient raised to 95 % under the headline (worst case: blue-bright 3.66 : 1 for large text, white 16.8 : 1); closing band keeps its 72 % overlay | VERIFIED_PASS (computed) |
| QA-V6 | REQ-024, 069 | Every public clip (rail, gallery, story tab, use case, edit-and-motion, tool card, showcase) plays muted only while on screen and motion is allowed; centred one by one, all 7 non-hero clips played | VERIFIED_PASS |
| QA-V10 | REQ-067 | Showcase wall: 24 cards first, "Show all 71" reveals 71, Videos filter shows 21; axe with motion on and the wall expanded: 0 violations | VERIFIED_PASS |
| QA-V7 | REQ-060–062 | Reference-led hero, homepage and customer dashboard reviewed against the three client screenshots | VERIFIED_PASS (visual review) |

## 6. Not covered / open

| Item | Status |
| --- | --- |
| Client media (REQ-063, 067) | In use: 50 images + 21 clips from the client's local hand-over. Rights, tool licence and model records still to confirm (`CLIENT_MEDIA.md`). Remaining placeholders in the brand palette are used and tagged |
| Hero motion control (REQ-064 vs REQ-068) | Client decision — the hero has no Pause/Play button; hover/focus pause and reduced motion remain. Not a full WCAG 2.2.2 pass for the hero |
| Page weight of the clips on slow connections; Lighthouse / Core Web Vitals | NOT_TESTED — clips load only when on screen (`preload="none"`), and Save-Data keeps posters |
| Real auth, generation, payments, payouts, persistence | BLOCKED_EXTERNAL — blueprint + services not supplied; simulated by design |
| Approved catalog, prices, partner terms, legal text | BLOCKED_EXTERNAL |
| Figma / editable design file | BLOCKED_EXTERNAL |
| Real-device keyboard behaviour of the mobile Generate bar; screen readers; 200 % zoom | NOT_TESTED |
| Remaining admin screens (REQ-042), auth recovery, tool/model detail pages (REQ-054) | Not built in this preview |
| Lighthouse / Core Web Vitals | NOT_TESTED |

## 7. Release readiness

Ready as a **design preview** for stakeholder review. Not ready for production until the external items in section 6 are resolved.
