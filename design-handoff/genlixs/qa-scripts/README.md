# QA scripts

Playwright scripts used to produce the evidence in `../04_QA_ACCEPTANCE_CHECKLIST.md`.
They expect Playwright at `/opt/node-tools/node_modules/playwright` (the Claude Code cloud image); change the `require` path for other machines.

```bash
npm run build && npx next start -p 3200 &
node flows.js http://localhost:3200 ./out                 # 36 journey assertions
node v2checks.js http://localhost:3200                     # 16 brand-v2 interaction checks (motion pause, hover preview, studio Home, hero tile ratio + corners)
node ovpage.js http://localhost:3200 /,/studio 1440,1024,768,390,360   # page overflow + console errors per width
node final-shots.js http://localhost:3200 ./shots          # the 24-image screenshot set (flow states come from flows.js)
node kbd.js                                                # keyboard / focus / reduced motion (uses port 3200)
node shot.js http://localhost:3200 ./out /,/studio 1440,390 0 1   # screenshots + overflow; last arg = signed in
node axe.js http://localhost:3200 /,/studio ./node_modules/axe-core/axe.min.js   # needs `npm i axe-core`
```
