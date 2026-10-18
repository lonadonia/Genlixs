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

Test 07 (`07_image_edit_references_tests.sql`) checks migration `20261018013256_image_edit_multi_reference` (applied
18 Oct 2026): `PASS: 8 image-edit reference test groups` on production and locally; on a database without that
migration it stops at `R1 limit …` by design. All tests can also run on an isolated local database: see
`supabase/local-test/README.md`.

Test 09 (`09_catalog_supply_tests.sql`) checks `20261018194110_catalog_supply` (the read-only supplier view behind Admin ›
Models, Pricing and Supplier balances): access, one entry per model with the router's own choice marked, costs exactly as
the router computes them (USD, illustrative CNY, card fee, incompatible settings), the first missing step per offer, each
product outside the catalog once, and no key material (`PASS: 6 catalog supply test groups`). It changes no shared rows,
so it also runs on production inside its rolled-back transaction (done on 18 Oct 2026).

Test 08 (`08_multi_provider_routing_tests.sql`) checks migrations `20261018181012`…`20261018182418` (multi-provider
routing, parts 01–12, applied 18 Oct 2026; run locally — on production it would lock every model and provider row): the 14
acceptance items of the multi-provider brief (`PASS: 14 multi-provider test groups`). It creates test models `tst-*` and
supplier offers inside its transaction; everything is rolled back.
