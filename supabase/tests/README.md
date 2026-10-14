# Database invariant tests

Each test file is one `DO` block that ends with `raise exception 'PASS: …'`, so every change it makes is rolled back even when
it passes. A failing assertion raises a different message.

Run against a development/staging project when one exists. The tests were run on the production project (the only one) in
rolled-back transactions; they create their own users and roles and leave nothing behind.

1. Open a SQL session (Supabase SQL editor, `psql`, or the Supabase MCP `execute_sql` tool).
2. Send `00_helpers.sql` **and** one test file in the same request — the helpers are `pg_temp` functions that live only in
   that session.
3. Expected result: an error whose message is `PASS: 14 generation/wallet test groups` (01),
   `PASS: 11 billing/affiliate/admin test groups` (02), `PASS: 8 catalog/pricing test groups` (03) or
   `PASS: 8 simplified-pricing test groups` (04).
   Tests 03 and 04 start by switching every model off and retiring every price inside their own transaction, and set the
   reference values they need, so they are independent of the live catalog state. A session switched to the `authenticated`
   role cannot read `app_private`; helpers such as `pg_temp.t_save_ref` read what they need before switching.

Afterwards the database is unchanged; check with
`select count(*) from auth.users; select count(*) from public.generation_jobs;`.
