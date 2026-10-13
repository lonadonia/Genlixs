// Usage: node shot.js <baseUrl> <outDir> <path1,path2,...> <widths e.g. 1440,390> [full=1] [signedIn=1]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [base, out, paths, widths, full = '1', signed = '0'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const w of widths.split(',').map(Number)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : w < 900 ? 1024 : 900 }, deviceScaleFactor: 1, reducedMotion: process.env.MOTION === '1' ? 'no-preference' : 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    if (signed === '1') {
      await page.goto(base + '/help', { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        const raw = localStorage.getItem('genlixs-preview-v2');
        const s = raw ? JSON.parse(raw) : { v: 2 };
        localStorage.setItem('genlixs-preview-v2', JSON.stringify({ ...s, v: 2, signedIn: true, email: 'demo.creator@example.com' }));
      });
    }
    for (const p of paths.split(',')) {
      await page.goto(base + p, { waitUntil: 'networkidle' });
      if (full === '1') {
        await page.evaluate(async () => {
          const step = window.innerHeight * 0.8;
          for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
          window.scrollTo(0, 0);
        });
        await page.waitForLoadState('networkidle');
      }
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const name = `${p.replace(/[\/?=&]/g, '_') || 'home'}-${w}.png`;
      await page.screenshot({ path: path.join(out, name), fullPage: full === '1' });
      report.push({ path: p, width: w, overflow, errors: errors.splice(0) });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
