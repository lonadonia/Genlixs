# 05 · GitHub / Vercel handoff — Genlixs

```
Project: Genlixs design preview (public site, customer studio, admin console, partner portal)
Implementation: BUILT — all four surfaces, simulated data layer (see "Scope" below)
Stack: Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4, npm (package-lock.json), Node >= 20.9
Local path: /home/user/Genlixs
Local build: PASS — `npm run build` exit 0, 64 routes (also `npm run lint` exit 0, `npm run typecheck` exit 0)
GitHub status: PUSHED
GitHub repo URL: https://github.com/lonadonia/Genlixs
Visibility: PUBLIC (verified via GitHub API, 13 Oct 2026)
Branch: claude/nice-curie-ispn6l
Commit SHA: e15e273e8925f91d114a80567be0184dffee140f (application + handoff); this file is added in the follow-up docs commit on the same branch
Vercel readiness: VERIFIED_READY — default Next.js settings, no vercel.json needed, no required env vars, no secrets, no localhost hard-coding in runtime code
Vercel preview: PREVIEW_NOT_DEPLOYED
Vercel URL: NOT_AVAILABLE
Environment keys (names only): NEXT_PUBLIC_SITE_URL (optional)
Unresolved blockers: Vercel account identity mismatch (below); blueprint, approved media, pricing, legal copy not supplied
Next user action: confirm which Vercel account should host the preview, then import the repo (steps below)
```

## Why no Vercel preview was created

The Vercel connector in this session is authenticated as **`mbanaoui147-4280`** (Hobby plan). That account's GitHub import namespace (ID 145775965) is **not** the GitHub user that owns this repository (`lonadonia`, ID 155834495), and its email differs from the requester's. Creating a project in an account whose ownership could not be confirmed — and linking a repository that account's GitHub app may not be able to read — was not done. Nothing was deployed and no Vercel settings were changed.

## One-time setup to get a preview

1. Sign in to the Vercel account that should own the preview.
2. **Add New → Project → Import Git Repository** → choose `lonadonia/Genlixs` (grant the Vercel GitHub app access to the repo if asked).
3. Framework: Next.js (auto-detected). Install `npm install`, build `next build`, output automatic. Node 20.x or 22.x.
4. Optional environment variable for **Preview**: `NEXT_PUBLIC_SITE_URL` = the preview URL.
5. Deploy. Pushes to `claude/nice-curie-ispn6l` (and any non-production branch) create Preview Deployments. Keep production promotion for after the open items in `04_QA_ACCEPTANCE_CHECKLIST.md` §6.

If you confirm that `mbanaoui147-4280` is your account, a Claude session with the Vercel connector can link the repo and create the preview directly.

## Scope delivered on the branch

- `src/` — 27 page routes across the four surfaces, shared components and tokens.
- `public/brand/`, `src/app/{icon,apple-icon,opengraph-image}.png`, `favicon.ico` — web exports of the supplied logo.
- `brand/source/` — the four supplied logo masters (6.2 MB, not served).
- `public/media/concept/` — temporary procedural concept media (replace before launch).
- `design-handoff/genlixs/` — 01–05 docs, 18 QA screenshots, QA scripts.

## Verification summary (production build)

| Check | Result |
| --- | --- |
| Lint / typecheck / build | Pass / pass / pass |
| Journeys (36 assertions incl. all §15 prototypes, simulated) | 36 / 36 pass, 0 console errors |
| Keyboard, focus, reduced motion | 8 / 8 pass |
| axe-core WCAG 2.x A/AA, 27 routes | 0 violations |
| Overflow + console, 27 routes × 5 widths | 0 / 135 overflow, 0 errors |

## Safety notes

- No force-push, no history rewrite, no PR opened (not requested).
- `.env*` ignored except `.env.example`; staged files scanned for secret patterns — none.
- Production on Vercel: untouched (no deployment exists).
- The repository is **public**: the logo masters and these docs are visible to anyone. Switch it to private in GitHub settings if that is not intended.
