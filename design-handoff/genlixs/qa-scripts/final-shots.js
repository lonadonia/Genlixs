// Final v2 screenshot set. Usage: node final-shots.js <baseUrl> <outDir>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const SIGNED = { v: 2, signedIn: true, email: 'demo.creator@example.com' };
(async () => {
  const [base, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const shoot = async ({ name, url, w, h, signed, scrollTo, full, motion }) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: motion ? 'no-preference' : 'reduce' });
    const p = await ctx.newPage();
    if (signed) {
      await p.goto(base + '/help', { waitUntil: 'networkidle' });
      await p.evaluate((s) => localStorage.setItem('genlixs-preview-v3', JSON.stringify(s)), SIGNED);
    }
    await p.goto(base + url, { waitUntil: 'networkidle' });
    if (full) {
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
        window.scrollTo(0, 0);
      });
      await p.waitForLoadState('networkidle');
    }
    if (scrollTo) {
      await p.locator(scrollTo).first().scrollIntoViewIfNeeded();
      await p.evaluate((sel) => { const el = document.querySelector(sel); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76); }, scrollTo);
      await p.waitForLoadState('networkidle');
    }
    await p.waitForTimeout(700);
    await p.screenshot({ path: path.join(out, name + '.png'), fullPage: Boolean(full) });
    await ctx.close();
  };
  const list = [
    { name: '01-home-hero-1440', url: '/', w: 1440, h: 900, motion: true },
    { name: '02-home-composer-1440', url: '/', w: 1440, h: 900, scrollTo: '#create' },
    { name: '03-home-gallery-1440', url: '/', w: 1440, h: 900, scrollTo: '#examples' },
    { name: '04-home-768', url: '/', w: 768, h: 1024 },
    { name: '05-home-390', url: '/', w: 390, h: 844 },
    { name: '06-home-fullpage-1440', url: '/', w: 1440, h: 900, full: true },
    { name: '07-studio-home-1440', url: '/studio', w: 1440, h: 900, signed: true },
    { name: '08-studio-home-390', url: '/studio', w: 390, h: 844, signed: true },
    { name: '14-library-1440', url: '/studio/library', w: 1440, h: 900, signed: true },
    { name: '15-studio-collapsed-rail-1024', url: '/studio/image', w: 1024, h: 900, signed: true },
    { name: '16-studio-mobile-390', url: '/studio/image', w: 390, h: 844, signed: true },
    { name: '17-sign-in-1440', url: '/sign-in?next=%2Fstudio%2Fimage', w: 1440, h: 900 },
    { name: '18-admin-overview-1440', url: '/admin', w: 1440, h: 900 },
    { name: '19-admin-jobs-1440', url: '/admin/jobs', w: 1440, h: 900 },
    { name: '20-admin-job-detail-1440', url: '/admin/jobs/J-5CQC1', w: 1440, h: 900 },
    { name: '21-admin-payouts-1440', url: '/admin/payouts', w: 1440, h: 900 },
    { name: '22-admin-jobs-390', url: '/admin/jobs', w: 390, h: 844 },
    { name: '23-partner-overview-1440', url: '/partner', w: 1440, h: 900 },
    { name: '24-partner-overview-390', url: '/partner', w: 390, h: 844 },
    { name: '25-home-showcase-1440', url: '/', w: 1440, h: 900, scrollTo: '#showcase', motion: true },
    { name: '26-home-hero-1920', url: '/', w: 1920, h: 1080, motion: true },
  ];
  for (const s of list) await shoot(s);
  await b.close();
  console.log('done', list.length);
})();
