# QA scripts

Playwright scripts used to produce the evidence in `../04_QA_ACCEPTANCE_CHECKLIST.md`.
They expect Playwright at `/opt/node-tools/node_modules/playwright` (the Claude Code cloud image); change the `require` path for other machines.

```bash
npm run build && npx next start -p 3200 &
node flows.js http://localhost:3200 ./out                 # 36 journey assertions
node kbd.js                                                # keyboard / focus / reduced motion (uses port 3200)
node shot.js http://localhost:3200 ./out /,/studio 1440,390 0 1   # screenshots + overflow; last arg = signed in
node axe.js http://localhost:3200 /,/studio ./node_modules/axe-core/axe.min.js   # needs `npm i axe-core`
```
