# Genlixs backend — architecture and module map

Implements `Genlixs_Backend_Implementation_Guide_EN.md` v1.0 (14 Oct 2026). Supabase (Postgres, Auth, private Storage,
pgmq queues, Cron + pg_net + Vault) holds every durable decision; Vercel runs the Next.js app, thin API handlers and short
workers. KIE.ai is the generation provider. No Redis, VPS or long-running worker.

## 1. Two modes, one codebase

| Mode | When | Behaviour |
| --- | --- | --- |
| **Design preview** | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` not set | The original simulated UI (`demo-store.ts`, `admin-data.ts`) with the preview banner. API routes answer `503 NOT_CONFIGURED`. |
| **Live** | Both public Supabase values set | Real auth, wallet, jobs, files, billing, partner and admin data. The preview banner, pills and sample prices disappear. Anything not yet configured shows an honest "not available yet" state. |

`src/lib/config.ts` exports `LIVE`. Pages branch once (`LIVE ? <LiveX/> : <X/>`); live UI lives in `src/components/live/**`.
A fake is never chosen automatically: the deterministic fake provider needs `GENLIXS_FAKE_PROVIDER=1` **and** a non-production
deployment; the `test` billing adapter needs `BILLING_PROVIDER=test` **and** a non-production deployment.

## 2. Database (supabase/migrations)

Applied to project `qlpxdrbadakbyzdyfrnk` (eu-west-1, Postgres 17). File names equal the remote migration versions.

| Version | Content |
| --- | --- |
| `20261014022102_foundation_identity` | `app_private` schema, `fail()` error contract, profiles, staff roles/capabilities, audit log (append-only), settings, one-time owner bootstrap |
| `20261014022202_catalog_pricing` | tools, model catalog + immutable capability versions, versioned price rules, products; public `get_catalog` / `get_products` |
| `20261014022432_wallet` | wallet accounts, credit lots, reservations + allocations, append-only ledger; grant/reserve/capture/release/expire; signup trigger |
| `20261014024939_media_notifications` | private buckets, assets, upload intents, share links (hash only), collections, notifications, Storage policies |
| `20261014025614_generation` | pgmq queues, quotes, jobs + events, provider attempts/receipts/observations, fenced work items, all worker RPCs, watchdog |
| `20261014025945_billing` | payment orders (price snapshot), billing receipts, transactions, subscriptions + cycles, refunds, disputes |
| `20261014030455_affiliates` | agreement versions (draft), accounts, links, clicks, attributions, qualifications, tier events, commissions, adjustments, payout destinations/batches |
| `20261014031121_operations_admin` | support tickets, admin reads/actions, reconciliation, health, retention, `wake_workers` + cron jobs |
| `20261014031201_fk_indexes` | covering indexes for every foreign key |
| `20261014035148_bind_verification` | `worker_bind_task` verifies the observed attempt id + correlation token hash in SQL; the old boolean signature is a refusing stub |
| `20261014065744_catalog_admin_schema` | Model metadata (family, variant, badges, sources) and real verification status; implemented-adapter registry; immutable KIE cost versions; price provenance; append-only pricing batches; staff-test purpose on quotes/jobs/assets; test runs and verification evidence; balance history; `catalog.test` / `provider.read` capabilities; pricing assumptions |
| `20261014070104_catalog_curated_models` | Curated catalog: 18 entries (15 new + 3 existing ids with corrected names), option schemas and documented per-configuration KIE costs; all disabled and unpriced |
| `20261014160624_catalog_admin_functions` | Configuration math, credit economy, bulk pricing preview/apply (stale-revision check, all-or-nothing), manual drafts, publish/restore, availability rules, private tests, provider summary and balance reads, admin reads; table-format customer prices in quotes and the public catalog |
| `20261014161256_catalog_admin_fixes` | Fixes found by the SQL tests (contribution labels, catalog order, manual-override detection) |

Conventions: `public` holds RLS-protected projections and `SECURITY DEFINER` RPCs that check `auth.uid()` or a staff capability
inside; `app_private` is not exposed to `anon`/`authenticated`. Default `EXECUTE` is revoked and granted per function.
Business errors use `app_private.fail(CODE, message, details)` → Postgres `message = CODE`, `detail = text`, `hint = JSON`.
Types generated from the live schema: `src/lib/supabase/database.types.ts`.

Seeded but **inactive**: 18 curated models (`disabled`, no price, verification "untested"; see `docs/CATALOG_AND_PRICING.md`),
three products (`draft`) and partner agreement v1 (`draft`: 30 % of eligible revenue, 50 % after 10 distinct paying customers;
window, renewal, hold and threshold are proposals marked unconfirmed). The launch placeholder price drafts were retired. Nothing
can be generated or bought until the owner prices, enables and publishes.

Prices: a published price version holds either the launch format (`base` + `add`) or a **table** of whole credits per
configuration (`{"format":"table","dims":[…],"units":{"<values joined by |>":n}}`). The price editor and the markup tool write
tables. Charges are valued with two versioned, append-only reference values (`app_private.pricing_reference_versions`:
the KIE purchase → USD per KIE credit, the Genlixs credit value → USD per Genlixs credit); saving one never touches wallets,
ledgers, orders, quotes, jobs or prices. Packages store usable `credits` (included + `bonus_credits`); orders snapshot them. KIE costs live in `app_private.supplier_cost_versions` (`unit` output|second, `dims`, `rates` in KIE credits,
optional `extraReference`); a configuration without a rate has no known cost and blocks pricing and enabling.
Staff tests are `generation_jobs` with `purpose = staff_test`: units 0, no reservation, no notification, hidden from the
customer library; a trigger records the outcome in `model_test_runs` and, on a validated delivery, marks only that entry
"verified by test".

## 3. Request flow

```
studio ──POST /api/generation/quotes──▶ create_generation_quote (server price, frozen input, 5-min TTL)
       ──POST /api/generations + Idempotency-Key──▶ create_generation: wallet lock → idempotency → quote checks
                                                    → concurrency → reserve lots → job → work item + pgmq message (one tx)
       ◀─202 job ── after(): control worker pass
control worker: worker_claim (lease + fence) → worker_begin_submission (attempt row committed BEFORE the POST)
              → KIE createTask (never retried blindly) → worker_record_submission(accepted | retryable | terminal | unknown)
KIE callback ─▶ /api/webhooks/kie: HMAC(taskId.timestamp), 5-min window → provider_callback_receipt → job_check / job_bind
job_check: recordInfo (authoritative) → worker_record_observation → success ⇒ job_import | fail ⇒ release once | pending ⇒ backoff
media worker: safe download (HTTPS, host allowlist, public IPs, redirects re-checked, byte cap) → sniff bytes → Storage
              (deterministic path) → worker_record_import ⇒ capture exactly once + notification
cron (every minute): watchdog_tick (expired leases → unknown, deadlines → release) + watchdog_maintenance (commission
              maturity, intent expiry, retention) + wake_workers(control|media|events) when Vault holds URL + token
```

Unknown submissions are never resent: they wait for a verified callback (binding checks the stored correlation hash),
an operator "attach verified task", or the customer deadline (credits returned).

## 4. Code map

| Path | Responsibility |
| --- | --- |
| `src/proxy.ts` | Session-cookie refresh (Next 16 `proxy`); skips static files, webhooks and internal routes |
| `src/lib/server/http.ts` | Envelope `{data}` / `{error:{code,message,details}}` + `requestId`, status mapping, same-origin check, `withUser`, input readers |
| `src/lib/server/env.ts`, `crypto.ts` | Lazy env validation (`ConfigError` → 503), hashing, HMAC, signed cookie values, constant-time compare |
| `src/lib/supabase/{client,server,admin}.ts` | Browser client · per-request user client (verified with `getUser`) · secret-key client for workers only |
| `src/lib/providers/kie/{client,adapters,webhook}.ts` | KIE create/status/balance, response classification and normalization, per-adapter inputs, callback HMAC |
| `src/lib/providers/fake.ts` | Deterministic fake provider (non-production + explicit flag) |
| `src/lib/providers/{types,registry,credentials,sync,http,decimal}.ts` | Multi-provider layer: shared client interface, the six supplier clients, keys from Vault (service role) or `KIE_API_KEY`, balance/usage reads, fixed-host HTTP, exact decimals. See `docs/PROVIDERS_AND_ROUTING.md` |
| `src/lib/providers/{cuddler,apimart,nezhagate,poyo,duomi}.ts` | Per-supplier request builders, create-reply classification, status normalization, balance parsing (documented contracts, checked 18 Oct 2026) |
| `src/components/live/admin/providers/*` | Admin › Providers & routing: Overview, Providers (keys, switches, funding terms, manual balances), Models (comparison, offers, prices, paid offer tests, routing review, inventory), Usage (ledger, CSV) |
| `src/lib/providers/balance.ts` | Server-side KIE balance read (deduplicated per instance; cross-instance slot in the database), recorded success or error |
| `src/lib/media/{safe-fetch,sniff}.ts` | SSRF-safe importer and byte-level file verification |
| `src/lib/jobs/{worker,kick}.ts` | Queue loop and handlers (submit, check, bind, import, asset delete, billing apply) |
| `src/lib/billing/index.ts` | Gateway interface; `test` adapter outside production; no live gateway chosen yet |
| `src/lib/auth/{referral,redirect}.ts` | Signed referral cookie; same-site redirect guard |
| `src/lib/live/**` | Browser API helper, account context (wallet/notifications refresh on focus + 30 s), response types |
| `src/components/live/**` | Live studio, partner portal, admin console and public pricing/consent components |
| `src/components/live/admin/catalog/**` | Models (one row per model: On/Off switch, supplier serving it, default-request cost/price/margin, cheapest other supplier; model sheet with every supplier quote; products available at suppliers; diagnostics: status, private test, KIE cost, activity, advanced), Pricing & packages (summary, model prices with supplier cost, package editor, reference values and supplier currencies, per-model price editor, bulk markup), Supplier balances (all suppliers, KIE runway and warning, generation pipeline, KIE activity) |
| `src/lib/pricing/**` | Exact-decimal credit arithmetic mirrored from the database (contract-tested) |
| `tests/contracts/*.test.ts` | Provider, webhook, safe-fetch, cookie, redirect and file-sniffing contract tests (`npm run test:contracts`) |
| `supabase/tests/*.sql` | Database invariant tests (run in one transaction, always rolled back) |

## 5. HTTP API (guide §20 mapping)

All responses are `Cache-Control: private, no-store` except the public catalog (5 s edge cache, so availability changes reach customers almost at once) and plans (30 s). Mutations with the
session cookie require a same-site `Origin`.

| Route | Notes |
| --- | --- |
| `GET /api/catalog`, `GET /api/plans` | Public projections (enabled models with published prices; published products) |
| `GET/PATCH /api/me` | Identity, verified-email flag, capabilities; allowlisted profile fields |
| `GET /api/wallet`, `GET /api/wallet/ledger?before=&limit=` | Balances, lots, statement (cursor) |
| `POST /api/uploads/intents`, `POST /api/uploads/{id}/finalize` | Intent → browser uploads to the one authorized path → bytes verified server-side |
| `POST /api/generation/quotes` | Server quote |
| `POST /api/generations` (Idempotency-Key) · `GET /api/generations` | 202 intent · own history (cursor, tool/state/favourites) |
| `GET/PATCH /api/generations/{id}`, `POST …/cancel` | Own job, flags, cancel-before-claim |
| `GET /api/assets`, `DELETE /api/assets/{id}`, `POST …/download`, `POST …/shares`, `DELETE /api/shares/{id}`, `GET /s/{token}` | Library, deletion, 5-min signed URLs, revocable expiring shares |
| `GET/POST /api/collections`, `POST /api/collections/{id}/assets` | Collections |
| `POST /api/billing/checkout` (Idempotency-Key), `GET /api/billing/overview`, `GET /api/billing/orders/{id}` | Server-priced checkout (503 until a gateway is configured); orders + subscription (guide's `/orders` + `/subscription`) |
| `POST /api/webhooks/billing`, `POST /api/webhooks/kie` | Verified receipts → queues; fail closed without keys |
| `POST /api/internal/workers/{control|media|events}`, `GET /api/internal/health` | Bearer `INTERNAL_WORKER_TOKEN`; health reports presence of configuration, never values |
| `GET /api/notifications`, `POST /api/notifications/read` | Own notifications |
| `GET/POST /api/support/tickets`, `POST /api/support/tickets/{id}/messages` | Own requests |
| `POST /api/auth/{sign-up,sign-in,sign-out,reset,update-password}`, `GET /auth/{callback,confirm}` | Supabase Auth; no account enumeration; same-site redirects only |
| `GET /r/{slug}` | Referral click; signed cookie only with consent (GPC respected) |
| `/api/affiliate/{overview,links,referrals,commissions,payouts,applications,links/{id}/archive,payout-destination}` | Partner portal (allowlisted) |
| `/api/admin/…` | Allowlisted reads and audited actions — see `src/app/api/admin/[...path]/route.ts`; staff-role changes need a sign-in within 10 min (and MFA when enrolled) |
| `/api/admin/catalog`, `…/catalog/models/{id}`, `…/availability`, `…/models/availability` (bulk), `…/display`, `…/prices`, `…/costs`, `…/evidence`, `…/tests` (Idempotency-Key), `…/prices/{id}/publish|restore`, `…/bulk-pricing/preview|apply`, `…/packages/impact`, `…/assumptions`, `…/batches`, `…/tests/outputs/{assetId}`, `…/catalog/supply` (`provider.read`: supplier serving each model and every supplier quote for its default request; products outside the catalog, each once) | Catalog workspace. Enabling and tests are refused with `CREDENTIALS_MISSING` when this deployment cannot reach KIE |
| `/api/admin/provider/summary`, `…/provider/balance/refresh`, `…/provider/low-balance` | KIE balance, spend and job health (`provider.read`); the KIE key never leaves the server |

Not implemented (no navigation points to them): subscription change/cancel endpoints (no gateway yet), account-deletion
self-service (handled through a support request), transactional email sending, resumable (TUS) uploads for imports over the
Storage standard-upload limit.
