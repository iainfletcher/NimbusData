/**
 * The same view, four times, one per season.
 *
 * The calendar has always driven the harvest, the labour and what the town eats,
 * but the only way to *see* what month it was was to read a text plate in the
 * corner. Foliage and ground colour now turn with the year, and this is how that
 * gets checked: four screenshots of one view, which is the only way to judge
 * whether the year has a shape or has merely been tinted.
 *
 * It caught the mistake that mattered. The first winter palette was a greyish
 * *olive*, which mixed with an olive base produces olive — the ground came out
 * looking greener in February than in October, and no amount of squinting at a
 * single screenshot would have shown that.
 *
 *   npm run seasons
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = process.env.OUT ?? join(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`file://${join(ROOT, 'dist/index.html')}`);
await page.waitForTimeout(2500);
await page.click('#seed-town');
await page.waitForTimeout(7000);

// Pause first: the buttons have to be clickable before the chrome is hidden.
await page.click('#toggle-pause');
await page.addStyleTag({ content: '#palette,#controls,#hint{display:none!important}' });

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

for (const season of SEASONS) {
  await page.evaluate(
    ({ season, order, zoom }) => {
      const { world, camera, view } = window.__toy;
      // Park the calendar mid-season rather than on a boundary.
      world.calendar.ticks = order.indexOf(season) * 85 + 20;

      const own = world.buildings.filter((b) => b.owner === 0);
      let x = 0;
      let y = 0;
      for (const b of own) {
        x += b.pos.x;
        y += b.pos.y;
      }
      x /= own.length;
      y /= own.length;

      camera.zoom = zoom;
      camera.centreOnWorld(x - 70, y - 90, world.terrain.heightAt(x, y), view.currentProjection);
      view.markBuildingsDirty();
    },
    { season, order: SEASONS, zoom: Number(process.env.ZOOM ?? 5) },
  );

  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `season-${season}.png`) });
}

console.log(`four seasons → ${join(OUT, 'season-*.png')}`);
console.log(errors.length ? `ERRORS: ${errors.slice(0, 3).join(' | ')}` : 'no console errors');

await browser.close();
process.exit(errors.length ? 1 : 0);
