# Local migration tests

An isolated database on this computer for testing migrations before they reach production: embedded PostgreSQL 17
(the production project runs 17.11), created fresh from `supabase/migrations/`. Nothing here connects to Supabase.

One-time install (kept out of the app's dependencies and out of git):

```sh
npm i --prefix supabase/local-test/.tools embedded-postgres@17.10.0-beta.17 pg@8
```

Typical run (from the repository root):

```sh
node supabase/local-test/run.mjs fresh migrations:20261015032953 tests \
  sql:seed-image-edit-production-state.sql migrations tests:01,02,03,04,05,06,07 \
  rollback tests:01,02,03,04,05,06 stop
```

`shim.sql` stands in for the Supabase platform pieces the migrations use: the `anon` / `authenticated` /
`service_role` roles and default grants, `auth.users` with `auth.uid()` / `auth.jwt()`, the storage tables and
`storage.foldername`, `vault.decrypted_secrets`, and inert `cron.schedule` / `net.http_post` (nothing is scheduled or
sent). pgmq 1.4.4 is installed from its published plain-SQL script (pinned URL and SHA-256). The local server runs as a
superuser; tests switch roles exactly as on Supabase (`supabase/tests/00_helpers.sql`).

`seed-image-edit-production-state.sql` reproduces production's Image Edit catalog state (enabled models, one reference
image, the published price rules read on 18 Oct 2026), so migration `20261018013256_image_edit_multi_reference` runs
against real data shapes: stop at the migration before it, load the fixture, then apply the rest.
