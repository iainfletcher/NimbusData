/**
 * A contact sheet: every building type, two variants each, on flat ground.
 *
 * Judging architecture from a townscape does not work. Buildings sit on slopes,
 * hide behind each other and are half-covered in hedges, so a defect reads as
 * "something looks a bit off over there" and never gets pinned down. Two real
 * bugs survived several rounds of looking at screenshots of the town and were
 * obvious within seconds of seeing this sheet:
 *
 * - A keep's battlements were sitting at ankle height, because a turret's
 *   height is measured from the ground and had been set as if from the eaves.
 * - Church gables were reading as sailcloth: sixteen metres of unbroken pale
 *   limestone with nothing to say it was masonry.
 *
 * So this is the render-versus-reference loop the design work needs, and it is
 * the same idea as `npm run trial` applied to appearance instead of behaviour:
 * a controlled subject, rendered by the real build, looked at deliberately.
 *
 *   npm run sheet                     # the whole catalogue
 *   ZOOM=12 OX=60 OY=60 npm run sheet # close on part of it
 *   VIEW=plan npm run sheet           # the same in plan
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.addInitScript(
  (opts) => {
    window.__sheet = opts;
  },
  {
    zoom: Number(process.env.ZOOM ?? 4.2),
    ox: Number(process.env.OX ?? 0),
    oy: Number(process.env.OY ?? 0),
  },
);

await page.goto(`file://${join(ROOT, 'dist/index.html')}`);
await page.waitForTimeout(2500);
// The picture is the picture; the interface is not part of what is being judged.
await page.addStyleTag({ content: '#palette,#controls,#hint{display:none!important}' });

const report = await page.evaluate(() => {
  const { world, camera, view } = window.__toy;
  const { zoom, ox, oy } = window.__sheet;

  world.rivalActive = false;
  world.economy.stocks.timber = 99999;
  world.economy.stocks.stone = 99999;
  world.economy.stocks.food = 99999;

  // Build a plateau, so nothing is judged while standing on a hillside. One
  // brush cannot cover three hundred metres, so sweep a lattice of them.
  //
  // Raise before levelling. Levelling alone flattens the ground to its local
  // mean, which is a basin — and the hydrology, correctly, fills a basin with
  // water and refuses to build on it. Lifting the whole plateau first gives it
  // somewhere to drain.
  const sweep = (mode, amount, passes) => {
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 300; y <= 800; y += 28) {
        for (let x = 280; x <= 660; x += 28) {
          world.sculpt({ at: { x, y }, radius: 62, amount }, mode);
        }
      }
    }
  };

  sweep('raise', 2.2, 5);
  sweep('level', 3, 7);
  world.terrain.settleWater();

  const ids = [
    'cottage', 'terrace', 'merchant_house', 'close_cottage', 'farmhouse',
    'lodging_house', 'garden_cottage', 'barrack_row',
    'farm', 'watermill', 'sawmill', 'workshop', 'warehouse', 'tannery',
    'foundry', 'quarry', 'market',
    'church', 'chapel', 'almshouse', 'tavern', 'alehouse', 'guildhall',
    'watchtower', 'keep',
  ];

  const CX = 380;
  const CY = 380;
  const cols = 6;
  const gap = 34;
  const refused = [];
  let n = 0;

  for (const id of ids) {
    for (let v = 0; v < 2; v++) {
      const col = n % cols;
      const row = Math.floor(n / cols);
      const placed = world.place(id, { x: CX + col * gap, y: CY + row * gap }, 0);
      if (!placed.ok) refused.push(`${id}: ${placed.reason}`);
      n++;
    }
  }

  world.rebuildFabric();
  view.markBuildingsDirty();

  const fx = CX + (cols * gap) / 2 + ox;
  const fy = CY + (Math.ceil(n / cols) * gap) / 2 + oy;
  camera.zoom = zoom;
  camera.centreOnWorld(fx, fy, world.terrain.heightAt(fx, fy), view.currentProjection);

  return { standing: world.buildings.length, wanted: n, refused: refused.slice(0, 8) };
});

if (process.env.VIEW === 'plan') {
  await page.click('#view-plan');
}

await page.waitForTimeout(2500);
const name = process.env.NAME ?? 'sheet.png';
await page.screenshot({ path: join(OUT, name) });

console.log(`${report.standing} of ${report.wanted} standing → ${join(OUT, name)}`);
if (report.refused.length) console.log(`refused: ${report.refused.join(', ')}`);
console.log(errors.length ? `ERRORS: ${errors.slice(0, 3).join(' | ')}` : 'no console errors');

await browser.close();
process.exit(errors.length ? 1 : 0);
