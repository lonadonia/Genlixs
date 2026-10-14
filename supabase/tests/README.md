# Database invariant tests

Each test file is one `DO` block that ends with `raise exception 'PASS: …'`, so every change it makes is rolled back even when
it passes. A failing assertion raises a different message.

Run against a development/staging project when one exists. The tests were run on the production project (the only one) in
rolled-back transactions; they create their own users and roles and leave nothing behind.

1. Open a SQL session (Supabase SQL editor, `psql`, or the Supabase MCP `execute_sql` tool).
2. Send `00_helpers.sql` **and** one test file in the same request — the helpers are `pg_temp` functions that live only in
   that session.
3. Expected result: an error whose message is `PASS: 14 generation/wallet test groups` (01),
   `PASS: 11 billing/affiliate/admin test groups` (02) or `PASS: 8 catalog/pricing test groups` (03).
   Test 03 starts by disabling every model and retiring every price inside its own transaction, so it is independent of the
   live catalog state.

Afterwards the database is unchanged; check with
`select count(*) from auth.users; select count(*) from public.generation_jobs;`.
