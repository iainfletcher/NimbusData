import { World, WORLD_SIZE, makeRng, type Vec2 } from '../sim';

/**
 * Lays down the arrangement the MVP is meant to be judged against
 * (design/06 §3): roughly forty buildings in three loose clusters, each with a
 * clear intent, plus cottages around them to watch evolve.
 *
 * If the three quarters don't read as different places with the labels off, the
 * character system needs rework — that's the whole point of this button.
 */
export function seedTestTown(world: World): void {
  const rng = makeRng(world.seed ^ 0x5eed);
  const c = WORLD_SIZE / 2;

  const clusters: { at: Vec2; core: string[]; cottages: number }[] = [
    {
      // Working quarter, downriver.
      at: { x: c + 150, y: c - 130 },
      core: ['foundry', 'tannery', 'sawmill', 'workshop', 'workshop'],
      cottages: 9,
    },
    {
      // Trading quarter around the market cross.
      at: { x: c - 40, y: c + 60 },
      core: ['market', 'warehouse', 'guildhall', 'tavern', 'alehouse'],
      cottages: 9,
    },
    {
      // Church and green, upriver and quiet.
      at: { x: c + 60, y: c + 250 },
      core: ['church', 'chapel', 'almshouse', 'green', 'orchard'],
      cottages: 9,
    },
  ];

  for (const cluster of clusters) {
    for (const typeId of cluster.core) {
      scatter(world, typeId, cluster.at, 70, rng);
    }
    for (let i = 0; i < cluster.cottages; i++) {
      scatter(world, 'cottage', cluster.at, 105, rng);
    }
  }
}

/** Try random spots near a centre until one takes. Placement rules do the rest. */
function scatter(
  world: World,
  typeId: string,
  centre: Vec2,
  spread: number,
  rng: () => number,
  attempts = 60,
): void {
  for (let i = 0; i < attempts; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * spread;
    const pos = {
      x: centre.x + Math.cos(angle) * dist,
      y: centre.y + Math.sin(angle) * dist,
    };
    if (world.place(typeId, pos).ok) return;
  }
}
