import { World, WORLD_SIZE, makeRng, type Vec2 } from '../sim';

/**
 * Lays down the arrangement the MVP is meant to be judged against
 * (design/06 §3): roughly forty buildings in three quarters, each with a clear
 * intent, plus cottages to watch evolve.
 *
 * Buildings are set out in facing rows along a spine, because that is how a
 * player actually builds — nobody scatters houses at random across a field. An
 * earlier version did scatter them, and the fabric generator dutifully produced
 * a network that looped *around* each cluster like field boundaries, since
 * randomly placed buildings give a street nothing to run along.
 */
export function seedTestTown(world: World): void {
  const rng = makeRng(world.seed ^ 0x5eed);
  const c = WORLD_SIZE / 2;

  const quarters = [
    {
      // Working quarter, downriver and set apart.
      at: { x: c + 150, y: c - 130 },
      angle: 0.35,
      core: ['foundry', 'tannery', 'sawmill', 'workshop', 'workshop'],
      cottages: 9,
    },
    {
      // Trading quarter along the road to the crossing.
      at: { x: c - 40, y: c + 60 },
      angle: 1.15,
      core: ['market', 'warehouse', 'guildhall', 'tavern', 'alehouse'],
      cottages: 9,
    },
    {
      // Church and green, upriver and quiet.
      at: { x: c + 60, y: c + 250 },
      angle: 2.0,
      core: ['church', 'chapel', 'almshouse', 'green', 'orchard'],
      cottages: 9,
    },
  ];

  for (const q of quarters) {
    const along = { x: Math.cos(q.angle), y: Math.sin(q.angle) };
    const across = { x: -along.y, y: along.x };

    // Core buildings alternate sides of the spine, facing each other.
    q.core.forEach((typeId, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const t = (i - (q.core.length - 1) / 2) * 34;
      tryPlace(world, typeId, offset(q.at, along, t, across, side * 20), rng);
    });

    // Cottages fill in along the same spine, then behind the frontages.
    for (let i = 0; i < q.cottages; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const rank = i < 5 ? 1 : 2;
      const t = (rng() - 0.5) * 150;
      const outward = side * (rank === 1 ? 19 : 40);
      tryPlace(world, 'cottage', offset(q.at, along, t, across, outward), rng);
    }
  }
}

function offset(base: Vec2, along: Vec2, t: number, across: Vec2, u: number): Vec2 {
  return {
    x: base.x + along.x * t + across.x * u,
    y: base.y + along.y * t + across.y * u,
  };
}

/** Try the intended spot, then jitter outward until something takes. */
function tryPlace(
  world: World,
  typeId: string,
  target: Vec2,
  rng: () => number,
  attempts = 40,
): void {
  if (world.place(typeId, target).ok) return;

  for (let i = 1; i <= attempts; i++) {
    const spread = i * 1.6;
    const pos = {
      x: target.x + (rng() - 0.5) * spread,
      y: target.y + (rng() - 0.5) * spread,
    };
    if (world.place(typeId, pos).ok) return;
  }
}
