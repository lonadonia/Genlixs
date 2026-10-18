# Rollbacks

A rollback is written and tested with its migration but is **not applied**. To undo a migration, apply the rollback file
as a new migration (Supabase MCP `apply_migration` or `supabase db push`) with the owner's agreement, then run the
matching test in `supabase/tests/`.

## 20261018232513_automatic_pricing

Undoes automatic pricing (applied 18 Oct 2026, 23:25 UTC): drops the three re-pricing triggers and the policy
functions, and restores the per-model and bulk price editors, the reference-value impact preview, the earlier readiness
wording and the earlier supplier view. Prices stay exactly as published (policy versions use the same table format);
the policy history table, `price_versions.policy_version_id` and the `policy` source are kept for the audit trail, and
`price_units_for` keeps its `_refs` lookup so a published policy table keeps quoting. Tested locally: migrations →
test 10 → rollback → tests 01–09 (the versions before automatic pricing) pass; the restored bodies equal production's
before the migration (normalized-source md5 of all 14 replaced functions). Deploy the previous release after applying it.

## 20261018181012_multi_provider_routing

Undoes the twelve parts `20261018181012`…`20261018182418_multi_provider_routing_part01`…`part12` (applied 18 Oct 2026).
Restores the previous quote, job creation, staff test, public catalog and KIE balance-reading functions and switches every
non-original supplier offer off, so only each model's original KIE route is used again. The new tables (offers, prices,
keys, cost ledger, balances) and the worker functions for routed attempts stay, so jobs already sent to another supplier
finish and nothing financial is lost. Tested locally: migrations → test 08 → rollback → tests 01–07 pass. Deploy the
previous release after applying it.

## 20261018013256_image_edit_multi_reference

The migration (applied on 18 Oct 2026 with the owner's go-ahead) lets Image Edit take several reference images:

| Model | Images | Documented provider field (docs.kie.ai, re-read 18 Oct 2026) |
| --- | --- | --- |
| `gpt-flare-edit` | 16 | `input_urls`, maxItems 16 |
| `gpt-sunburst-edit` | 16 | `input_urls`, maxItems 16 |
| `nano-banana-pro-edit` | 8 | `image_input`, maxItems 8 (30 MB each) |
| `flux-2-pro-edit` | 8 | `input_urls`, maxItems 8 (10 MB each) |
| `seedream-5-flash-edit` | 10 | `image_urls`, maxItems 10 (30 MB each) |

- **Order**: references keep the customer's order end to end. `normalize_generation_input` sorted them by id; jobs copied
  the list without an explicit order; `worker_claim` returned them in table order. All three keep the order now; a
  repeated id counts once at its first position.
- **Prices**: unchanged. Each published price was re-bound to the new capability version with the same rules (the vm3
  pattern) and audited. These endpoints are billed per output image, not per input image.
- **Per-file limits** stay at the product's 10 MB, PNG/JPEG/WebP.
- **Copy**: two model descriptions that said "one image" / "a reference image" now say "your images".

**Rollback** (`20261018013256_image_edit_multi_reference.rollback.sql`): adds capability versions with one image again,
re-binds the prices unchanged, restores the two descriptions and the previous function definitions (verbatim; their
fingerprints match the production definitions before the migration). Jobs already created with several references
still run.

**Verification**
- Isolated local PostgreSQL 17 (`supabase/local-test`) with all earlier migrations and production's Image Edit state:
  tests 01–07 pass (65 groups); with the old functions test 07 fails on the order; re-applying changes nothing; the
  rollback restores one image, the same prices and definitions identical to production's earlier ones.
- Production (18 Oct 2026): the stored migration text is byte-identical to the file (md5 `a3995d60…`); the eight related
  function definitions match the local run (md5 of `pg_get_functiondef`); capability v2 with 16/16/8/8/10, prices v+1
  with unchanged rules and audit entries; `supabase/tests/07` → `PASS: 8 image-edit reference test groups` in a
  rolled-back transaction (nothing left behind); `/api/catalog` reports the new limits.
- Not run: a paid live generation with several images.
