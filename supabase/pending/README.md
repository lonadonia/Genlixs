# Pending migrations (not applied to production)

Files here are written and tested but **not applied**. Applying one changes production behaviour, so it needs the
owner's explicit authorization. To apply: move the file into `supabase/migrations/` (keep or update the version), apply it
with the Supabase MCP `apply_migration` or `supabase db push`, regenerate `src/lib/supabase/database.types.ts` if
signatures changed (they do not here), and run the matching test in `supabase/tests/`.

## 20261018120000_image_edit_multi_reference.sql

Image Edit with several reference images.

| Model | Images (new) | Documented provider field (docs.kie.ai, re-read 18 Oct 2026) |
| --- | --- | --- |
| `gpt-flare-edit` | 16 | `input_urls`, maxItems 16 |
| `gpt-sunburst-edit` | 16 | `input_urls`, maxItems 16 |
| `nano-banana-pro-edit` | 8 | `image_input`, maxItems 8 (30 MB each) |
| `flux-2-pro-edit` | 8 | `input_urls`, maxItems 8 (10 MB each) |
| `seedream-5-flash-edit` | 10 | `image_urls`, maxItems 10 (30 MB each) |

- **Order**: references keep the customer's order end to end. `normalize_generation_input` sorted them by id; jobs copied
  the list without an explicit order; `worker_claim` returned them in table order. All three keep the order now; a
  repeated id counts once at its first position.
- **Prices**: unchanged. Each published price is re-bound to the new capability version with the same rules (the vm3
  pattern) and audited. These endpoints are billed per output image, not per input image. Quotes created before the
  migration become stale; the studio refreshes them before any charge.
- **Per-file limits** stay at the product's 10 MB, PNG/JPEG/WebP.
- **Copy**: two model descriptions that said "one image" / "a reference image" now say "your images" (only if unchanged).

**Rollback**: `20261018120000_image_edit_multi_reference.rollback.sql` adds capability versions with one image again,
re-binds the prices unchanged, restores the two descriptions and the previous function definitions (verbatim; their
fingerprints match production's current ones). Jobs already created with several references still run.

**Production vs. local until it is applied**

| | Production (now) | After applying (verified locally) |
| --- | --- | --- |
| Images per edit model | 1 (catalog `references.max`) | 16 / 16 / 8 / 8 / 10 |
| Studio | shows `0 / 1`; extra files are refused with a message; no silent discard | the same UI shows the model's limit; no code change needed |
| Order of several references | not reachable (one image) | kept from the upload order to the provider request |

**Verified** on an isolated local PostgreSQL 17 (`supabase/local-test`), with all 25 applied migrations, the
production state of the five edit models (prices and descriptions read on 18 Oct 2026), and the eight related function
definitions identical to production's (md5 of `pg_get_functiondef`):

1. tests 01–06 pass before; 07 fails before (limit 1) — expected;
2. after the migration, 01–07 pass (65 groups); with the old functions and raised limits, 07 fails on the order (R2);
3. applying it again changes nothing (no new versions, prices or audit rows);
4. after the rollback: one image again, the same prices, definitions identical to production, 01–06 pass;
5. applying it again after the rollback works.

Not verified: a live provider run with several images (cost-bearing; needs the migration in production).
