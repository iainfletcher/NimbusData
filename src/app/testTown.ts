import { World, WORLD_SIZE, buildingType, makeRng, type Vec2 } from '../sim';

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

  const quarters = [
    {
      // Working quarter, downriver and set apart.
      at: { x: c + 150, y: c - 130 },
      angle: 0.35,
      length: 170,
      core: ['foundry', 'tannery', 'sawmill', 'workshop', 'workshop'],
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
      core: ['church', 'chapel', 'almshouse', 'green', 'orchard'],
      cottages: 9,
    },
  ];

  // The high street first: the road that ties the quarters together.
  world.addRoad(
    quarters.map((q) => ({ x: q.at.x, y: q.at.y })),
    'high',
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
