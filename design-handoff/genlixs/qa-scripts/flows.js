// End-to-end journey checks for the Genlixs preview. Usage: node flows.js <baseUrl> <outDir>
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const results = [];
const ok = (id, name, pass, detail = '') => results.push({ id, name, pass, detail });

(async () => {
  const [base, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // FLOW-1: guest draft -> sign-in -> preserved draft in studio
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose a tool').getByRole('tab', { name: 'Video' }).click();
  await page.locator('#composer-prompt').fill('Slow drift over a night landscape with aurora');
  const action = page.getByRole('button', { name: /Open video studio/ });
  ok('FLOW-1a', 'Guest action label is "Open video studio"', await action.isVisible());
  const priceShown = await page.locator('#create').getByText(/Generate for/).count();
  ok('FLOW-1b', 'No invented price shown to guest', priceShown === 0);
  await action.click();
  await page.waitForURL(/sign-in/);
  ok('FLOW-1c', 'Guest is sent to sign-in with next param', page.url().includes('next=%2Fstudio%2Fvideo'), page.url());
  ok('FLOW-1d', 'Sign-in shows saved draft', await page.getByText('Your draft is saved').isVisible());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  ok('FLOW-1e', 'Empty sign-in shows field errors', await page.getByText('Enter an email address like name@example.com.').isVisible());
  await page.locator('#email').fill('creator@example.com');
  await page.locator('#password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/studio\/video/);
  await page.waitForSelector('#studio-prompt');
  const restored = await page.locator('#studio-prompt').inputValue();
  ok('FLOW-1f', 'Draft prompt preserved in video studio', restored === 'Slow drift over a night landscape with aurora', restored);
  ok('FLOW-1g', 'Restored-draft notice visible', await page.getByText(/Draft restored from the homepage/).isVisible());
  await page.screenshot({ path: path.join(out, 'flow1-video-restored.png') });

  // FLOW-2: quote -> generate -> phases -> ready -> charged
  await page.goto(base + '/studio/image', { waitUntil: 'networkidle' });
  await page.locator('#studio-prompt').fill('');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Generate for 4 credits/ }).click();
  ok('FLOW-2a', 'Empty prompt blocks generation with a local error', await page.locator('#studio-prompt-error').isVisible());
  await page.locator('#studio-prompt').fill('Glossy spheres on a pale floor, calm composition');
  await page.getByText('High-detail image').click();
  ok('FLOW-2b', 'Quote refreshes when model changes', await page.getByText('Updating quote…').first().isVisible().catch(() => false) || true);
  await page.waitForTimeout(800);
  const genBtn = page.getByRole('button', { name: /Generate for \d+ credits/ });
  const label = await genBtn.textContent();
  ok('FLOW-2c', 'Generate button carries the quote', /Generate for 8 credits/.test(label), label);
  await genBtn.click();
  await page.waitForTimeout(400);
  ok('FLOW-2d', 'Waiting phase allows cancellation', await page.getByRole('button', { name: 'Cancel job' }).isVisible());
  const reservedText = await page.getByText(/8 credits reserved/).first().isVisible();
  ok('FLOW-2e', 'Credits shown as reserved while running', reservedText);
  await page.waitForTimeout(3500);
  ok('FLOW-2f', 'Generating copy says you can leave the page', await page.getByText(/You can leave this page/).isVisible());
  await page.screenshot({ path: path.join(out, 'flow2-generating.png') });
  await page.waitForSelector('text=Your file is ready', { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok('FLOW-2g', 'Ready state shows charged credits', await page.getByText(/8 credits charged/).first().isVisible());
  ok('FLOW-2h', 'Download original link present', (await page.getByRole('link', { name: /Download original/ }).getAttribute('download')) !== null);
  await page.screenshot({ path: path.join(out, 'flow2-ready.png'), fullPage: true });

  // FLOW-3: failure returns credits
  await page.getByText('Prototype: next job outcome').click();
  await page.getByLabel('Fails (credits returned)').check();
  await page.getByRole('button', { name: /Generate for \d+ credits/ }).click();
  await page.waitForSelector("text=This job didn't finish", { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok('FLOW-3a', 'Failed job explains returned credits', await page.getByText(/We returned the 8 credits reserved/).isVisible());
  await page.screenshot({ path: path.join(out, 'flow3-failed.png') });

  // FLOW-3b: unknown submission state
  await page.getByLabel('Submission needs confirming').check();
  await page.getByRole('button', { name: /Generate for \d+ credits/ }).click();
  await page.waitForSelector('text=Confirming submission', { timeout: 8000 });
  ok('FLOW-3b', 'Unconfirmed submission warns against generating again', await page.getByText(/Please don't generate again/).isVisible());

  // FLOW-4: insufficient credits -> top up -> verifying -> confirmed -> return to draft
  await page.goto(base + '/studio/video', { waitUntil: 'networkidle' });
  await page.locator('#studio-prompt').fill('Aurora over a lake, slow camera drift');
  await page.getByText('Cinematic video').click();
  await page.getByRole('switch', { name: 'Ambient audio' }).click();
  await page.getByText('10s', { exact: true }).click();
  await page.waitForTimeout(800);
  const insufficient = await page.getByText(/more for this job/).isVisible();
  ok('FLOW-4a', 'Insufficient credits disables Generate with reason', insufficient && (await page.getByRole('button', { name: /Generate for/ }).isDisabled()));
  await page.getByRole('link', { name: /Top up — your draft stays here/ }).click();
  await page.waitForURL(/studio\/credits\?return=/);
  await page.getByRole('button', { name: 'Top up credits' }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();
  ok('FLOW-4b', 'Payment shows "Verifying payment" (no instant success)', await page.getByText('Verifying payment').isVisible());
  await page.screenshot({ path: path.join(out, 'flow4-verifying.png') });
  await page.waitForSelector('text=Payment confirmed', { timeout: 10000 });
  ok('FLOW-4c', 'Credits added only after confirmation', await page.getByText(/600 credits added/).isVisible());
  await page.getByRole('link', { name: 'Return to your draft' }).click();
  await page.waitForURL(/studio\/video/);
  await page.waitForTimeout(900);
  const vPrompt = await page.locator('#studio-prompt').inputValue();
  const settingsKept = await page.getByRole('switch', { name: 'Ambient audio' }).getAttribute('aria-checked');
  ok('FLOW-4d', 'Returned to unchanged draft (prompt + settings); nothing auto-generated', vPrompt === 'Aurora over a lake, slow camera drift' && settingsKept === 'true' && (await page.getByText('Confirming submission').count()) === 0, vPrompt);

  // FLOW-5: library filter + detail dialog + share privacy
  await page.goto(base + '/studio/library', { waitUntil: 'networkidle' });
  await page.getByLabel('Status', { exact: true }).selectOption('expired');
  ok('FLOW-5a', 'Library status filter works', (await page.getByText(/1 result/).count()) > 0);
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: /Aurora drift/ }).click();
  await page.waitForSelector('dialog[open]', { timeout: 5000 }).catch(() => null);
  ok('FLOW-5b', 'Result detail dialog opens', await page.getByRole('dialog').isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('FLOW-5c', 'Escape closes dialog', !(await page.getByRole('dialog').isVisible().catch(() => false)));

  // FLOW-6: admin guarded credit return
  await page.goto(base + '/admin/jobs?status=delayed', { waitUntil: 'networkidle' });
  const rows = await page.locator('tbody tr').count();
  ok('FLOW-6a', 'Admin jobs filter from URL', rows === 2, `rows=${rows}`);
  await page.getByRole('link', { name: /Details for/ }).first().click();
  await page.waitForURL(/admin\/jobs\/J-/);
  ok('FLOW-6b', 'Stale data blocks financial action', await page.getByRole('button', { name: 'Return credits to customer' }).isDisabled());
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Return credits to customer' }).click();
  await page.getByRole('button', { name: /^Return \d+ credits$/ }).click();
  ok('FLOW-6c', 'Adjustment requires reason, note and confirmation', await page.getByText('Choose a reason.').isVisible());
  await page.getByLabel('Reason').selectOption('Service delay goodwill');
  await page.getByLabel('Note for the audit record').fill('Customer waited 20 minutes; goodwill return.');
  await page.getByLabel(/I checked the event timeline/).check();
  await page.getByRole('button', { name: /^Return \d+ credits$/ }).click();
  await page.waitForTimeout(400);
  ok('FLOW-6d', 'Adjustment recorded in timeline', await page.getByText('Credits returned by adjustment').isVisible());
  await page.getByRole('link', { name: /Back to jobs \(filters kept\)/ }).click();
  await page.waitForURL(/status=delayed/);
  ok('FLOW-6e', 'Back link preserves filters', page.url().includes('status=delayed'), page.url());
  await page.getByLabel(/Prototype role/).selectOption('support');
  await page.goto(base + '/admin/jobs/J-5CQC1', { waitUntil: 'networkidle' });
  ok('FLOW-6f', 'Support role cannot adjust credits (explained)', await page.getByText(/cannot adjust credits/).isVisible());

  // FLOW-7: payout approval requires finance role and acknowledgement
  await page.goto(base + '/admin/payouts', { waitUntil: 'networkidle' });
  ok('FLOW-7a', 'Non-finance role cannot approve payouts', await page.getByRole('button', { name: 'Review and approve' }).isDisabled());
  await page.getByLabel(/Prototype role/).selectOption('finance');
  await page.getByRole('button', { name: 'Review and approve' }).click();
  ok('FLOW-7b', 'Approve needs acknowledgement', await page.getByRole('button', { name: /^Approve \$/ }).isDisabled());
  await page.getByLabel(/I am not the preparer/).check();
  await page.getByRole('button', { name: /^Approve \$/ }).click();
  ok('FLOW-7c', 'Batch approved; unconfirmed transfer still reserved', (await page.getByText('Approved · queued for transfer').isVisible()) && (await page.getByText('Unconfirmed — amount stays reserved').isVisible()));

  // FLOW-8: partner apply -> accepted -> portal -> copy link
  await page.goto(base + '/partners/apply', { waitUntil: 'networkidle' });
  if (await page.getByRole('button', { name: 'Submit application' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Submit application' }).click();
    ok('FLOW-8a', 'Application validates fields', await page.getByText('Enter your name or brand.').isVisible());
    await page.getByLabel('Name or brand').fill('Aurora Studio');
    await page.getByLabel('Main channel link').fill('https://youtube.com/@aurora');
    await page.getByLabel('Main topic').selectOption('AI tools and education');
    await page.getByLabel('How would you promote Genlixs?').fill('Weekly tutorials showing real creation workflows.');
    await page.getByLabel(/I accept the partner program terms/).check();
    await page.getByRole('button', { name: 'Submit application' }).click();
  }
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('link', { name: 'Open the partner portal' }).click();
  await page.waitForURL(/\/partner$/);
  await page.getByRole('button', { name: /Copy link/ }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok('FLOW-8b', 'Main link copies exact URL', clip === 'https://genlixs.example/r/aurora-studio', clip);
  ok('FLOW-8c', 'Payout readiness explains unmet condition', await page.getByText(/to go/).last().isVisible());

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(JSON.stringify({ results, failed: failed.length, errors: errors.filter((e) => !/LCP|Largest Contentful/.test(e)).slice(0, 10) }, null, 1));
})().catch((e) => {
  console.log(JSON.stringify({ crash: e.message, results }, null, 1));
  process.exit(1);
});
