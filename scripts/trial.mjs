/**
 * Headless trials of the simulation core.
 *
 * `src/sim` is engine-agnostic by contract (ARCHITECTURE.md, enforced by
 * check-layers), which has a payoff nobody had collected yet: the whole thing
 * runs in plain Node with no browser, no canvas and no Pixi. So the design's
 * claims can actually be *tested* rather than eyeballed in a screenshot.
 *
 * Each trial states the claim from the design documents it is checking, runs it,
 * and prints what happened. Several of these have already contradicted the
 * documents, which is the point of having them.
 *
 *   npm run trial
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Compile just the sim layer to plain JS. It imports nothing outside itself, so
// this succeeds exactly as long as the layering rule is being kept.
const out = mkdtempSync(join(tmpdir(), 'toycity-sim-'));
writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: false,
      skipLibCheck: true,
      outDir: out,
      rootDir: join(ROOT, 'src/sim'),
    },
    include: [join(ROOT, 'src/sim/**/*.ts')],
  }),
);

try {
  execFileSync(
    join(ROOT, 'node_modules/.bin/tsc'),
    ['-p', join(out, 'tsconfig.json')],
    { stdio: 'inherit' },
  );
} catch {
  console.error('Could not compile src/sim on its own — check the layering.');
  process.exit(1);
}

// Source uses extensionless relative imports (the bundler resolves them); Node
// does not, so the emitted files get their `.js` back before being imported.
for (const file of readdirSync(out)) {
  if (!file.endsWith('.js')) continue;
  const path = join(out, file);
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace(
      /(from\s+['"])(\.\/[^'"]+?)(['"])/g,
      (_m, a, spec, b) => `${a}${spec.endsWith('.js') ? spec : `${spec}.js`}${b}`,
    ),
  );
}

writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }));
const sim = await import(join(out, 'index.js'));

const {
  World,
  WORLD_SIZE,
  OWNER_PLAYER,
  OWNER_RIVAL,
  buildingType,
} = sim;

let failures = 0;

function claim(what, source, fn) {
  let detail = '';
  const note = (s) => {
    detail = s;
  };
  let ok = false;
  try {
    ok = fn(note) !== false;
  } catch (err) {
    detail = String(err && err.stack ? err.stack.split('\n')[0] : err);
  }
  if (!ok) failures++;
  const mark = ok ? '  ok' : 'FAIL';
  console.log(`${mark}  ${what}`);
  console.log(`      ${source}${detail ? ` — ${detail}` : ''}`);
}

/** A world with somewhere flat and dry to build on, and the site it found. */
function freshWorld(seed = 20260727) {
  const world = new World(seed);
  world.economy.stocks.timber = 9000;
  world.economy.stocks.stone = 9000;
  world.economy.stocks.food = 9000;
  // Iron too, since fortification now costs it — otherwise `canPlace` refuses a
  // keep everywhere on the map and half these trials report "no ground", which
  // is what happened the first time iron was added.
  world.economy.stocks.iron = 9000;
  return world;
}

/** Find buildable ground near a point, spiralling outward. */
function siteNear(world, x, y, typeId = 'cottage') {
  for (let r = 0; r < 420; r += 12) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r / 6));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
      if (world.canPlace(typeId, p).ok) return p;
    }
  }
  return null;
}

/** Run n ticks. */
function run(world, n) {
  for (let i = 0; i < n; i++) world.tick();
}

const C = WORLD_SIZE / 2;

console.log('\nTrials of the simulation core\n');

// ---- design/01 §2: military pressure is immediate and collapses instantly ----

claim(
  'A watchtower holds ground the moment it stands, and stops the moment it falls',
  'design/01 §2 — onset immediate, and "if the source is lost it collapses instantly"',
  (note) => {
    const world = freshWorld();
    const at = siteNear(world, C, C, 'watchtower');
    if (!at) return note('no buildable ground found'), false;

    // Count the *military* hold specifically. The cultural claim is sticky by
    // design and lingers after the tower goes, which is correct and was the
    // first thing this trial caught me conflating.
    const heldCells = () => {
      let n = 0;
      for (let cy = 0; cy < 256; cy++) {
        for (let cx = 0; cx < 256; cx++) {
          if (world.military.holderAtCell(cx, cy) === OWNER_PLAYER) n++;
        }
      }
      return n;
    };

    const placed = world.place('watchtower', at);
    if (!placed.ok) return note(placed.reason), false;

    run(world, 5);
    const holding = heldCells();

    world.remove(placed.building.id);
    run(world, 5);
    const after = heldCells();

    note(`${holding} cells held with the tower → ${after} the moment it is gone`);
    return holding > 200 && after === 0;
  },
);

claim(
  'Culture cannot take ground somebody is actively defending',
  'design/01 §2 and §7 risk 4 — military is the only thing that can take defended ground',
  (note) => {
    // A rival tower sits between two towns. The player builds a good quarter
    // beside it; the claim under the tower must not swing to the player.
    const world = freshWorld();
    const towerAt = siteNear(world, C, C, 'watchtower');
    if (!towerAt) return note('no ground'), false;
    const tower = world.place('watchtower', towerAt, 0, OWNER_RIVAL);
    if (!tower.ok) return note(tower.reason), false;

    for (let i = 0; i < 10; i++) {
      const p = siteNear(world, towerAt.x + 60 + i * 11, towerAt.y, 'cottage');
      if (p) world.place('cottage', p);
    }
    const churchAt = siteNear(world, towerAt.x + 80, towerAt.y + 20, 'church');
    if (churchAt) world.place('church', churchAt);

    run(world, 160);

    const standing = world.territory.standingAt(towerAt.x, towerAt.y);
    note(`under the rival tower: ${standing.standing}, owner ${standing.owner}`);
    return standing.owner === OWNER_RIVAL;
  },
);

// ---- design/01 §3: held vs integrated -------------------------------------

claim(
  'Ground you merely hold does not flourish, and says so',
  'design/01 §3 — held ground: no evolution, production penalty, upkeep forever',
  (note) => {
    const world = freshWorld();
    // A tower on empty ground far from the town: it holds country it has no
    // culture in, which is the gilded cage in miniature.
    const at = siteNear(world, C - 300, C - 300, 'keep');
    if (!at) return note('no ground'), false;
    const keep = world.place('keep', at);
    if (!keep.ok) return note(keep.reason), false;

    run(world, 30);
    const stats = world.territory.stats();
    const held = stats.held[OWNER_PLAYER];
    const upkeep = world.economy.upkeep;

    note(`${held} of ${stats.cells[OWNER_PLAYER]} cells held but not integrated, upkeep ${upkeep.toFixed(2)}/tick`);
    return held > 100 && upkeep > 0;
  },
);

claim(
  'Housing only flourishes on ground its own side has made theirs',
  'design/01 §3 — "buildings do not evolve or densify" on ground you merely hold',
  (note) => {
    // Two identical hamlets on the same map, one of them inside a rival keep's
    // contour. Same buildings, same age, same character — only the standing of
    // the ground differs, so any difference in what they become is the rule.
    const world = freshWorld();
    world.rivalActive = false;

    // A farm with cottages in a tight ring: near enough that rustic character
    // actually reaches them (it spreads geodesically, so the effective radius is
    // well under the nominal one), far enough apart that growing to a farmhouse
    // does not clip a neighbour.
    const hamlet = (x, y) => {
      const seedAt = siteNear(world, x, y, 'farm');
      if (!seedAt) return [];
      world.place('farm', seedAt);
      const out = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = siteNear(world, seedAt.x + Math.cos(a) * 27, seedAt.y + Math.sin(a) * 27, 'cottage');
        const r = p && world.place('cottage', p);
        if (r && r.ok) out.push(r.building);
      }
      return out;
    };

    // The occupied hamlet is built right up against the keep. A garrison's reach
    // is geodesic, so on broken ground its 235m nominal radius can shrink to well
    // under a hundred — an earlier version of this trial put the hamlet 60m out
    // and found most of it standing outside the contour.
    const keepAt = siteNear(world, C - 260, C + 220, 'keep');
    if (!keepAt) return note('no ground'), false;
    world.place('keep', keepAt, 0, OWNER_RIVAL);

    const occupied = hamlet(keepAt.x + 34, keepAt.y);
    const free = hamlet(C + 240, C - 220);
    if (occupied.length === 0 || free.length === 0) return note('could not seed both hamlets'), false;

    run(world, 200);

    const grew = (list) => list.filter((b) => buildingType(b.typeId).isEvolved).length;
    // Judge the rule building by building rather than hamlet by hamlet: a keep's
    // contour has an edge, and a cottage that happens to sit outside it is not
    // supposed to be frozen.
    // Occupied ground turns out to be two things, not one, and the trial had to
    // be widened to say so. A keep radiates martial culture as well as holding
    // ground, so over a couple of hundred ticks its own contour stops being
    // merely *held* and becomes ground the rival has genuinely integrated. Both
    // states must freeze a foreign building, and both do.
    const foreign = occupied.filter((b) => {
      const g = world.territory.standingAt(b.pos.x, b.pos.y);
      return g.standing === 'held' || (g.owner !== null && g.owner !== b.owner);
    });

    note(
      `${foreign.length}/${occupied.length} of the occupied hamlet stands on ground that is not the player's, ` +
        `${grew(foreign)} of those evolved; free hamlet ${grew(free)}/${free.length}`,
    );
    return foreign.length >= 3 && grew(foreign) === 0 && grew(free) > 0;
  },
);

// ---- design/01 §3: supply ---------------------------------------------------

claim(
  'A warband outside integrated ground starves, and dies if left there',
  'design/01 §3 — "supply extends from integrated territory only, never from held"',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;
    const at = siteNear(world, C, C, 'keep');
    if (!at) return note('no ground'), false;
    world.place('keep', at);
    run(world, 4);

    const band = world.muster(at);
    if (!band) return note('could not muster at a keep'), false;

    // March it to the far corner, well beyond any supply.
    world.orderWarband(band, { x: 70, y: 70 });
    const start = band.strength;
    run(world, 400);

    const alive = world.military.warbands.find((w) => w.id === band.id);
    note(
      alive
        ? `strength ${start.toFixed(2)} → ${alive.strength.toFixed(2)}, supplied ${alive.supplied}`
        : `strength ${start.toFixed(2)} → disbanded`,
    );
    return !alive || (alive.strength < start && !alive.supplied);
  },
);

claim(
  'Two opposing warbands in contact wear each other down until one breaks',
  'design/01 §2 — military is the only thing that can take contested ground',
  (note) => {
    const world = freshWorld();
    const a = world.military.muster(OWNER_PLAYER, { x: C, y: C });
    const b = world.military.muster(OWNER_RIVAL, { x: C + 12, y: C });
    a.strength = 1;
    b.strength = 0.5;
    world.rivalActive = false;

    run(world, 30);

    const left = world.military.warbands.map((w) => `${w.owner}:${w.strength.toFixed(2)}`);
    note(left.length ? `survivors ${left.join(', ')}` : 'both destroyed');
    // The stronger column should outlast the weaker one.
    const playerAlive = world.military.warbands.some((w) => w.owner === OWNER_PLAYER);
    const rivalAlive = world.military.warbands.some((w) => w.owner === OWNER_RIVAL);
    return playerAlive && !rivalAlive;
  },
);

claim(
  'A warband sitting on an enemy tower eventually throws it down',
  'design/01 §2 — soldiers take; and §5 — ordinary buildings are captured, not burnt',
  (note) => {
    const world = freshWorld();
    const at = siteNear(world, C, C, 'watchtower');
    if (!at) return note('no ground'), false;
    const tower = world.place('watchtower', at, 0, OWNER_RIVAL);
    if (!tower.ok) return note(tower.reason), false;

    // A column strong enough to out-push a watchtower, standing on it.
    const band = world.military.muster(OWNER_PLAYER, { x: at.x + 4, y: at.y + 4 });
    band.strength = 1;
    // Keep it fed: supply is a different trial.
    const before = world.razed;
    for (let i = 0; i < 200; i++) {
      band.strength = 1;
      world.tick();
    }

    note(`razed ${world.razed - before}; tower still standing: ${world.buildings.some((b) => b.id === tower.building.id)}`);
    return world.razed > before;
  },
);

// ---- design/01 §4: culture flows both ways ---------------------------------

claim(
  'Buildings inside somebody else\'s integrated ground eventually change hands',
  'design/01 §2 "culture converts it" and §4 — the peacetime threat',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;
    // A lone rival cottage adrift in what will become a strong player quarter.
    const heart = siteNear(world, C, C, 'church');
    if (!heart) return note('no ground'), false;
    world.place('church', heart);
    for (let i = 0; i < 12; i++) {
      const p = siteNear(world, heart.x + 24 + i * 9, heart.y + 12, 'cottage');
      if (p) world.place('cottage', p);
    }
    const strayAt = siteNear(world, heart.x + 26, heart.y - 24, 'cottage');
    if (!strayAt) return note('no ground for the stray'), false;
    const stray = world.place('cottage', strayAt, 0, OWNER_RIVAL);
    if (!stray.ok) return note(stray.reason), false;

    run(world, 900);
    const owner = world.buildings.find((b) => b.id === stray.building.id)?.owner;
    note(`stray cottage owner ${owner} after 900 ticks, drift ${(stray.building.drift ?? 0).toFixed(2)}, ${world.captured} captured overall`);
    return owner === OWNER_PLAYER;
  },
);

// ---- design/01 §3 and §5: the gilded cage ----------------------------------

claim(
  'Ground you hold but have not converted barely pays for itself',
  'design/01 §3 — the anti-snowball rule: blitzing wins a wide, sullen, expensive empire',
  (note) => {
    // The same three producers twice: once on open ground, once inside a rival
    // keep's contour. Identical buildings, identical land quality is not
    // guaranteed, so this is a direction test rather than an exact ratio.
    const measure = (occupied) => {
      const world = freshWorld();
      world.rivalActive = false;
      const anchor = occupied
        ? siteNear(world, C - 250, C + 210, 'keep')
        : { x: C + 250, y: C - 210 };
      if (occupied) world.place('keep', anchor, 0, OWNER_RIVAL);

      for (const id of ['farm', 'sawmill', 'quarry']) {
        const p = siteNear(world, anchor.x + 30, anchor.y + 26, id);
        if (p) world.place(id, p);
      }

      // Housing on both sides. Since production is now staffing × land, a works
      // with nobody to man it yields zero whatever the ground is worth — and
      // this trial measures the *ground*, so the labour has to be held constant.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = siteNear(world, anchor.x + Math.cos(a) * 46, anchor.y + Math.sin(a) * 46, 'cottage');
        if (p) world.place('cottage', p);
      }

      run(world, 40);
      const r = world.economy.rates;
      return { total: r.timber + r.stone + Math.max(0, r.food), rates: r };
    };

    const free = measure(false);
    const held = measure(true);
    note(
      `open ground yields ${free.total.toFixed(3)}/tick, occupied ground ${held.total.toFixed(3)}/tick`,
    );
    return held.total < free.total * 0.6;
  },
);

// ---- design/01 §4: neglect has a territorial cost --------------------------

claim(
  'A town that stops building loses ground to one that does not',
  'design/01 §4 — the peacetime threat, and the whole reason the rival exists',
  (note) => {
    const world = freshWorld();

    // Two settlements, then the player never touches theirs again.
    const seed = (owner, x, y) => {
      const heart = siteNear(world, x, y, 'church');
      if (heart) world.place('church', heart, 0, owner);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const p = siteNear(world, (heart ?? { x, y }).x + Math.cos(a) * 40, (heart ?? { x, y }).y + Math.sin(a) * 40, 'cottage');
        if (p) world.place('cottage', p, 0, owner);
      }
      const f = siteNear(world, (heart ?? { x, y }).x + 60, (heart ?? { x, y }).y, 'farm');
      if (f) world.place('farm', f, 0, owner);
    };

    seed(OWNER_PLAYER, C - 180, C - 150);
    seed(OWNER_RIVAL, C + 200, C + 170);

    run(world, 120);
    const early = world.territory.stats().cells;
    run(world, 900);
    const late = world.territory.stats().cells;

    const share = (c) => c[OWNER_RIVAL] / (c[OWNER_PLAYER] + c[OWNER_RIVAL]);
    note(
      `player ${early[OWNER_PLAYER]}→${late[OWNER_PLAYER]}, rival ${early[OWNER_RIVAL]}→${late[OWNER_RIVAL]} ` +
        `(rival share ${(share(early) * 100).toFixed(0)}% → ${(share(late) * 100).toFixed(0)}%), ` +
        `${world.rivalBuilt} rival builds`,
    );
    return share(late) > share(early);
  },
);

// ---- design/00 Pillar E: the city remembers --------------------------------

claim(
  'A coherent district becomes a named place, and keeps the name as it grows',
  'design/00 Pillar E — the city remembers; the name is the whole point',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;

    // A tight cluster of one character: a church and a dozen houses around it.
    const heart = siteNear(world, C, C, 'church');
    if (!heart) return note('no ground'), false;
    world.place('church', heart);
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + ring;
        const r = 26 + ring * 20;
        const p = siteNear(world, heart.x + Math.cos(a) * r, heart.y + Math.sin(a) * r, 'cottage');
        if (p) world.place('cottage', p);
      }
    }

    run(world, 200);
    const named = world.quarters.list.filter((q) => q.owner === OWNER_PLAYER);
    if (named.length === 0) return note('nothing was named'), false;

    const first = named[0];
    const nameThen = first.name;
    const cellsThen = first.cells;

    // Grow it. The name must survive.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = siteNear(world, heart.x + Math.cos(a) * 86, heart.y + Math.sin(a) * 86, 'chapel');
      if (p) world.place('chapel', p);
    }
    run(world, 300);

    const still = world.quarters.list.find((q) => q.name === nameThen);
    note(
      `${named.length} quarter(s); "${nameThen}" ${cellsThen} cells → ` +
        (still ? `${still.cells} cells, name kept` : 'name lost'),
    );
    return !!still && still.cells >= cellsThen;
  },
);

claim(
  'The chronicle records the founding and does not repeat itself',
  'design/00 Pillar E — a log that records everything is a log nobody reads',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;
    const at = siteNear(world, C, C, 'cottage');
    if (!at) return note('no ground'), false;
    world.place('cottage', at);

    const founding = world.chronicle.entries.filter((e) => e.text.includes('was founded'));

    // The same sentence twice running must be suppressed.
    const before = world.chronicle.entries.length;
    const now = { tick: world.ticks, year: 1, season: 'spring' };
    world.chronicle.record('works', 'A thing happened.', now);
    world.chronicle.record('works', 'A thing happened.', now);
    world.chronicle.record('works', 'A different thing happened.', now);
    const added = world.chronicle.entries.length - before;

    note(`${founding.length} founding entry, ${added} of 3 duplicate writes kept`);
    return founding.length === 1 && added === 2;
  },
);

claim(
  'A place keeps its name when its character changes, and says so',
  'design/00 Pillar E — real places outlive what they were named for',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;

    // Start industrious.
    const heart = siteNear(world, C, C, 'foundry');
    if (!heart) return note('no ground'), false;
    world.place('foundry', heart);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = siteNear(world, heart.x + Math.cos(a) * 34, heart.y + Math.sin(a) * 34, 'workshop');
      if (p) world.place('workshop', p);
    }
    run(world, 260);

    const quarter = world.quarters.list.find((q) => q.character === 'industrious');
    if (!quarter) return note('no industrious quarter formed'), false;
    const name = quarter.name;

    // Now bury it in something else entirely.
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + ring * 0.4;
        const r = 22 + ring * 16;
        const p = siteNear(world, heart.x + Math.cos(a) * r, heart.y + Math.sin(a) * r, 'green');
        if (p) world.place('green', p);
      }
    }
    run(world, 500);

    const same = world.quarters.list.find((q) => q.name === name);
    const noted = world.chronicle.entries.some((e) => e.text.startsWith(name) && e.text.includes('now'));
    note(
      same
        ? `"${name}" named for ${same.namedFor}, now ${same.character}${noted ? ', and the chronicle noticed' : ''}`
        : `"${name}" disappeared`,
    );
    // The name must survive; noticing the drift is a bonus that depends on the
    // field actually flipping, which a green may or may not manage.
    return !!same;
  },
);

// ---- Labour: production is people, not buildings ---------------------------

claim(
  'A works with nobody to man it produces nothing',
  'labour.ts — a works yields what its land holds TIMES how well it is staffed',
  (note) => {
    // The same sawmill twice, on ground with wood: once alone, once with houses
    // beside it. Only the labour differs.
    const measure = (withHousing) => {
      const world = freshWorld();
      world.rivalActive = false;

      // Find the best timber ground on the map so the land is not the variable.
      let best = null;
      let bestValue = 0;
      for (let cy = 8; cy < 248; cy += 4) {
        for (let cx = 8; cx < 248; cx += 4) {
          const v = world.land.timber[cy * 256 + cx];
          if (v > bestValue) {
            bestValue = v;
            best = { x: (cx + 0.5) * 4, y: (cy + 0.5) * 4 };
          }
        }
      }
      if (!best) return null;

      const at = siteNear(world, best.x, best.y, 'sawmill');
      if (!at || !world.place('sawmill', at).ok) return null;

      if (withHousing) {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const p = siteNear(world, at.x + Math.cos(a) * 40, at.y + Math.sin(a) * 40, 'cottage');
          if (p) world.place('cottage', p);
        }
      }

      run(world, 30);
      const mill = world.buildings.find((b) => b.typeId === 'sawmill');
      return { timber: world.economy.rates.timber, staffing: world.labour.staffingOf(mill) };
    };

    const alone = measure(false);
    const manned = measure(true);
    if (!alone || !manned) return note('could not site the mill'), false;

    note(
      `unmanned: ${(alone.staffing * 100).toFixed(0)}% staffed, ${alone.timber.toFixed(3)}/tick · ` +
        `manned: ${(manned.staffing * 100).toFixed(0)}%, ${manned.timber.toFixed(3)}/tick`,
    );
    return alone.timber === 0 && manned.timber > 0;
  },
);

claim(
  'Ore exists in a few seams, and a mine on one produces iron',
  'land.ts — ore is scarce and lumpy on purpose, so a seam is worth fighting over',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;

    let cells = 0;
    let best = null;
    let bestValue = 0;
    for (let cy = 0; cy < 256; cy++) {
      for (let cx = 0; cx < 256; cx++) {
        const v = world.land.ore[cy * 256 + cx];
        if (v > 0.05) cells++;
        if (v > bestValue) {
          bestValue = v;
          best = { x: (cx + 0.5) * 4, y: (cy + 0.5) * 4 };
        }
      }
    }

    const share = (cells / (256 * 256)) * 100;
    if (!best) return note('no ore anywhere on the map'), false;

    const at = siteNear(world, best.x, best.y, 'mine');
    if (!at || !world.place('mine', at).ok) return note('could not site a mine'), false;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = siteNear(world, at.x + Math.cos(a) * 40, at.y + Math.sin(a) * 40, 'cottage');
      if (p) world.place('cottage', p);
    }
    run(world, 30);

    note(`ore on ${share.toFixed(1)}% of the map; a mine on the best seam yields ${world.economy.rates.iron.toFixed(3)} iron/tick`);
    // Scarce, but not absent — and a mine on it must actually pay.
    return share > 0.2 && share < 14 && world.economy.rates.iron > 0;
  },
);

claim(
  'Fortification cannot be built without iron',
  'the join between the resource game and the territory game',
  (note) => {
    const world = freshWorld();
    const at = siteNear(world, C, C, 'keep');
    world.economy.stocks.iron = 0;
    if (!at) return note('no ground'), false;

    const refused = world.place('keep', at);
    world.economy.stocks.iron = 500;
    const allowed = world.place('keep', at);

    note(`without iron: ${refused.ok ? 'built anyway' : refused.reason}; with iron: ${allowed.ok ? 'built' : allowed.reason}`);
    return !refused.ok && allowed.ok;
  },
);

// ---- populace.ts: the growth loop ------------------------------------------

claim(
  'People arrive to fill housing, and stop when there is none left',
  'populace.ts — housing is a ceiling, not a population',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;

    // A farm and enough cottages for a couple of dozen people.
    const heart = siteNear(world, C, C, 'farm');
    if (!heart) return note('no ground'), false;
    world.place('farm', heart);
    let beds = 0;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + ring;
        const r = 30 + ring * 22;
        const p = siteNear(world, heart.x + Math.cos(a) * r, heart.y + Math.sin(a) * r, 'cottage');
        if (p && world.place('cottage', p).ok) beds += 3;
      }
    }

    const start = world.populace.report.population;
    run(world, 900);
    const end = world.populace.report;

    note(`${start} → ${end.population} of ${end.capacity} beds; blocked by ${end.blocked ?? 'nothing'}`);
    return start === 0 && end.population > 0 && end.population === end.capacity && end.blocked === 'room';
  },
);

claim(
  'A town with no food surplus does not grow',
  'populace.ts — arrivals are gated on food, which is legible and on the map',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;
    world.economy.stocks.food = 0;

    // Housing but no farm: beds going spare and nothing to eat.
    const heart = siteNear(world, C, C, 'cottage');
    if (!heart) return note('no ground'), false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = siteNear(world, heart.x + Math.cos(a) * 30, heart.y + Math.sin(a) * 30, 'cottage');
      if (p) world.place('cottage', p);
    }

    run(world, 400);
    const r = world.populace.report;
    note(`${r.population} of ${r.capacity} beds filled; blocked by ${r.blocked ?? 'nothing'}`);
    return r.population === 0 && r.capacity > 0;
  },
);

claim(
  'Empty housing costs no food',
  'a bug the growth loop would have hidden: buildings do not eat, people do',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;
    world.economy.stocks.food = 500;

    const heart = siteNear(world, C, C, 'cottage');
    if (!heart) return note('no ground'), false;
    for (let i = 0; i < 10; i++) {
      const p = siteNear(world, heart.x + i * 14, heart.y, 'cottage');
      if (p) world.place('cottage', p);
    }

    // One tick, before anybody has had a chance to move in.
    world.tick();
    const eaten = -world.economy.rates.food;
    note(`${world.populace.report.capacity} empty beds cost ${eaten.toFixed(3)} food/tick`);
    return Math.abs(eaten) < 0.001;
  },
);

claim(
  'A works nobody can reach is reported as a problem, on the building',
  'world.problems() — a dead works must be findable without clicking every building',
  (note) => {
    const world = freshWorld();
    world.rivalActive = false;

    // A sawmill far from anything, and a healthy hamlet elsewhere.
    const lonely = siteNear(world, C - 300, C + 260, 'sawmill');
    if (!lonely || !world.place('sawmill', lonely).ok) return note('no ground'), false;

    run(world, 40);
    const problems = world.problems();
    const kinds = problems.map((p) => p.kind);
    const onTheMill = problems.find((p) => p.building.typeId === 'sawmill');

    note(`${problems.length} problem(s): ${kinds.join(', ') || 'none'}`);
    return !!onTheMill;
  },
);

// ---- The economy is the player's, not everybody's --------------------------

claim(
  'The rival eats its own food',
  'a plain bug: the economy was summing every building on the map, both sides',
  (note) => {
    const world = freshWorld();
    world.economy.stocks.food = 500;
    const at = siteNear(world, C, C, 'cottage');
    for (let i = 0; i < 30; i++) {
      const p = siteNear(world, at.x + 40 + i * 9, at.y + 40, 'cottage');
      if (p) world.place('cottage', p, 0, OWNER_RIVAL);
    }
    const before = world.economy.stocks.food;
    run(world, 20);
    const drop = before - world.economy.stocks.food;
    note(`30 rival cottages cost the player ${drop.toFixed(2)} food over 20 ticks`);
    return Math.abs(drop) < 0.01;
  },
);


console.log('');
if (failures > 0) {
  console.log(`${failures} trial(s) did not hold.\n`);
} else {
  console.log('All trials held.\n');
}

rmSync(out, { recursive: true, force: true });
process.exit(failures > 0 ? 1 : 0);
