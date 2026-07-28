import { AGES, OWNER_RIVAL, World, WORLD_SIZE, buildingType, makeRng, type Vec2 } from '../sim';

/**
 * Lays down the arrangement the MVP is judged against (design/06 §3), the way a
 * player actually works: **lay a road, then build along it.**
 *
 * That order matters. An earlier version scattered buildings across a field with
 * no roads at all, and the fabric generator dutifully produced a network that
 * looped *around* each cluster like hedgerows — because scattered buildings give
 * a street nothing to run along. Roads are the armature; desire paths are what
 * the town wears into the gaps.
 */

const SETBACK = 1.6;

export function seedTestTown(world: World): void {
  const rng = makeRng(world.seed ^ 0x5eed);
  const c = WORLD_SIZE / 2;

  // A scenario town is one that has *already* grown up — it has a market cross
  // and a church in it — so it arrives at the last age rather than fighting the
  // hamlet's catalogue on the way in. Growing a town from nothing is the game;
  // this button exists to skip straight to a finished one.
  world.ages.index = AGES.length - 1;

  const quarters = [
    {
      // Working quarter, downriver and set apart.
      at: { x: c + 150, y: c - 130 },
      angle: 0.35,
      length: 170,
      core: ['foundry', 'tannery', 'sawmill', 'quarry', 'workshop', 'well'],
      cottages: 9,
    },
    {
      // Trading quarter along the road to the crossing.
      at: { x: c - 40, y: c + 60 },
      angle: 1.15,
      length: 150,
      core: ['market', 'warehouse', 'guildhall', 'tavern', 'alehouse'],
      cottages: 9,
    },
    {
      // Church and green, upriver and quiet.
      at: { x: c + 60, y: c + 250 },
      angle: 2.0,
      length: 160,
      core: ['church', 'chapel', 'almshouse', 'green', 'orchard', 'well'],
      cottages: 9,
    },
    {
      // Farms out along the lane, with their strips beyond.
      at: { x: c - 210, y: c - 40 },
      angle: 0.75,
      length: 140,
      core: ['farm', 'watermill', 'farm', 'sawmill'],
      cottages: 5,
    },
  ];

  // The high street runs through the town proper; the farms sit off a lane of
  // their own, because a single road doubling back through every quarter is not
  // how any town is laid out.
  const [working, trading, church, farms] = quarters;
  world.addRoad(
    [working, trading, church].map((q) => ({ x: q.at.x, y: q.at.y })),
    'high',
  );
  world.addRoad(
    [
      { x: trading.at.x, y: trading.at.y },
      { x: (trading.at.x + farms.at.x) / 2, y: (trading.at.y + farms.at.y) / 2 - 30 },
      { x: farms.at.x, y: farms.at.y },
    ],
    'street',
  );

  for (const q of quarters) {
    const along = { x: Math.cos(q.angle), y: Math.sin(q.angle) };
    const half = q.length / 2;
    const from = { x: q.at.x - along.x * half, y: q.at.y - along.y * half };
    const to = { x: q.at.x + along.x * half, y: q.at.y + along.y * half };

    const road = world.addRoad([from, to], 'street');
    if (!road) continue;

    // Core buildings take the frontage, alternating sides of the road.
    q.core.forEach((typeId, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const t = (i - (q.core.length - 1) / 2) * 34;
      frontage(world, typeId, q.at, along, t, side, rng);
    });

    // Cottages fill the rest of the frontage, then a back lane behind them.
    for (let i = 0; i < q.cottages; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const t = (rng() - 0.5) * q.length;
      const rank = i < 5 ? 0 : 1;
      frontage(world, 'cottage', q.at, along, t, side, rng, rank);
    }
  }
}

/**
 * Place a building on a road frontage: offset from the centreline by the road's
 * half-width plus a setback, turned to face it. Rank 1 sits behind the frontage,
 * which is where a back lane will end up being worn.
 */
/**
 * A rival settlement, so there is something for the border to press against.
 *
 * Deliberately built the *wrong* way: everything jumbled together with no road
 * and no coherent quarter. That is the experiment in `design/01` — if culture
 * really does come from strength of character rather than from size, a muddled
 * town of comparable population should lose ground to a well-ordered one
 * without a shot being fired.
 */
export function seedRivalTown(world: World): void {
  const rng = makeRng(world.seed ^ 0x21fa);
  const at = findRivalSite(world);
  if (!at) return;

  // Matched to the player town in size and in the mix of buildings, so the only
  // difference between them is *arrangement*. That is the whole experiment: if
  // culture came from size, these two would draw.
  const kinds = [
    'market', 'foundry', 'church', 'tavern', 'workshop', 'warehouse',
    'tannery', 'chapel', 'alehouse', 'sawmill', 'guildhall', 'almshouse',
    'green', 'orchard', 'farm', 'watermill', 'workshop', 'warehouse',
  ];

  kinds.forEach((typeId, i) => {
    const angle = (i / kinds.length) * Math.PI * 2 + rng();
    const dist = 25 + rng() * 95;
    scatter(world, typeId, at, angle, dist, rng);
  });

  for (let i = 0; i < 29; i++) {
    scatter(world, 'cottage', at, rng() * Math.PI * 2, 20 + rng() * 125, rng);
  }
}

/**
 * Find somewhere the rival can actually stand: far enough from the player to
 * leave a frontier between them, on ground that is neither sea nor scarp.
 * Hardcoding a position put the first attempt in the estuary.
 */
function findRivalSite(world: World): Vec2 | null {
  const c = WORLD_SIZE / 2;
  const home = { x: c, y: c + 60 };

  for (const distance of [430, 380, 330, 480]) {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const at = {
        x: home.x + Math.cos(angle) * distance,
        y: home.y + Math.sin(angle) * distance,
      };
      if (at.x < 90 || at.y < 90 || at.x > WORLD_SIZE - 90 || at.y > WORLD_SIZE - 90) continue;

      // Needs a usable patch, not just one buildable point.
      let clear = 0;
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2;
        const p = { x: at.x + Math.cos(a) * 55, y: at.y + Math.sin(a) * 55 };
        if (world.terrain.isBuildable(p, 14, 12)) clear++;
      }
      if (clear >= 9) return at;
    }
  }
  return null;
}

function scatter(
  world: World,
  typeId: string,
  centre: Vec2,
  angle: number,
  dist: number,
  rng: () => number,
): void {
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = angle + (rng() - 0.5) * 0.9;
    const d = dist + (rng() - 0.5) * attempt * 4;
    const pos = { x: centre.x + Math.cos(a) * d, y: centre.y + Math.sin(a) * d };
    if (world.place(typeId, pos, rng() * Math.PI * 2, OWNER_RIVAL).ok) return;
  }
}

function frontage(
  world: World,
  typeId: string,
  centre: Vec2,
  along: Vec2,
  t: number,
  side: number,
  rng: () => number,
  rank = 0,
): void {
  const type = buildingType(typeId);
  const across = { x: -along.y, y: along.x };
  const angle = Math.atan2(along.y, along.x);

  const base = { x: centre.x + along.x * t, y: centre.y + along.y * t };
  const hit = world.roadNear(base, 60);
  const halfWidth = hit ? hit.halfWidth : 3.4;
  const out = halfWidth + SETBACK + type.depth / 2 + rank * 26;

  for (let attempt = 0; attempt <= 30; attempt++) {
    // Slide along the road looking for a gap rather than pushing into the street.
    const slide = attempt === 0 ? 0 : (rng() - 0.5) * attempt * 5;
    const pos = {
      x: base.x + along.x * slide + across.x * side * out,
      y: base.y + along.y * slide + across.y * side * out,
    };
    if (world.place(typeId, pos, angle).ok) return;
  }
}
