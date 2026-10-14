# Database invariant tests

Each test file is one `DO` block that ends with `raise exception 'PASS: …'`, so every change it makes is rolled back even when
it passes. A failing assertion raises a different message.

Run against a development/staging project (never production data you care about):

1. Open a SQL session (Supabase SQL editor, `psql`, or the Supabase MCP `execute_sql` tool).
2. Send `00_helpers.sql` **and** one test file in the same request — the helpers are `pg_temp` functions that live only in
   that session.
3. Expected result: an error whose message is `PASS: 14 generation/wallet test groups` (01) or
   `PASS: 11 billing/affiliate/admin test groups` (02).

Afterwards the database is unchanged; check with
`select count(*) from auth.users; select count(*) from public.generation_jobs;`.
