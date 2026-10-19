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
   reference values and the pricing policy they need, so they are independent of the live catalog state. Since automatic
   pricing (migration `20261018232513_automatic_pricing`) they check prices made by the global policy and that the retired
   per-model and bulk editors refuse with `PRICING_AUTOMATIC`. A session switched to the `authenticated` role cannot read
   `app_private`; helpers such as `pg_temp.t_save_ref` and `pg_temp.t_apply_policy` read what they need before switching.

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

Test 10 (`10_automatic_pricing_tests.sql`) checks `20261018232513_automatic_pricing` (one global policy: KIE reference ×
(1 + markup) ÷ USD per Genlixs credit, rounded up once per request): the brief's examples ($0.10 at +100 % and $0.01 =
20 credits; effective markup 100 / 150 / 300 % for a $0.10, $0.08 and $0.05 supplier; 25 credits and 212.5 % at +150 %;
10 credits at $0.02; $0.025 → 3 credits), every configuration of every model against the formula, a cheaper supplier
serving without moving the price, Save & apply (permissions, preview saves nothing, stale editor, unchanged repeat,
quotes re-checked, accepted jobs/wallets/packages untouched, audit), automatic re-pricing from a new KIE price list or KIE
credit price, KIE reference needed, whole-request rounding with extra reference images, and the retired editors
(`PASS: 8 automatic pricing test groups`). It re-prices every model inside its transaction, so run it locally.

Test 11 (`11_route_fallback_tests.sql`) checks `20261018235333_route_fallback_original`: a cheaper offer short of balance,
behind its circuit breaker or past its daily cap no longer blocks a request the original KIE route can serve (the quote
is unchanged); the cheaper offer serves again when funded; with several cheaper offers the cheapest available one up to
the original route's cost is chosen; without a routable original route the old rule applies; nothing above the original
route's cost is used (`PASS: 6 route fallback test groups`). Without the migration it fails at F1 with "Every eligible
offer is temporarily unavailable" — the defect it fixes. Run it locally (it changes supplier rows inside its transaction).

Test 12 (`12_documented_activation_tests.sql`) checks `20261019010705_documented_activation`: only `provider.manage`
activates (`provider.read` sees the checks); with production-like keys, connection checks and balances exactly the 8
expected offers qualify and the 9 blocked ones fail on the right check; each check blocks on its own and a refusal
changes nothing; acknowledgement and reason are required and recorded (note, snapshot, audit); routing then uses the
offer, 2K Flare keeps the original route and customer credits / price versions do not change; "Live-tested" is refused
for a note, an unknown job, an unpinned job and an unfinished pinned test, and accepted for a succeeded pinned test;
routing on re-runs the checks; a documentation question switches a documented offer off; the safety stop switches it off
on a supplier refusal and on a failed job, never a live-tested one (`PASS: 8 documented activation test groups`). The
worker calls record simulated replies; nothing is sent. Run it locally (it changes supplier rows inside its transaction).
Since this migration, test 08 activates its NezhaGate offer with the documented checks instead of a typed "test job" note.

Test 08 (`08_multi_provider_routing_tests.sql`) checks migrations `20261018181012`…`20261018182418` (multi-provider
routing, parts 01–12, applied 18 Oct 2026; run locally — on production it would lock every model and provider row): the 14
acceptance items of the multi-provider brief (`PASS: 14 multi-provider test groups`). It creates test models `tst-*` and
supplier offers inside its transaction; everything is rolled back.
