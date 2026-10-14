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
| Advisors | Supabase security/performance advisors: only intended `SECURITY DEFINER` RPC notices, RPC-only tables without policies, the platform's `rls_auto_enable`, unused-index notices on an empty database | VERIFIED_PASS (reviewed) |

The temporary QA account and all its rows were deleted afterwards (support messages are append-only; the guard was lifted
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

## 3. Controlled checks to run after activation

1. Health endpoint shows every feature configured; Admin → Overview heartbeat < 1 min.
2. One real job per launch model: quote → 202 → callback received (or poll) → file in Library → download → credits captured
   once; supplier consumption visible on the job.
3. Kill switch: set `generation_paused` → quotes and new jobs refused, running jobs finish.
4. Test-mode payment with the chosen gateway: credits granted once on replayed webhook; partial refund revokes the right units.
5. Partner: approve a test partner after publishing the agreement, referral link with consent → sign-up attributed → paid order
   creates a 30 % commission in hold.

## 4. Readiness verdict

**Not production-ready yet.** The code, schema, security model and tests are complete for review, and the deployed site stays in
its honest preview mode. Production can be declared ready only after the owner completes `docs/SETUP_AND_ACTIVATION.md`,
the controlled real-account checks above pass with recorded evidence, and approved prices, products and partner terms are
published.
