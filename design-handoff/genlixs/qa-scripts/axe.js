// axe-core WCAG 2.x A/AA scan. Usage: node axe.js <baseUrl> <paths> <axePath>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
(async () => {
  const [base, paths, axePath] = process.argv.slice(2);
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(base + '/help', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('genlixs-preview-v3', JSON.stringify({ v: 2, signedIn: true, email: 'demo@example.com' })));
  const summary = [];
  for (const path of paths.split(',')) {
    await p.goto(base + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.addScriptTag({ path: axePath });
    const r = await p.evaluate(async () => {
      const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n').slice(1, 2).join('')) }));
    });
    summary.push({ path, violations: r });
  }
  await b.close();
  console.log(JSON.stringify(summary, null, 1));
})();
