# Setup and activation — what the owner still has to configure

Everything in the repository and the Supabase database is in place. The items below need the owner's accounts, secrets or
business decisions. **Never paste secret values into a chat, an issue or a commit**; enter them directly in the dashboards.

Current state (14 Oct 2026):
- Supabase project `qlpxdrbadakbyzdyfrnk` holds the full schema, queues, cron jobs and seeds (all models disabled, all prices,
  products and the partner agreement in draft). It has no users.
- Vercel project `genlixs` deploys branch `claude/nice-curie-ispn6l`. **No environment variables are set**, so the deployed site
  still runs as the design preview. Setting the two public Supabase values switches it to live mode.
- The Vercel account is on the Hobby plan, which Vercel restricts to non-commercial use. Move to Pro before selling.

## 1. Order of activation

1. **Supabase Auth**
   - Authentication → URL configuration: Site URL `https://genlixs.com` (or the Vercel URL while testing); add redirect URLs
     `https://genlixs.com/auth/callback`, `https://genlixs.com/auth/confirm` and the same for each test origin.
   - Authentication → SMTP: configure a real sender. The built-in sender only reaches project team members, so customers
     would never receive confirmation emails.
   - Recommended: enable leaked-password protection and MFA (TOTP) for staff accounts.
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
6. **KIE account**: fund it, confirm access to the three launch models, set the callback HMAC key, and set
   `ALLOW_PAID_PROVIDER_TESTS=true` only on the environment where you run the controlled paid tests (production does not need it).
7. **Controlled real-provider checks** (guide §26.5) — one real job per model, then in Admin → Models:
   record the verification evidence, create/publish the approved price version, and set the model `enabled`.
   Confirm the media hosts seen in the real result URLs and update `MEDIA_FETCH_ALLOWED_HOSTS` if they differ.
8. **Payments**: choose a gateway available to the business (Stripe does not support Morocco-based accounts), implement its
   adapter in `src/lib/billing/` (createCheckout, verifyWebhook, submitRefund) and set `BILLING_PROVIDER`,
   `BILLING_API_SECRET`, `BILLING_WEBHOOK_SECRET`. Until then checkout answers "Payments are not available yet".
   Then publish the approved products in Admin → Models, prices & terms.
9. **Partner programme**: confirm the proposed terms (attribution window, renewal months, hold days, payout threshold),
   edit the draft if needed and publish the agreement. Approvals are refused until an agreement is published.
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
