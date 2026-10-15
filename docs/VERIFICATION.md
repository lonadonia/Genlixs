# Verification evidence and readiness verdict

Run on 14 Oct 2026, Windows 11, Node 24.21, Next.js 16.3.8, Chrome via playwright-core 1.64, against Supabase project
`qlpxdrbadakbyzdyfrnk`. Statuses: `VERIFIED_PASS`, `FAILED`, `NOT_TESTED`, `BLOCKED_EXTERNAL`. Section 0 was added on
15 Oct 2026 and supersedes the "not executed" rows it covers.

## 0. Generation repair, video modes and real generation (15 Oct 2026, production)

**Why nothing was generated (root causes, in the order they block):**

1. The Vault worker origin (`genlixs_worker_base_url`) was a documentation example domain that does not resolve, so every
   per-minute wake-up failed and jobs stayed "Waiting in queue". Set to the live origin; wake-ups now succeed (10/10 in 6 h).
2. KIE answered task creation with HTTP 402 "Credits insufficient" while the balance read positive (until 01:59 UTC); the
   same key was accepted from 02:30 UTC. The cause is on the KIE account side (check the key limits at kie.ai/api-key). Such
   refusals are now an account state: new quotes pause for 5 minutes, waiting jobs retry and are returned after 4 refusals
   or 20 minutes, and the admin Generation pipeline panel says so.
3. Result imports were refused ("host not allowlisted") because the production `MEDIA_FETCH_ALLOWED_HOSTS` value parsed to
   no host name. The reviewed KIE delivery hosts now always apply and the setting can only add hosts; the production value was
   corrected (health: 4 hosts understood). The HTTPS-only, public-address and allowlist checks are unchanged.
4. `APP_BASE_URL` / `KIE_CALLBACK_BASE_URL` pointed to the same unresolvable domain; corrected to the live origin.
5. The studio kept "Getting quote…" after a submission because the used quote was never renewed; quotes now renew, time out
   after 15 s with a retry, ignore out-of-order replies, and a double click cannot create a second job.

Two jobs left behind by these failures (J-ATXMSW image, J-W4LGAF video) were completed with **Retry import** of the same KIE
task (no new task) and charged once.

**Real end-to-end runs** on genlixs.vercel.app (commit `79913c1`), through the customer UI with a temporary QA account
funded by an audited 40-credit support grant; the edit and motion models are not on sale, so they ran as private staff
tests from the video studio (spend confirmation, KIE pays, no customer credits). Every result was found by polling (no
callback key is configured; callbacks stay refused).

| Flow | Configuration | Job · KIE task | Result | Customer wallet | KIE credits |
| --- | --- | --- | --- | --- | --- |
| Image | GPT Image 2.5 Flare, 1K, 2:3 | J-FOYGGE · `0327ec…f8ee` | succeeded in 1 min 41 s; PNG 1024×1536, 1.91 MB; download 200 `image/png` (attachment) | reserve 3 → capture 3 | 6 |
| Basic video (text) | Veo 3.1 Lite, 4 s, 720p, 16:9 | J-JGGYTZ · `15f6a4…2d30` | page closed 6 s after submitting; finished on the server alone in 1 min 45 s; MP4 1280×720, 4.0 s, 24 fps, audio; plays in the studio; download 200 `video/mp4`, 1,326,113 bytes | reserve 15 → capture 15 | 30 |
| Reference-based video | Veo 3.1 Lite, 4 s, 720p, 9:16, start frame = the saved image ("Animate this image") | J-YUXAQA · `628702…fdc5` | page closed after submitting; MP4 720×1280, 4.0 s, 24 fps, audio; plays | reserve 15 → capture 15 | 30 |
| Edit Video (private test) | Seedance 2.5 Edit, 480p, sound on, source = the basic video ("Edit this video"); 4 billable seconds derived by the server | J-Z7BVJK · `7e09c2…e02e` | snow added to the clip; MP4 854×480, 3.7 s, 24 fps, audio; plays; staff-only file | none | 119 = 17 × (4 s source + 3 s output); the estimate of 136 assumes an output as long as the source, so it is an upper bound |
| Motion Control (private test) | Kling 3.0 Motion Control, 720p, "Follow the video"; motion = the basic video ("Copy this motion"), character = the saved image ("Use as character") | J-6Y6BED · `da1411…6d1e` | the woman from the image performs the dancer's motion; MP4 768×1168, 4.0 s; plays; staff-only file | none | 80 (estimate 80) |
| Cancellation | Seedream 5.0 Flash, 1K | J-QYEXGH | cancelled 0.8 s after creation, before submission; no KIE attempt; the same request replayed returns the same job | reserve 2 → release 2 | 0 |

Ledger for the QA wallet: one grant (40), one reserve and one capture per delivered job, one reserve and one release for the
cancelled job, nothing for private tests; final balance 7 available, 0 reserved, 33 spent. The KIE balance went from
903.03 to 638.03, exactly the 265 credits KIE reported for the five tasks.

| Area | Check | Status |
| --- | --- | --- |
| Uploads (production) | 3 s clip refused before upload (needs 4–30 s); 8.3 MB clip through the resumable endpoint (POST 201, PATCH 204) and server verification; image and audio references verified; a text file refused with a reason; drafts keep only verified ids | VERIFIED_PASS (7/7) |
| Server input checks (production quotes, no credits move) | reference images need 8-second clips; a video refused as a start frame; image + audio references priced together (70 credits); first/last frame and references not combined; a model not on sale cannot be quoted by customers; another customer's file refused; an element needs at least 2 images | VERIFIED_PASS (7/7) |
| Video studio UI (production, signed in) | 3 tabs with arrow-key navigation, searchable model picker (7 creation models; no edit or motion model offered for creation), quote on Generate, How it works, Edit Video and Motion Control composers, private-test mode for staff (edit, motion, extend), axe 0 violations on every state and dialog, no horizontal overflow at 1440 and 390 px, no console errors | VERIFIED_PASS (18/18) |
| Other studio pages (production) | Image, Edit, Library, Video, Home at 1440 and 390 px: axe, overflow, console. The first run found the Library overflowing by 140 px on phones once long titles existed (the grid column could not shrink); fixed in `6bfd774` and re-checked | VERIFIED_PASS (18/18 after the fix) |
| Temporary QA accounts | The two accounts of this run were closed through the runbook procedure: unused credits revoked (7, audited correction), customer files deleted by the account (6, storage objects gone), both suspended with a reason (audited), roles switched off directly in the database (the staff-role tool is owner-only, so this step has no audit row), sign-in removed (0 auth users, identities, sessions, refresh tokens). Kept as records: 6 jobs, 10 ledger entries, 2 staff-test outputs and the audit trail. The earlier QA account (no records) was removed completely; its 2 append-only audit rows remain | DONE |
| Generation preview card | Emblem with labelled estimated progress (1 % → 21–84 % generating → 94–97 % saving → Ready), never 100 % before the file is saved; hand-over to the image or playable video; Download, Open in library, Animate this image, Use as character; private-test wording | VERIFIED_PASS (observed on the runs above) |
| Contracts | `npm run test:contracts`: 54 (adds the video studio composer rules: tab/operation filtering, only visible inputs priced, mode-limited options, hidden options not sent, required/dependent/mentioned inputs, upload states, wrong type after a model switch, derived seconds never sent, orientation rule, routing of dropped files, browser-read limits, drafts per account without local links) | VERIFIED_PASS (54/54) |
| Database | All suites re-run after the five video-mode migrations, on the production project, rolled back: 01 (14/14, including the global wallet reconciliation over real data), 02 (11/11), 03 (8/8), 04 (8/8), 05 (6/6), `06_video_modes_tests.sql` (10/10); user, job, price and model counts unchanged afterwards | VERIFIED_PASS (57/57) |
| Build | lint, typecheck, `next build` | VERIFIED_PASS |

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
| Catalog upgrade — API and browser (v3.1) | `catalog-api-checks.mjs` 25/25 and `catalog-flows.mjs` 73/73 at the time; both scripts were retired with the workspace they tested (replaced by the simplified admin, rows below) | SUPERSEDED |
| Catalog upgrade — live API smoke regression | `live-api-smoke.mjs` re-run | VERIFIED_PASS (36/36) |
| Simplified pricing — database | `supabase/tests/04_simplified_pricing_tests.sql` — 8 groups: reference values (customers/support/operations refused; validation of amounts, whole Genlixs credits, bonus < credits, https links; stale editor refused; identical value is not a new version; audit text; append-only); the owner's example (6 KIE credits = $0.03 at $5/1,000 → +100 % = $0.06 = 3 credits at $5/250; contribution $0.03 / $0.012 / $0 at 0 / 30 / 50 % commission) and rounding (3.24 KIE = $0.0162 → 2 credits); impact preview saves nothing; one-step price (finance drafts only, stale editor, missing/fractional/zero/extra settings refused, below-cost refused without confirmation and nothing written, accepted with audit, unchanged save is a no-op, markup summary +100 %); a reference change leaves lots, ledger, reservation, running job, quotes, orders and published prices byte-identical and an open quote still works at its price; bulk markup (manual prices protected unless included, kept settings keep their charge, kept-but-unpriced / everything-kept / foreign keys refused with nothing written, finance cannot publish, stale preview after a reference change refused); availability without a paid test (operations can switch on a priced untested model, status stays untested, repeat is a no-op, off refuses earlier quotes, running job untouched); packages (finance cannot offer, stale editor, bonus counted in usable credits, other packages untouched, public products show the bonus, order snapshot unchanged by later edits, sold terms immutable, not offered = not on sale, audit text); reads (references for pricing roles only, settings section, KIE USD estimate at the reference rate, no pricing internals in the public catalog) | VERIFIED_PASS (8/8) |
| Simplified pricing — regressions | Tests 01 (14/14), 02 (11/11) and the updated 03 (8/8: basis is the credit value; operations can switch on an untested priced model) re-run on the production project in rolled-back transactions; nothing persisted (counts of references, prices, products, audit rows and enabled models unchanged afterwards) | VERIFIED_PASS (33/33) |
| Simplified pricing — contracts | `npm run test:contracts` now 27: the exact-decimal credit arithmetic (`src/lib/pricing/`) — the owner's example, $0.07 at $0.01 = 7 credits (binary floating point gives 8), rounding up and the actual markup, markup input precision, package rates with bonus credits, credits from the credit value, unknown costs never zero | VERIFIED_PASS (27/27) |
| Simplified pricing — API | `qa-scripts/pricing-api-checks.mjs` (temporary operations+finance account, local build without a KIE key): 401 without session on the new endpoints; references and credit-value basis; products with included + bonus credits; private test optional in readiness; settings section; reference impact read-only and computed; whole Genlixs credits and 2-decimal amounts enforced; stale reference/price editors refused with 409 and nothing written; bulk preview math; publish refused for non-owner; forged preview refused; malformed kept settings refused; offering a package refused for non-owner; switching on refused without KIE credentials; retired endpoint gone | VERIFIED_PASS (26/26) |
| Simplified pricing — browser | `qa-scripts/pricing-flows.mjs`: 78 checks. Part A on real data with reads only (request guard: no write reached the server; database counts unchanged): Models page with 18 switches, no legacy buttons/prices/JSON, variants, navigation, filters/search, blocked switch explained in one sentence and returned to Off, Details (status with optional test, special states, tabs, private-test cost shown before spending); Pricing page (three sections, $0.005 per KIE credit, $0.02 per Genlixs credit, example label, 4× / +300 % ratio, separate units, package economics with Starter $0.045 = +125 %, finance cannot offer, live rate update); price editor (+100 % → 3/5/8 credits = $0.06/$0.10/$0.16, contribution $0.03/$0.012/$0.00, 50 % fewer credits worth +100 %, $0.055 target rounds up to 3 credits, below-cost confirmation, finance draft only); bulk preview with per-setting keep option; KIE balance (honest not-configured state, details folded); service settings in plain words on Overview; partner terms on Partners; axe 0 violations on every page and dialog; no horizontal overflow at 1440/1024/768/390. Part B with intercepted responses: the switch sends the real request and shows On, a failure restores Off with the reason; price, reference, package and bulk saves send exact bodies (whole credits, decimal text, concurrency tokens, kept settings) and show the confirmations | VERIFIED_PASS (78/78) |
| Simplified pricing — regressions (scripts) | `live-api-smoke.mjs` 36/36; `live-flows.mjs` 30/30 (its catalog check updated to the Models page) | VERIFIED_PASS |
| Advisors | Supabase security/performance advisors: only intended `SECURITY DEFINER` RPC notices, RPC-only tables without policies, the platform's `rls_auto_enable`, unused-index notices on an empty database | VERIFIED_PASS (reviewed) |

For the catalog upgrade a second temporary QA account (operations + finance, no emails sent) was created and deleted with all
its rows; it wrote no audit, price, batch or balance rows. The first run's temporary QA account and all its rows were deleted afterwards (support messages are append-only; the guard was lifted
inside a single locked transaction only for those rows and re-enabled). The database has 0 users.

## 2. Not executed here

| Check | Status | Why |
| --- | --- | --- |
| Worker passes against the real database (submit → check → import → capture) from the Next.js process | VERIFIED_PASS (15 Oct) | See §0: submit, polling, import and capture ran in production. |
| Real KIE generation, result import, supplier consumption (guide §26.5) | VERIFIED_PASS (15 Oct) | See §0. |
| KIE callback delivery | BLOCKED_EXTERNAL | `KIE_WEBHOOK_HMAC_KEY` is not set, so callbacks are refused by design; polling found every result within a minute. |
| Payments, subscription cycles, live refunds | BLOCKED_EXTERNAL | No gateway chosen. The normalized event processing is covered by SQL tests; the `test` adapter path is implemented but was not run end-to-end because it needs the secret key. |
| Supabase Auth email delivery, password reset email | BLOCKED_EXTERNAL | Needs custom SMTP and redirect URLs (setup step 1). |
| Cron → Vercel worker wake-up | VERIFIED_PASS (15 Oct) | Works since the Vault origin was corrected; the health panel shows every wake-up. |
| Real parallel concurrency (multiple simultaneous HTTPS requests) | NOT_TESTED | Serialization is enforced by the wallet row lock and unique keys and was tested sequentially inside one transaction; a parallel load test needs committed test data on a staging project. |
| Reference upload end-to-end (browser → Storage → finalize) | VERIFIED_PASS (15 Oct) | See §0 (standard and resumable uploads in production). |
| Private paid tests of the catalog entries against KIE | PARTIAL | Run on 15 Oct for Seedance 2.5 Edit and Kling 3.0 Motion Control (§0). Veo 3.1 Lite and GPT Image 2.5 Flare were exercised as customer jobs. Veo 3.1 Extend and the other entries were not tested. |
| Live KIE balance read from the admin tab | BLOCKED_EXTERNAL | The key exists only in production; locally the tab correctly reports "Not configured". The worker's periodic read and the admin read use the same documented endpoint (`GET /api/v1/chat/credit`). |
| Result layout for Veo 1080p/4K and result hosts of the new families | NOT_TESTED | Handled per the documentation (upgraded file in `data.result_urls`); a real test confirms it. |
| Production deployment of the simplified admin (commit `893cb0c`, deployment `dpl_4ocoyBXYDWy45pazyKz8v4FwAD4F`, READY, aliased to genlixs.vercel.app) | VERIFIED_PASS (read-only) | `/admin/catalog` ("Models"), `/admin/pricing`, `/admin/kie`, `/admin`, `/admin/affiliates`, home, studio and sign-in answer 200; their deployed scripts contain the new pages and none of the retired workspace strings ("Record verification", "Set maintenance", "Lowest revenue per credit", "Publish draft"); admin reads and the reference save answer 401 without a session; the public catalog lists 0 models with no pricing internals; plans empty; no runtime errors after the deploy. The signed-in owner view on production was not opened here (no owner session); the same build was inspected signed in against the production database locally. |

## 3. Controlled checks to run after activation

1. Health endpoint shows every feature configured; Admin → Overview heartbeat < 1 min.
2. Admin → KIE balance shows a live reading. Optionally one private paid test per model to be offered (Models → Details →
   Private test): validated output, KIE-reported credits close to the documented cost, entry marked "Tested". Then one
   real customer job per enabled model: quote → 202 → callback received (or poll) → file in Library → download → credits
   captured once; supplier consumption visible on the job.
3. Kill switch: set `generation_paused` → quotes and new jobs refused, running jobs finish.
4. Test-mode payment with the chosen gateway: credits granted once on replayed webhook; partial refund revokes the right units.
5. Partner: approve a test partner after publishing the agreement, referral link with consent → sign-up attributed → paid order
   creates a 30 % commission in hold.

## 4. Readiness verdict

**15 Oct 2026:** image and video generation now work end to end in production for the models on sale (verified for one
image model and Veo 3.1 Lite, including a start frame from a saved image). Video editing and Motion Control work end to
end as private tests and stay off for customers until the owner approves their draft prices and switches them on (Admin →
Pricing → model price; Models → switch). Still open: `KIE_WEBHOOK_HMAC_KEY` (polling covers it), Veo 3.1 Extend has no
live test, 1080p/4K results untested, and the items below.

**Not production-ready yet.** The code, schema, security model and tests are complete for review. The owner has set the
production variables, so the deployed site runs in live mode, with every model disabled and nothing on sale. Production can be
declared ready only after the owner completes `docs/SETUP_AND_ACTIVATION.md`, the controlled real-account checks above pass
with recorded evidence (including at least one private paid test per model that will be offered), and approved prices,
packages and partner terms are published.
