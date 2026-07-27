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
