# Setup and activation — what the owner still has to configure

Everything in the repository and the Supabase database is in place. The items below need the owner's accounts, secrets or
business decisions. **Never paste secret values into a chat, an issue or a commit**; enter them directly in the dashboards.

Current state (14 Oct 2026, after the catalog upgrade):
- Supabase project `qlpxdrbadakbyzdyfrnk` holds the full schema, queues, cron jobs and seeds: 18 curated models (all disabled,
  unpriced, untested), products and the partner agreement in draft. The owner account is bootstrapped and the Vault worker
  secrets exist.
- Vercel project `genlixs` deploys branch `claude/nice-curie-ispn6l` as production. Production variables observed (names only):
  the two public Supabase values, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_BASE_URL`, `KIE_API_BASE_URL`, `KIE_API_KEY`,
  `KIE_CALLBACK_BASE_URL`, `INTERNAL_WORKER_TOKEN`, `REFERRAL_COOKIE_SIGNING_KEY`, `MEDIA_FETCH_ALLOWED_HOSTS`.
  **`KIE_WEBHOOK_HMAC_KEY` was not in the list**: KIE callbacks are then refused and job status is read by polling (slower,
  still correct). Add it (and the same key in KIE) to receive callbacks.
- The Vercel account is on the Hobby plan, which Vercel restricts to non-commercial use. Move to Pro before selling.

## 1. Order of activation

1. **Supabase Auth**
   - Authentication → URL configuration: Site URL `https://genlixs.com` (or the Vercel URL while testing); add redirect URLs
     `https://genlixs.com/auth/callback`, `https://genlixs.com/auth/confirm` and the same for each test origin.
   - Authentication → SMTP: configure a real sender. The built-in sender only reaches project team members, so customers
     would never receive confirmation emails.
   - Recommended: enable leaked-password protection (the Supabase advisor reports it as disabled) and MFA (TOTP) for staff accounts.
2. **Vercel environment variables** (Project → Settings → Environment Variables). Public values can be copied from Supabase
   → Project Settings → API. See `.env.example` for every name.
   - Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - Server: `SUPABASE_URL` (same project), `APP_BASE_URL`, `KIE_API_BASE_URL=https://api.kie.ai`, `KIE_CALLBACK_BASE_URL`
     (stable public origin, not a preview URL), `MEDIA_FETCH_ALLOWED_HOSTS`.
   - Secrets (generate random values for the last two, e.g. `openssl rand -base64 32`): `SUPABASE_SECRET_KEY`, `KIE_API_KEY`,
     `KIE_WEBHOOK_HMAC_KEY`, `INTERNAL_WORKER_TOKEN`, `REFERRAL_COOKIE_SIGNING_KEY`.
   - Redeploy after changing variables.
3. **Supabase Vault** (Project → Vault → New secret) so Cron can wake the Vercel workers every minute:
   - `genlixs_worker_base_url` = the stable production origin (e.g. `https://genlixs.com`)
   - `genlixs_worker_token` = the same value as `INTERNAL_WORKER_TOKEN`
   Without these, queued work stays durable but only advances when a request triggers a worker pass.
4. **Deployment protection**: the webhook and worker routes must be reachable without a Vercel login. Keep protection off for
   the production domain (current setting "all except custom domains" protects `*.vercel.app` URLs — attach `genlixs.com`
   or adjust the setting before relying on callbacks/cron).
5. **Owner account**: sign up on the live site, confirm the email, then in Supabase → SQL editor run once:
   `select app_private.bootstrap_owner('<owner email>');` — it grants the `owner` role and closes the bootstrap.
   Grant other staff from Admin → Staff.
6. **KIE account**: fund it and set the callback HMAC key (KIE dashboard and `KIE_WEBHOOK_HMAC_KEY` in Vercel). Set
   `ALLOW_PAID_PROVIDER_TESTS=true` only on a non-production environment where you deliberately run paid tests (production
   does not need it).
7. **Models and prices** (Admin → Catalog; full guide in `docs/CATALOG_AND_PRICING.md`):
   - KIE balance: check it reads a real balance; set the low-balance warning (under More details);
   - Pricing & packages: confirm or change the two reference values (KIE credit cost from a top-up you made; the Genlixs
     credit value, seeded with the illustrative $5 for 250 credits), then set the price of each model you intend to offer
     (per setting, or "Apply a markup to several models");
   - Models: switch the priced models on. A private paid test (Models → Details → Private test) is optional but recommended;
     it records the task id, KIE-reported credits and the output. If an import fails with "host not allowed", confirm the host
     is a KIE delivery host and add it to `MEDIA_FETCH_ALLOWED_HOSTS`.
8. **Payments**: choose a gateway available to the business (Stripe does not support Morocco-based accounts), implement its
   adapter in `src/lib/billing/` (createCheckout, verifyWebhook, submitRefund) and set `BILLING_PROVIDER`,
   `BILLING_API_SECRET`, `BILLING_WEBHOOK_SECRET`. Until then checkout answers "Payments are not available yet".
   Then offer the approved packages in Admin → Pricing & packages → Packages.
9. **Partner programme**: confirm the proposed terms (attribution window, renewal months, hold days, payout threshold),
   edit the draft if needed and publish it (Admin → Partners → Partner commission terms). Approvals are refused until an agreement is published.
10. **Domain**: add `genlixs.com` to the Vercel project, apply the DNS records Vercel shows, then update `APP_BASE_URL`,
    `KIE_CALLBACK_BASE_URL`, Supabase Auth URLs and the Vault worker URL to it.

## 2. Verify after configuring

- `curl -H "Authorization: Bearer <token>" https://<origin>/api/internal/health` — every `config` flag should be true/configured
  and `db.watchdogHeartbeat` recent.
- Admin → Overview: queues empty, watchdog heartbeat within a minute, provider balance observed.
- Run the controlled checks in `docs/VERIFICATION.md` §3 and record the evidence there.

## 3. Local development

```bash
cp .env.example .env.local     # fill in at least the two public Supabase values
npm install && npm run dev
# deterministic fake provider (never in production): GENLIXS_FAKE_PROVIDER=1
# test payments (never in production):            BILLING_PROVIDER=test
```

Database changes: write a new file in `supabase/migrations/` first, apply it (Supabase MCP `apply_migration` or
`supabase db push`), rename the file to the applied version, regenerate `src/lib/supabase/database.types.ts`, and run the
SQL tests in `supabase/tests/`.
