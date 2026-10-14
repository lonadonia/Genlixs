@AGENTS.md

# Genlixs

**Resuming work? Read `HANDOFF.md` first** — current state, pending tasks, working rules and how to re-run QA.

Design preview of the Genlixs public site, customer studio, admin console and partner portal.
Read `design-handoff/genlixs/03_CLAUDE_CODE_MASTER_PROMPT.md` before changing anything; requirements live in
`design-handoff/genlixs/01_CLIENT_BRIEF_ANALYSIS.md` and the design system in `02_CREATIVE_DESIGN_BLUEPRINT.md`.
Two modes: without `NEXT_PUBLIC_SUPABASE_*` the design preview runs on simulated data (`src/lib/demo-store.ts`,
`src/lib/admin-data.ts`) — never present it as real. With them, the live backend runs (Supabase + KIE, see `docs/BACKEND.md`,
`docs/SETUP_AND_ACTIVATION.md`). Schema changes go into a new file in `supabase/migrations/` before they are applied.
