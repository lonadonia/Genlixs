# 04 · QA acceptance checklist — Genlixs design preview

All results below come from commands and scripted browser runs executed on 13 Oct 2026 against the **production build** (`next build` + `next start`) in the delivery environment (Linux, Node 22.22, Chromium via Playwright 1.56). Screenshots in `screenshots/`. Statuses: `VERIFIED_PASS`, `FAILED`, `NOT_TESTED`, `BLOCKED_EXTERNAL`, `NOT_APPLICABLE`.

## 1. Build and static checks

| ID | Check | Command | Result |
| --- | --- | --- | --- |
| QA-B1 | Lint | `npm run lint` | VERIFIED_PASS — exit 0, no warnings |
| QA-B2 | Types | `npm run typecheck` | VERIFIED_PASS — exit 0 |
| QA-B3 | Production build | `npm run build` | VERIFIED_PASS — exit 0, 64 routes generated (static + SSG; `/sign-in` and `/admin/jobs/[id]` dynamic) |
| QA-B4 | Dependency audit | `npm audit` | 5 high advisories, all in the dev-only ESLint chain (`braces` via `eslint-config-next` → `fast-glob`); no runtime dependency affected. Fix requires a breaking `eslint-config-next` downgrade, so left as is — revisit when upstream updates |
| QA-B5 | Secrets | Manual review of tracked files; `.env*` ignored except `.env.example` (names only) | VERIFIED_PASS |

## 2. Responsive and console

| ID | Check | Result |
| --- | --- | --- |
| QA-R1 | 27 routes × 1440 / 1024 / 768 / 390 / 360 px: horizontal page overflow (`scrollWidth − clientWidth`) | VERIFIED_PASS — 0 of 135 checks overflow |
| QA-R2 | Console errors / page errors during the same 135 loads | VERIFIED_PASS — none |
| QA-R3 | Visual review at 1440 (all surfaces), 1024 (studio collapsed rail), 768 (home), 390 (home, studio, admin jobs, partner) | VERIFIED_PASS — see `screenshots/01…18`. Fixed during review: duplicate logo at < 640 px, nav crowding at 768 px, admin table cell wrapping, grid min-width overflow, sr-only spans escaping scroll regions |
| QA-R4 | Tables scroll inside a labelled, focusable region; phone uses record cards | VERIFIED_PASS |

## 3. Required prototypes and journeys (guide §15)

Scripted with Playwright (`flows.js`), 36 assertions, **36 passed, 0 failed, 0 console errors**.

| ID | REQ | Journey / assertion | Result |
| --- | --- | --- | --- |
| FLOW-1a–g | REQ-018–020 | Guest writes a video prompt → action reads "Open video studio" → no price shown → redirected to `/sign-in?next=/studio/video` → sign-in shows the saved draft → empty submit shows field errors → after sign-in the video studio shows the same prompt with a "Draft restored" notice | VERIFIED_PASS |
| FLOW-2a–h | REQ-027–029, 032 | Empty prompt blocked locally → model change refreshes quote → "Generate for 8 credits" → Waiting offers Cancel → 8 credits reserved → "You can leave this page" copy → "Your file is ready · 8 credits charged" → Download original link | VERIFIED_PASS |
| FLOW-3a–b | REQ-032 | Failure explains "We returned the 8 credits reserved" · unconfirmed submission warns not to generate again | VERIFIED_PASS |
| FLOW-4a–d | REQ-034 | Insufficient credits disables Generate with reason → top-up link keeps draft → "Verifying payment" (no instant success) → "600 credits added" only after confirmation → "Return to your draft" restores prompt and settings, nothing auto-generated | VERIFIED_PASS |
| FLOW-5a–c | REQ-033 | Library status filter · result dialog opens · Escape closes | VERIFIED_PASS |
| FLOW-6a–f | REQ-038–041 | `/admin/jobs?status=delayed` shows 2 rows → stale data blocks the financial action → refresh → dialog requires reason, note, confirmation → adjustment appears in the timeline → "Back to jobs (filters kept)" returns to `?status=delayed` → Support role sees "cannot adjust credits" | VERIFIED_PASS |
| FLOW-7a–c | REQ-041 | Payout approval disabled for non-finance role → requires acknowledgement → batch approved while the unconfirmed transfer stays reserved | VERIFIED_PASS |
| FLOW-8a–c | REQ-044–045 | Application validates fields → simulated acceptance → partner portal → Copy link writes `https://genlixs.example/r/aurora-studio` to the clipboard → payout readiness explains the unmet condition | VERIFIED_PASS |

## 4. Accessibility

| ID | Check | Result |
| --- | --- | --- |
| QA-A1 | axe-core 4.10.3, tags wcag2a/2aa/21a/21aa/22aa, 27 routes (signed-in state, 1280 px) | VERIFIED_PASS — 0 violations (one `scrollable-region-focusable` found and fixed during the run) |
| QA-A2 | First Tab lands on "Skip to content" | VERIFIED_PASS |
| QA-A3 | Composer tabs move with arrow keys; visible focus outline | VERIFIED_PASS |
| QA-A4 | Mobile menu opens as a dialog; Escape closes; focus returns to trigger | VERIFIED_PASS |
| QA-A5 | Top-up dialog contains focus; Escape restores focus to "Top up credits" | VERIFIED_PASS |
| QA-A6 | `prefers-reduced-motion: reduce` disables section reveal | VERIFIED_PASS |
| QA-A7 | Token contrast (computed): text pairs ≥ 4.5:1, control boundaries ≥ 3:1 — see 02 §3 | VERIFIED_PASS (computed) |
| QA-A8 | Screen-reader listening test (VoiceOver / NVDA) | NOT_TESTED — no screen reader in this environment |
| QA-A9 | 200 % zoom / long translated strings | NOT_TESTED |

## 5. Visual, content and brand

| ID | REQ | Check | Result |
| --- | --- | --- | --- |
| QA-V1 | REQ-001–004 | Supplied wordmark used unaltered (trim + resize); white on dark, dark on light; symbol for collapsed rail, favicon, apple icon | VERIFIED_PASS |
| QA-V2 | REQ-005–008 | Exact core colours; blue only for primary actions/current nav; one glow; layer-stack accent once per screen | VERIFIED_PASS |
| QA-V3 | REQ-022 | Homepage section order matches §07 table | VERIFIED_PASS |
| QA-V4 | REQ-017 | Headline and supporting sentence verbatim | VERIFIED_PASS |
| QA-V5 | REQ-051 | All concept media tagged; sample numbers flagged; no rates, testimonials, user counts or "unlimited" claims | VERIFIED_PASS |
| QA-V6 | REQ-024 | Video starts on poster, `preload="none"`, native controls, no autoplay | VERIFIED_PASS |

## 6. Not covered / open

| Item | Status |
| --- | --- |
| Real auth, generation, payments, payouts, persistence | BLOCKED_EXTERNAL — blueprint + services not supplied; simulated by design |
| Approved catalog, prices, partner terms, legal text | BLOCKED_EXTERNAL |
| Validated Genlixs media | BLOCKED_EXTERNAL |
| Figma / editable design file | BLOCKED_EXTERNAL — no Figma tooling in this environment |
| Real-device keyboard behaviour of the mobile Generate bar | NOT_TESTED |
| Remaining admin screens (REQ-042), auth recovery screens, tool/model detail pages (REQ-054) | Not built in this preview |
| Lighthouse / Core Web Vitals | NOT_TESTED — no field data; build uses static rendering, optimised images and a 320 KB clip |

## 7. Release readiness

Ready as a **design preview** for stakeholder review. Not ready for production until section 6's external items are resolved.
