/**
 * Loads the built prototype in a real browser, seeds the test town, lets it
 * settle, and captures both views with and without the character overlay.
 *
 * Fails on any console or page error. Screenshots land in shots/ (gitignored) —
 * they are the fastest way to answer the MVP's success criteria (design/06 §3),
 * which are all judged by looking.
 *
 *   npm run build && npm run smoke [-- --out <dir>]
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? process.argv[outArg + 1] : join(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// Let Playwright resolve via PLAYWRIGHT_BROWSERS_PATH; fall back to a scan so a
// version bump in the image doesn't break this.
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium-')) continue;
    const exe = join(base, dir, 'chrome-linux/chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`file://${join(ROOT, 'dist/index.html')}`);
await page.waitForTimeout(2000);

await page.click('#seed-town');
await page.waitForTimeout(400);
const seeded = await page.textContent('#r-count');

// Long enough for cottages to pass the settling period and evolve.
await page.waitForTimeout(8000);

const evolved = await page.evaluate(() => {
  const counts = {};
  for (const el of document.querySelectorAll('#palette-items button')) void el;
  return counts;
});
void evolved;

const ticks = await page.textContent('#r-ticks');

await page.screenshot({ path: join(OUT, '01-iso.png') });
await page.click('#toggle-overlay');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, '02-iso-character.png') });
await page.click('#view-plan');
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, '03-plan-character.png') });
await page.click('#toggle-overlay');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, '04-plan.png') });

// Close up, in the world view: the honest test of whether quarters read apart
// from material and form rather than from a debug colour.
await page.click('#view-iso');
await page.waitForTimeout(600);
for (let i = 0; i < 9; i++) {
  await page.mouse.move(700, 420);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, '05-close.png') });

// People should be somewhere different a moment later.
const peopleMoved = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas');
  const grab = () => canvas.toDataURL().length;
  const before = grab();
  await new Promise((r) => setTimeout(r, 700));
  return grab() !== before;
});
await page.screenshot({ path: join(OUT, '06-close-later.png') });
console.log(`scene animating:         ${peopleMoved}`);

await browser.close();

console.log(`buildings after seeding: ${seeded}`);
console.log(`ticks elapsed:           ${ticks}`);
console.log(`screenshots:             ${OUT}`);

if (errors.length) {
  console.error('\nErrors:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('\nSmoke test passed — no console or page errors.');
