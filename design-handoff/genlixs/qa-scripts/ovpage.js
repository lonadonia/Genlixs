// Page-level horizontal overflow check (document scrollWidth vs clientWidth) at several widths.
// Usage: node ovpage.js <baseUrl> <paths> <widths>
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const [base, paths, widths] = process.argv.slice(2);
  const b = await chromium.launch();
  const rows = [];
  const errs = [];
  for (const w of widths.split(',').map(Number)) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${w} ${p.url()} pageerror ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${w} ${p.url()} ${m.text()}`); });
    await p.goto(base + '/help', { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.setItem('genlixs-preview-v3', JSON.stringify({ v: 2, signedIn: true, email: 'x@y.z' })));
    for (const path of paths.split(',')) {
      await p.goto(base + path, { waitUntil: 'networkidle' });
      const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      rows.push({ w, path, o });
    }
    await ctx.close();
  }
  await b.close();
  const bad = rows.filter((r) => r.o > 0);
  console.log(`${rows.length} page/width checks, ${bad.length} with horizontal overflow`);
  bad.forEach((r) => console.log('OVERFLOW', r));
  console.log(`${errs.length} console/page errors`);
  errs.slice(0, 10).forEach((e) => console.log('ERR', e));
})();
