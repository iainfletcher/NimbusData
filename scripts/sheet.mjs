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
 * Each type is labelled in place. Without labels the sheet answers "do these
 * look good" and never "which one is the tannery", and the second is the
 * question that gets things fixed — a pass over all twenty-five types turned up
 * eight defects, none of which had been visible in a townscape.
 *
 *   npm run sheet                            # the whole catalogue
 *   ONLY=keep,watchtower ZOOM=9 npm run sheet  # a few types, close
 *   VARIANTS=1 COLS=4 GAP=40 npm run sheet     # layout control
 *   VIEW=plan npm run sheet                    # the same in plan
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
    cols: Number(process.env.COLS ?? 5),
    gap: Number(process.env.GAP ?? 46),
    variants: Number(process.env.VARIANTS ?? 2),
    only: process.env.ONLY ?? '',
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
  if (window.__sheet.only) {
    const want = String(window.__sheet.only).split(',');
    ids.length = 0;
    ids.push(...want);
  }

  const CX = 340;
  const CY = 340;
  const cols = Number(window.__sheet.cols ?? 5);
  const gap = Number(window.__sheet.gap ?? 46);
  const refused = [];
  const marks = [];
  let n = 0;

  const variants = Number(window.__sheet.variants ?? 2);
  for (const id of ids) {
    for (let v = 0; v < variants; v++) {
      const col = n % cols;
      const row = Math.floor(n / cols);
      const at = { x: CX + col * gap, y: CY + row * gap };
      const placed = world.place(id, at, 0);
      if (!placed.ok) refused.push(`${id}: ${placed.reason}`);
      else if (v === 0) marks.push({ id, x: at.x, y: at.y });
      n++;
    }
  }

  world.rebuildFabric();
  // Clear the generated clutter. Plots, hedges and vegetable rows are lovely in
  // a town and are exactly what stops you seeing the building being judged.
  world.decor.items.length = 0;
  view.markBuildingsDirty();

  const fx = CX + (cols * gap) / 2 + ox;
  const fy = CY + (Math.ceil(n / cols) * gap) / 2 + oy;
  camera.zoom = zoom;
  camera.centreOnWorld(fx, fy, world.terrain.heightAt(fx, fy), view.currentProjection);

  return { standing: world.buildings.length, wanted: n, refused: refused.slice(0, 8), marks };
});

if (process.env.VIEW === 'plan') {
  await page.click('#view-plan');
}

await page.waitForTimeout(2200);

// Label each type in place. Without this the sheet answers "do these look good"
// and never "which one is the tannery", which is the question that gets things
// fixed.
await page.evaluate((marks) => {
  const { world, camera, view } = window.__toy;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99';
  document.body.appendChild(host);

  for (const m of marks) {
    const p = view.currentProjection.project(m.x, m.y, world.terrain.heightAt(m.x, m.y));
    const sx = p.x * camera.zoom + (camera.viewportWidth / 2 - camera.x * camera.zoom);
    const sy = p.y * camera.zoom + (camera.viewportHeight / 2 - camera.y * camera.zoom);
    if (sx < -60 || sy < -20 || sx > innerWidth + 60 || sy > innerHeight + 20) continue;

    const tag = document.createElement('div');
    tag.textContent = m.id;
    tag.style.cssText =
      'position:absolute;transform:translate(-50%,0);' +
      'font:600 11px ui-monospace,monospace;color:#f4ead6;' +
      'background:rgba(18,22,26,.82);padding:2px 6px;border-radius:3px;white-space:nowrap';
    tag.style.left = `${sx}px`;
    tag.style.top = `${sy + 6}px`;
    host.appendChild(tag);
  }
}, report.marks);

await page.waitForTimeout(300);
const name = process.env.NAME ?? 'sheet.png';
await page.screenshot({ path: join(OUT, name) });

console.log(`${report.standing} of ${report.wanted} standing → ${join(OUT, name)}`);
if (report.refused.length) console.log(`refused: ${report.refused.join(', ')}`);
console.log(errors.length ? `ERRORS: ${errors.slice(0, 3).join(' | ')}` : 'no console errors');

await browser.close();
process.exit(errors.length ? 1 : 0);
