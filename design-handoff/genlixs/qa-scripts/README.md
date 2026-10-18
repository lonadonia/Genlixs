# QA scripts

Playwright scripts used to produce the evidence in `../04_QA_ACCEPTANCE_CHECKLIST.md`.
They load Playwright from `PLAYWRIGHT_PATH` (default `/opt/node-tools/node_modules/playwright`, the Claude Code cloud image) and launch the browser at `CHROME_PATH` when it is set. On Windows (Git Bash), also set `MSYS_NO_PATHCONV=1` so route lists such as `/,/studio` are not rewritten:

```bash
export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" MSYS_NO_PATHCONV=1
```

```bash
npm run build && npx next start -p 3200 &
node flows.js http://localhost:3200 ./out                 # 36 journey assertions
node v2checks.js http://localhost:3200                     # 18 interaction checks (hero motion without a button, 4 columns, muted clips, click-for-sound, studio Home, hero tile ratio + corners)
node ovpage.js http://localhost:3200 /,/studio 1440,1024,768,390,360   # page overflow + console errors per width
node final-shots.js http://localhost:3200 ./shots          # the screenshot set incl. 25 showcase + 26 hero at 1920 (flow states come from flows.js)
node kbd.js                                                # keyboard / focus / reduced motion (uses port 3200)
node shot.js http://localhost:3200 ./out /,/studio 1440,390 0 1   # screenshots + overflow; last arg = signed in
node axe.js http://localhost:3200 /,/studio ./node_modules/axe-core/axe.min.js   # needs `npm i axe-core`
```

## Live-mode checks (v3)

Build with only the public Supabase values and throwaway local tokens in `.env.local`, start on port 3200, then:

```
WORKER_TOKEN=<local INTERNAL_WORKER_TOKEN> node live-api-smoke.mjs        # 36 API checks, needs no account
QA_EMAIL=… QA_PASSWORD=… PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=… node live-flows.mjs   # 30 browser checks
```

**v3.6 — two-page Admin and automatic pricing (current).** Models & pricing (pricing panel with server preview and Save &
apply, model table, drawer, packages, Add models) and Providers & balances (provider rows, drawer, details on demand),
redirects of the retired URLs, roles, 390 px overflow and axe-core. Mocked API from fixtures (`v36/dump-local-fixtures.mjs`
builds them from the isolated local database; add four read-only provider captures, see the header of `v36/mock.mjs`);
every `/api` call is intercepted and the run fails on any generation, upload or paid-test request:

```
REPO=<repo> node v36/dump-local-fixtures.mjs <fixtures-dir>        # after: node supabase/local-test/run.mjs fresh migrations
FIXTURES=<fixtures-dir> PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=… node v36/two-page-admin.mjs   # 56 checks
```

The v3.5.1 and v3.2 scripts below describe the four retired pages (Models, Pricing & packages, Supplier balances,
Providers & routing) and the retired price editors; they are kept for reference only.

Catalog pages after the multi-supplier rebuild (Models with supplier quotes and products available at suppliers, Pricing &
packages tabs, Supplier balances — the old `/admin/kie` redirects there). Mocked staff session; every admin read comes from
saved API responses (see the header of the script for the six files), every write is blocked:

```
FIXTURES=<dir> PLAYWRIGHT_PATH=… CHROME_PATH=… node v34/catalog-pages.mjs   # 19 checks incl. 390/1024/1440 px overflow
```

Simplified admin of v3.2 (Models, Pricing & packages, KIE balance; replaces the v3.1 catalog-workspace scripts). Its page
checks describe the v3.2 screens (18 models, the KIE balance page); use `v34/catalog-pages.mjs` for the current ones:

```
QA_EMAIL=… QA_PASSWORD=… node pricing-api-checks.mjs                                   # admin API checks
QA_EMAIL=… QA_PASSWORD=… PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=… node pricing-flows.mjs   # browser checks
```

Both need a temporary confirmed account with the `operations` and `finance` staff roles (not owner). They only read real data
and exercise refused writes; write flows run against intercepted responses, and a request guard fails the run if a write
reaches the server. Create the account with a bcrypt hash generated locally (no password in SQL), delete it afterwards.

`live-flows.mjs` needs a temporary confirmed account with the `operations` staff role. It creates a support request and a
partner application; delete the account and its rows afterwards (see `docs/VERIFICATION.md`).

## v3.4 — Image Edit references, video studio views, Motion Library (`v34/`)

Signed-in studio with a mocked account (user, wallet, quotes, uploads and generations are answered in the browser; pages,
media and the public catalog come from the app). No generation, upload or charge reaches Supabase or KIE. Test images are
generated on the fly.

```bash
npm run build && npx next start -p 3200 &
export PLAYWRIGHT_PATH=… CHROME_PATH=… AXE_PATH=…/axe-core/axe.min.js MSYS_NO_PATHCONV=1
node v34/image-edit.mjs     # 26 checks: old Edit URL, modes and drafts, several references (append, remove, retry, limits, order)
node v34/video-studio.mjs   # 42 checks: opens on How it works, views, walkthrough carousel, Motion Control banner, Motion Library preview and Recreate
node v34/shots.mjs          # 8 pages × 1440, 1024, 768, 390, 360 and 1440×700: screenshots, overflow, page errors
node v34/axe.mjs            # axe-core WCAG 2.1 A/AA on 8 states
# Admin › Providers & routing (33 checks incl. axe when AXE_PATH is set). FIXTURES = admin API replies built from the
# isolated local database (see docs/PROVIDERS_AND_ROUTING.md); nothing is sent to a supplier.
FIXTURES=providers-fixtures.json AXE_PATH=node_modules/axe-core/axe.min.js node v34/providers-admin.mjs
```
