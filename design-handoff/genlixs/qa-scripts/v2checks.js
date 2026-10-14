// v2 interaction checks: hero motion and clips, click-for-sound clips, studio Home quick create.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
const results = [];
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass, detail });
(async () => {
  const base = process.argv[2];
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await p.goto(base + '/', { waitUntil: 'networkidle' });
  const hero = p.locator('#hero-title').locator('xpath=ancestor::section');
  const col = hero.locator('.marquee-up').first();
  const st1 = await col.evaluate((el) => getComputedStyle(el).animationPlayState);
  ok('V2-1', 'Hero columns animate by default', st1 === 'running', st1);
  // v2.2: the client asked for the hero Pause/Play control to be removed; hover still holds the columns.
  ok('V2-2', 'Hero has no Pause/Play control (client request)', (await p.getByRole('button', { name: /(Pause|Play).*hero gallery/ }).count()) === 0);
  await col.hover({ force: true });
  const st2 = await col.evaluate((el) => getComputedStyle(el).animationPlayState);
  ok('V2-3', 'Hovering the hero columns holds them still', st2 === 'paused', st2);
  ok('V2-4', 'Hero has four media columns', (await hero.locator('.marquee-up, .marquee-down').count()) === 4);
  await p.waitForTimeout(2500);
  const heroClips = await hero.locator('video').evaluateAll((vs) => vs.filter((v) => !v.paused).map((v) => v.muted));
  ok('V2-17', 'Hero clips play muted on load', heroClips.length >= 2 && heroClips.every(Boolean), `${heroClips.length} playing`);
  const heroSound = hero.getByRole('button', { name: /^Turn sound on/ }).first();
  await heroSound.click({ force: true });
  await p.mouse.move(5, 5);
  await p.waitForTimeout(400);
  const audible = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.muted && !v.paused).length);
  ok('V2-18', 'Clicking a hero clip turns its sound on', audible === 1, `${audible} audible`);

  // hero tiles follow the shown file's own ratio, with moderate corners
  const tiles = await p.locator('#hero-title').locator('xpath=ancestor::section').locator('.marquee-up > div, .marquee-down > div').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const m = el.querySelector('img, video');
      const nat = m.tagName === 'IMG' ? (m.naturalWidth ? m.naturalWidth / m.naturalHeight : null) : m.videoWidth ? m.videoWidth / m.videoHeight : null;
      return { box: r.width / r.height, nat, radius: getComputedStyle(el).borderTopLeftRadius };
    }),
  );
  const measured = tiles.filter((t) => t.nat);
  const worst = Math.max(...measured.map((t) => Math.abs(t.box - t.nat) / t.nat));
  ok('V2-15', 'Hero tiles match the aspect ratio of their loaded image/video (within 2%)', measured.length >= 8 && worst < 0.02, `${measured.length}/${tiles.length} tiles measured, worst ${(worst * 100).toFixed(2)}%`);
  ok('V2-16', 'Hero tiles use moderate 18 px corners (not pills)', tiles.every((t) => t.radius === '18px'), [...new Set(tiles.map((t) => t.radius))].join(','));

  // gallery clips: autoplay muted on screen, one click for sound, one voice at a time
  const card = p.locator('#examples article', { hasText: 'Pup knight in the fog' });
  await card.locator('video').scrollIntoViewIfNeeded();
  await p.waitForTimeout(1500);
  const auto = await card.locator('video').evaluate((v) => !v.paused && v.muted);
  ok('V2-5', 'Gallery clip plays muted once on screen', auto);
  await card.getByRole('button', { name: /^Turn sound on: Pup knight/ }).click();
  await p.waitForTimeout(400);
  const voices = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.muted));
  const solo = await card.locator('video').evaluate((v) => !v.muted && !v.paused);
  ok('V2-6', 'Click turns that clip\'s sound on and mutes every other clip', solo && voices.length === 1, `${voices.length} unmuted`);

  // reduced motion: hero columns not animated
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/', { waitUntil: 'networkidle' });
  const anim = await p2.locator('.marquee-up').first().evaluate((el) => getComputedStyle(el).animationName);
  ok('V2-7', 'Reduced motion disables the hero marquee', anim === 'none', anim);
  const vplay = await p2.locator('#hero-title').locator('xpath=ancestor::section').locator('video').first().evaluate((v) => v.paused);
  ok('V2-8', 'Reduced motion keeps hero clips on their posters', vplay);

  // studio Home quick create
  await p.goto(base + '/help', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('genlixs-preview-v3', JSON.stringify({ v: 2, signedIn: true, email: 'demo@example.com' })));
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
  await p3.evaluate(() => localStorage.setItem('genlixs-preview-v3', JSON.stringify({ v: 2, signedIn: true, email: 'demo@example.com' })));
  await p3.goto(base + '/studio/library', { waitUntil: 'networkidle' });
  ok('V2-14', 'Collapsed rail links keep accessible names', await p3.getByRole('link', { name: 'Library' }).first().isVisible());

  await b.close();
  console.log(JSON.stringify({ results, failed: results.filter((r) => !r.pass).length, errors: errors.filter((e) => !/LCP|Largest Contentful/.test(e)).slice(0, 8) }, null, 1));
})().catch((e) => { console.log(JSON.stringify({ crash: e.message, results }, null, 1)); process.exit(1); });
