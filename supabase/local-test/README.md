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

Multi-provider routing (migrations `20261018181012`…`20261018182418`, parts 01–12): all suites, then its rollback and
the earlier suites again:

```sh
node supabase/local-test/run.mjs fresh migrations tests:01,02,03,04,05,06,07,08 \
  rollback:20261018181012 tests:01,02,03,04,05,06,07 stop
```

Automatic pricing (migration `20261018232513_automatic_pricing`): all suites including 10, then its rollback and the
earlier suites again (use the versions of tests 03 and 04 from before that migration, e.g. `git show 8b1c7e3:<file>`):

```sh
node supabase/local-test/run.mjs fresh migrations tests:01,02,03,04,05,06,07,08,09,10 \
  rollback:20261018232513 tests:01,02,03,04,05,06,07,08,09 stop
```

`rollback:<version>` applies `supabase/rollbacks/<version>_*.rollback.sql`; plain `rollback` keeps applying the Image Edit rollback.
`design-handoff/genlixs/qa-scripts/v36/dump-local-fixtures.mjs` turns this database into admin API fixtures for the
browser check of the two admin pages (one rolled-back transaction).

`shim.sql` stands in for the Supabase platform pieces the migrations use: the `anon` / `authenticated` /
`service_role` roles and default grants, `auth.users` with `auth.uid()` / `auth.jwt()`, the storage tables and
`storage.foldername`, `vault.decrypted_secrets` with `vault.create_secret` / `vault.update_secret` (plain text here, encrypted on Supabase), and inert `cron.schedule` / `net.http_post` (nothing is scheduled or
sent). pgmq 1.4.4 is installed from its published plain-SQL script (pinned URL and SHA-256). The local server runs as a
superuser; tests switch roles exactly as on Supabase (`supabase/tests/00_helpers.sql`).

`seed-image-edit-production-state.sql` reproduces production's Image Edit catalog state (enabled models, one reference
image, the published price rules read on 18 Oct 2026), so migration `20261018013256_image_edit_multi_reference` runs
against real data shapes: stop at the migration before it, load the fixture, then apply the rest.
