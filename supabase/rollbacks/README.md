# Rollbacks

A rollback is written and tested with its migration but is **not applied**. To undo a migration, apply the rollback file
as a new migration (Supabase MCP `apply_migration` or `supabase db push`) with the owner's agreement, then run the
matching test in `supabase/tests/`.

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
