# Verification evidence and readiness verdict

Run on 14 Oct 2026, Windows 11, Node 24.21, Next.js 16.3.8, Chrome via playwright-core 1.64, against Supabase project
`qlpxdrbadakbyzdyfrnk`. Statuses: `VERIFIED_PASS`, `FAILED`, `NOT_TESTED`, `BLOCKED_EXTERNAL`.

## 1. Executed checks

| Area | Check | Status |
| --- | --- | --- |
| Build | `npm run lint`, `npm run typecheck` (incl. generated DB types), `npm run build` in preview and live mode | VERIFIED_PASS |
| Database | `supabase/tests/01_generation_wallet.sql` — 14 groups: idempotent grants, server quotes/option validation, idempotent intent + conflicts, RLS/privilege isolation (other customer, anon, worker RPCs), fenced worker happy path, stale lease rejected, late success never recaptures, failure releases once, unknown submission never resent, forged binding evidence refused + escalated, verified binding, cancel before/after claim, 20 intents vs balance 100 at cost 12 → exactly 8, lot expiring while reserved → expired, reconciliation + append-only ledger, watchdog lease expiry → unknown and deadline release | VERIFIED_PASS (14/14) |
| Database | `supabase/tests/02_billing_affiliates_admin.sql` — 11 groups: checkout snapshot/idempotency, one grant per payment, amount mismatch refused, admin capability boundaries, metadata cannot grant roles, credit adjustments, refund hold + revoke, approval needs a published agreement, attribution + 30 % commission, cumulative partial refunds reverse exactly, 10 distinct paying customers → prospective 50 % (10th at 30 %, 11th at 50 %), payout flow (48 h change delay, verification, threshold, separation of duties, evidence, unknown keeps reserved), post-payout refund carry-forward, no email leak to partners | VERIFIED_PASS (11/11) |
| Contracts | `npm run test:contracts` — KIE create classification (accepted / retryable / terminal / unknown), status normalization (string `resultJson`, not-found ≠ failure, transient errors, other-task evidence ignored, `callBackUrl` extraction), adapter inputs, callback HMAC (valid, stale, forged, cross-task), signed cookie tampering, bearer check, same-site redirects, SSRF guards (scheme, host allowlist, credentials, ports, private/IPv6/mapped addresses), byte sniffing of real WebP/MP4 and PNG/JPEG headers, rejection of SVG/GIF/PDF | VERIFIED_PASS (15/15) |
| API (live build, local) | 36 checks: public catalog/plans, 401 envelopes with `requestId`, `no-store`, cross-site and origin-less mutations → 403, webhooks fail closed without keys, worker token (missing/wrong/unknown queue), health reports presence only, referral unknown slug, share 404, auth callback, generic wrong-password error, test checkout hidden, no preview text or sample prices in live mode | VERIFIED_PASS (36/36) |
| Browser (live build, local, temporary QA account) | 30 checks: real sign-in form (wrong password, success), studio overview, honest "not available yet" tools, credits/billing/library empty states, support request persisted and listed, partner application recorded and reflected, admin overview/jobs/catalog with a real staff role, approval refused without a published agreement, owner-only staff page denied, sign-out, axe on 8 live pages (0 violations), no horizontal overflow at 375 px | VERIFIED_PASS (30/30) |
| Preview regression | `flows.js` 36/36, `v2checks.js` 18/18, `kbd.js` 8/8, axe on 30 routes 0 violations, 30 routes × 5 widths 0 overflow, 0 console errors | VERIFIED_PASS |
| Catalog upgrade — database | `supabase/tests/03_catalog_pricing_tests.sql` — 8 groups: customers/support/partners cannot read costs, balance or margins nor change the catalog (finance cannot publish); every configuration of all 18 entries priced as ceil(cost × (1+markup) ÷ lowest revenue per credit) with KIE→USD conversion, per-second × duration (Kling 720p audio 10 s = 200 KIE), Veo 1080p upgrade billed once, fractional KIE credits; contribution direct/30 %/50 % and unknown-cost flags; +0 % flags 50 % losses; markup validation; stable preview revision; drafts → stale preview refused → manual override protected → selecting it fails the whole batch with nothing written → publish (immutable rules, append-only batches, automatic audit text); quotes/jobs across a price change (old quote refused, running job and reservation unchanged, new quote uses the new version, restore creates a new version); availability (no price → refused, operations cannot enable untested, owner must confirm, status stays untested, publish-draft-and-enable, disable hides and refuses old quotes, maintenance shown with note, bulk all-or-nothing); private tests (spend confirmation, idempotent replay, one open test per model across staff, no reservation, task creation ≠ verification, validated import → verified for that entry only, failures recorded, no customer notification, hidden from library, staff-only output access); balance (shared refresh slot, real values only, failure keeps the last value, customers cannot write); package impact, assumptions, cost versions immutable, below-cost publish needs a typed reason | VERIFIED_PASS (8/8) |
| Catalog upgrade — regressions | Tests 01 (14/14) and 02 (11/11) re-run after the upgrade, with added checks: customer outputs never marked as tests, library still lists customer jobs, a customer job without reservation is still refused, support cannot see the KIE balance, an active partner cannot read costs or balance | VERIFIED_PASS (25/25) |
| Catalog upgrade — contracts | `npm run test:contracts` now 20: adapters for the new families (documented field names and types, edit models require the reference, unsupported values refused), code adapters equal the migration registry, Veo upgraded `data.result_urls` preferred and originals/last frames never imported, 422 task-not-found is evidence only, balance parsing never yields a fabricated zero | VERIFIED_PASS (20/20) |
| Catalog upgrade — API | `qa-scripts/catalog-api-checks.mjs` (temporary operations+finance account, local build without a KIE key): 401 without session; runtime reports presence only; costs visible to pricing roles; no secret-like values in payloads; model detail; 404/422 inputs; preview math (Veo 720p +100 % = 18 cr); markup precision; publish refused for non-owner; forged/stale revision refused; enabling and paid tests refused up front without KIE credentials; package impact; honest not-configured balance | VERIFIED_PASS (25/25) |
| Catalog upgrade — browser | `qa-scripts/catalog-flows.mjs`: 73 checks — part A on real data with reads only (a request guard confirmed no write reached the server; the database showed no new rows): workspace, 18 models, corrected names, filters/search/selection, explained blocked enable, Escape closes dialogs, model panel (pricing table, fill from markup = 4/6/10 at +300 %, revenue and 30 %/50 % contribution, readiness checklist, one state selector, test spend warning with expected cost, sourced cost update path, advanced ids/JSON), bulk preview (definition, $0.0345 credit value, 18 previews, 18 Kling configurations, owner-only publish, 50 % loss warning, invalid markup), packages (revenue per credit, live change, impact), KIE balance (not configured, unknown, no fabricated zero), settings; axe 0 violations on every tab and panel incl. mobile; no horizontal overflow at 1440/1024/768/390/360 and for the panel at 390; keyboard tab activation. Part B with intercepted responses: untested owner warning + acknowledgement, enable sends no typed reason, publish-draft-and-enable, publish confirmation, batch result, stale preview with refresh, studio badges, maintenance entry with note, single-value tier as text, audio labels, no supplier data, axe | VERIFIED_PASS (73/73) |
| Catalog upgrade — live API smoke regression | `live-api-smoke.mjs` re-run | VERIFIED_PASS (36/36) |
| Advisors | Supabase security/performance advisors: only intended `SECURITY DEFINER` RPC notices, RPC-only tables without policies, the platform's `rls_auto_enable`, unused-index notices on an empty database | VERIFIED_PASS (reviewed) |

For the catalog upgrade a second temporary QA account (operations + finance, no emails sent) was created and deleted with all
its rows; it wrote no audit, price, batch or balance rows. The first run's temporary QA account and all its rows were deleted afterwards (support messages are append-only; the guard was lifted
inside a single locked transaction only for those rows and re-enabled). The database has 0 users.

## 2. Not executed here

| Check | Status | Why |
| --- | --- | --- |
| Worker passes against the real database (submit → check → import → capture) from the Next.js process | BLOCKED_EXTERNAL | Needs `SUPABASE_SECRET_KEY`, which only the owner can set. The same transitions are covered by the SQL tests; the handlers are covered by contract tests. |
| Real KIE generation, callback delivery, result import, supplier consumption (guide §26.5) | BLOCKED_EXTERNAL | Needs a funded KIE key and HMAC key; no paid test was made. |
| Payments, subscription cycles, live refunds | BLOCKED_EXTERNAL | No gateway chosen. The normalized event processing is covered by SQL tests; the `test` adapter path is implemented but was not run end-to-end because it needs the secret key. |
| Supabase Auth email delivery, password reset email | BLOCKED_EXTERNAL | Needs custom SMTP and redirect URLs (setup step 1). |
| Cron → Vercel worker wake-up | BLOCKED_EXTERNAL | Needs the Vault secrets and a reachable production origin. |
| Real parallel concurrency (multiple simultaneous HTTPS requests) | NOT_TESTED | Serialization is enforced by the wallet row lock and unique keys and was tested sequentially inside one transaction; a parallel load test needs committed test data on a staging project. |
| Reference upload end-to-end (browser → Storage → finalize) | BLOCKED_EXTERNAL | Finalize uses the secret key. |
| Private paid tests of the 18 catalog entries against KIE | NOT_TESTED | Spends the owner's KIE balance; never run without the owner. All entries stay "Untested". |
| Live KIE balance read from the admin tab | BLOCKED_EXTERNAL | The key exists only in production; locally the tab correctly reports "Not configured". The worker's periodic read and the admin read use the same documented endpoint (`GET /api/v1/chat/credit`). |
| Result layout for Veo 1080p/4K and result hosts of the new families | NOT_TESTED | Handled per the documentation (upgraded file in `data.result_urls`); a real test confirms it. |
| Production deployment of this upgrade | NOT_TESTED | Pushing the branch deploys to production (the branch is the production branch); see the delivery note in `HANDOFF.md`. |

## 3. Controlled checks to run after activation

1. Health endpoint shows every feature configured; Admin → Overview heartbeat < 1 min.
2. KIE balance tab shows a live reading. One private paid test per model to be offered (Admin → Models & pricing → Test
   model): validated output, KIE-reported credits close to the documented cost, entry marked "Verified by test". Then one
   real customer job per enabled model: quote → 202 → callback received (or poll) → file in Library → download → credits
   captured once; supplier consumption visible on the job.
3. Kill switch: set `generation_paused` → quotes and new jobs refused, running jobs finish.
4. Test-mode payment with the chosen gateway: credits granted once on replayed webhook; partial refund revokes the right units.
5. Partner: approve a test partner after publishing the agreement, referral link with consent → sign-up attributed → paid order
   creates a 30 % commission in hold.

## 4. Readiness verdict

**Not production-ready yet.** The code, schema, security model and tests are complete for review. The owner has set the
production variables, so the deployed site runs in live mode, with every model disabled and nothing on sale. Production can be
declared ready only after the owner completes `docs/SETUP_AND_ACTIVATION.md`, the controlled real-account checks above pass
with recorded evidence (including at least one private paid test per model that will be offered), and approved prices,
packages and partner terms are published.
