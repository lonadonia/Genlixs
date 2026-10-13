// v2 interaction checks: motion pause, hover preview, studio Home quick create.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const results = [];
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass, detail });
(async () => {
  const base = process.argv[2];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await p.goto(base + '/', { waitUntil: 'networkidle' });
  const col = p.locator('#hero-title').locator('xpath=ancestor::section').locator('.marquee-up').first();
  const st1 = await col.evaluate((el) => getComputedStyle(el).animationPlayState);
  const pause = p.getByRole('button', { name: /Pause.*hero gallery/ }).last();
  ok('V2-1', 'Hero columns animate by default', st1 === 'running', st1);
  await pause.click();
  const st2 = await col.evaluate((el) => getComputedStyle(el).animationPlayState);
  ok('V2-2', 'Pause control stops the hero columns', st2 === 'paused', st2);
  ok('V2-3', 'Control label flips to Play', await p.getByRole('button', { name: /Play.*hero gallery/ }).last().isVisible());
  const vid = p.locator('#hero-title').locator('xpath=ancestor::section').locator('video').first();
  ok('V2-4', 'Hero loop is decorative (aria-hidden)', (await vid.getAttribute('aria-hidden')) === 'true');

  // gallery hover preview
  await p.locator('#examples').scrollIntoViewIfNeeded();
  const card = p.locator('#examples article', { hasText: 'Orbit loop' });
  await card.hover();
  await p.waitForTimeout(1200);
  const playing = await card.locator('video').evaluate((v) => !v.paused);
  ok('V2-5', 'Gallery clip previews on hover', playing);
  await p.mouse.move(5, 5);
  await p.waitForTimeout(300);
  ok('V2-6', 'Gallery clip pauses when the pointer leaves', await card.locator('video').evaluate((v) => v.paused));

  // reduced motion: hero columns not animated
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/', { waitUntil: 'networkidle' });
  const anim = await p2.locator('.marquee-up').first().evaluate((el) => getComputedStyle(el).animationName);
  ok('V2-7', 'Reduced motion disables the capsule marquee', anim === 'none', anim);
  const vplay = await p2.locator('#hero-title').locator('xpath=ancestor::section').locator('video').first().evaluate((v) => v.paused);
  ok('V2-8', 'Reduced motion keeps the loop on its poster', vplay);

  // studio Home quick create
  await p.goto(base + '/help', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('genlixs-preview-v2', JSON.stringify({ v: 2, signedIn: true, email: 'demo@example.com' })));
  await p.goto(base + '/studio', { waitUntil: 'networkidle' });
  ok('V2-9', 'Studio Home title', await p.getByRole('heading', { level: 1, name: /What would you like to create\?/ }).isVisible());
  const gen = p.getByRole('button', { name: /Generate for 4 credits/ });
  await gen.click();
  ok('V2-10', 'Empty prompt blocked with a local error', await p.locator('#home-prompt-error').isVisible());
  await p.locator('#home-prompt').fill('Glossy torus with a lime sphere, dark studio');
  await p.getByLabel('Quality', { exact: true }).selectOption('High');
  ok('V2-11', 'Quality change updates the exact cost', await p.getByRole('button', { name: /Generate for 6 credits/ }).isVisible());
  await p.getByRole('button', { name: /Generate for 6 credits/ }).click();
  await p.waitForURL(/\/studio\/image$/);
  await p.waitForTimeout(600);
  ok('V2-12', 'Generate from Home opens the image studio with the job running', (await p.getByText(/6 credits reserved/).first().isVisible()) || (await p.getByText(/Waiting|Submitting|Generating/).first().isVisible()));
  await p.goto(base + '/studio', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Edit image' }).click();
  await p.getByRole('link', { name: /Add reference/ }).click();
  await p.waitForURL(/\/studio\/edit$/);
  ok('V2-13', 'Edit tab routes to the edit studio for the reference', true);

  // rail collapsed tooltips at 1100
  const ctx3 = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p3 = await ctx3.newPage();
  await p3.goto(base + '/help', { waitUntil: 'networkidle' });
  await p3.evaluate(() => localStorage.setItem('genlixs-preview-v2', JSON.stringify({ v: 2, signedIn: true, email: 'demo@example.com' })));
  await p3.goto(base + '/studio/library', { waitUntil: 'networkidle' });
  ok('V2-14', 'Collapsed rail links keep accessible names', await p3.getByRole('link', { name: 'Library' }).first().isVisible());

  await b.close();
  console.log(JSON.stringify({ results, failed: results.filter((r) => !r.pass).length, errors: errors.filter((e) => !/LCP|Largest Contentful/.test(e)).slice(0, 8) }, null, 1));
})().catch((e) => { console.log(JSON.stringify({ crash: e.message, results }, null, 1)); process.exit(1); });
