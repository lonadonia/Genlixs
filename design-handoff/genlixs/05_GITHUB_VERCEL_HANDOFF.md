# 05 · GitHub / Vercel handoff — Genlixs

```
Project: Genlixs design preview (public site, customer studio, admin console, partner portal) — brand v2
Implementation: BUILT — all four surfaces restyled to brand v2 (electric blue #253FF6 primary), simulated data layer
Stack: Next.js 16.3.8 (App Router, Turbopack), React 19.2.8, TypeScript 5, Tailwind CSS 4, npm (package-lock.json), Node >= 20.9
Local path: /home/user/Genlixs
Local build: PASS — `npm run build` exit 0, 64 pages (also `npm run lint` exit 0, `npm run typecheck` exit 0)
GitHub status: PUSHED
GitHub repo URL: https://github.com/lonadonia/Genlixs
Visibility: PUBLIC (verified via GitHub API, 13 Oct 2026)
Branch: claude/nice-curie-ispn6l
Commit SHA: branch head — v2.1 commit (client Drive media + hero tiles at media ratio) on top of 98b2763c81419da858c74aeebb07e7fb19c6fac0 (brand v2)
Vercel readiness: VERIFIED_READY — default Next.js settings, no vercel.json needed, no required env vars, no secrets
Vercel preview: PREVIEW_NOT_DEPLOYED
Vercel URL: NOT_AVAILABLE
Environment keys (names only): NEXT_PUBLIC_SITE_URL (optional)
Unresolved blockers: Vercel account ownership not confirmed (below); 26 client Drive videos over the connector's 10 MB limit; rights/model record for client media; blueprint, pricing, legal copy not supplied
Next user action: (1) confirm which Vercel account should host the preview; (2) compress the Drive videos under 10 MB, or allow Google Drive in the environment's network access; (3) confirm usage rights for the client media
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

## Client Drive media (REQ-063)

**Partly done.** The Drive connector returns files of 10 MB or less. From the folder's `IMAGES` and `VIDEOS` subfolders, 25 files came through. 14 images and the one clip under 10 MB (muted) are now on the site, in `public/media/client/`. `CLIENT_MEDIA.md` lists every file used, excluded (watermark or third-party brand marks) or not fetched.

Still open:
- **26 of 27 videos** are 12–43 MB, over the connector's limit. Direct `drive.google.com` access still returns HTTP 403 from the egress proxy, and that denial was not worked around. To unblock them, do one of the following:
  - compress them under 10 MB (for example 720p H.264 at about 2–3 Mb/s, no audio) in the same folder; or
  - allow `drive.google.com`, `drive.usercontent.google.com` and `*.googleusercontent.com` in the cloud environment's **Network access** setting (https://code.claude.com/docs/en/cloud-environments#network-access).
- **Rights:** the file names carry an `hf_` prefix. Confirm the generating tool's licence allows commercial use, and record the model and settings for each file before launch.

Each new file becomes one entry in `src/lib/media.ts`. Components need no changes.

## Scope delivered on the branch

- `src/` — 27 page routes across the four surfaces, restyled to brand v2. Shared components include the hero, lit composer, MotionRegion and hover/autoplay video. Tokens live in `globals.css`.
- `public/brand/`, `src/app/{icon,apple-icon,opengraph-image}.png`, `favicon.ico` — web exports of the supplied v2 logo.
- `brand/source/` — the four supplied v2 logo masters (5.4 MB, not served).
- `brand/export_logo.py`, `brand/placeholder_renders.py` — the export and placeholder-render scripts.
- `public/media/client/` — client-supplied images and muted clip (record: `CLIENT_MEDIA.md`); `brand/client_media.py` resizes them.
- `public/media/concept/` — temporary placeholder media (replace before launch).
- `design-handoff/genlixs/` — 01–05 docs, 24 QA screenshots, QA scripts.

## Verification summary (production build, 14 Oct 2026)

| Check | Result |
| --- | --- |
| Lint / typecheck / build | Pass / pass / pass |
| Journeys (36 assertions incl. all §15 prototypes, simulated) | 36 / 36 pass, 0 console errors |
| Brand v2 interaction checks (motion pause, hover preview, studio Home quick create, hero tile ratio + corners) | 16 / 16 pass |
| Keyboard, focus, reduced motion | 8 / 8 pass |
| axe-core WCAG 2.x A/AA, 27 routes | 0 violations |
| Overflow + console, 27 routes × 5 widths | 0 / 135 overflow, 0 errors |

## Safety notes

- No force-push, no history rewrite, no PR opened (not requested).
- `.env*` ignored except `.env.example`; staged files scanned for secret patterns — none.
- Production on Vercel: untouched (no deployment exists).
- The repository is **public**: the logo masters and these docs are visible to anyone. Switch it to private in GitHub settings if that is not intended.
