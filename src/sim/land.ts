import { fbm } from './rng';
import type { Terrain } from './terrain';
import { CELL_SIZE, WORLD_CELLS } from './types';

/**
 * What the ground is good for (design/00, Axis 3).
 *
 * Three potentials, all derived from terrain that already exists rather than
 * scattered as separate deposits:
 *
 * - **Timber** follows the same woodland field the trees are scattered from, so
 *   the wood you can see is the wood you can cut.
 * - **Stone** follows slope, because that is where rock is at the surface.
 * - **Arable** follows flat, low, well-watered ground.
 *
 * The point is that resources are a **property of the landscape** rather than a
 * layer sprinkled on top. Siting a sawmill is then a spatial decision you make
 * by looking — is there wood here? — and never an arithmetic one about ratios,
 * which is the whole thesis in `00`.
 */

export interface Land {
  readonly width: number;
  readonly height: number;
  readonly timber: Float32Array;
  readonly stone: Float32Array;
  readonly arable: Float32Array;
}

export function computeLand(terrain: Terrain, seed: number): Land {
  const width = WORLD_CELLS;
  const height = WORLD_CELLS;
  const n = width * height;

  const timber = new Float32Array(n);
  const stone = new Float32Array(n);
  const arable = new Float32Array(n);

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx;
      const wx = (cx + 0.5) * CELL_SIZE;
      const wy = (cy + 0.5) * CELL_SIZE;

      if (terrain.isWater(wx, wy)) continue;

      const h = terrain.heightAtCell(cx, cy);
      const slope = terrain.slopeAt(wx, wy);

      // Exactly the field `decor.ts` scatters woodland from, so what you can
      // see and what you can fell are the same thing.
      const wood = fbm(wx / 190, wy / 190, seed ^ 0x77ee, 3);
      timber[i] = Math.max(0, (wood - 0.5) * 2.4);

      // Rock is at the surface where the ground is steep.
      stone[i] = Math.max(0, Math.min(1, (slope - 0.12) * 3.4));

      // Farmland wants flat, low and not a bog.
      const flat = Math.max(0, 1 - slope * 6);
      const lowland = h > 1 && h < 46 ? 1 : Math.max(0, 1 - Math.abs(h - 24) / 40);
      arable[i] = flat * lowland;
    }
  }

  return { width, height, timber, stone, arable };
}

/**
 * Total potential of one kind within a radius.
 *
 * Catchment is deliberately what production is measured over, so two sawmills in
 * the same wood share it. Over-building is wasteful and never broken, and there
 * is no correct number of mills to work out — you can see the wood, and you can
 * see the second mill standing idle.
 */
export function harvestable(
  field: Float32Array,
  at: { x: number; y: number },
  radius: number,
): number {
  const cx = at.x / CELL_SIZE;
  const cy = at.y / CELL_SIZE;
  const r = radius / CELL_SIZE;

  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(WORLD_CELLS - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(WORLD_CELLS - 1, Math.ceil(cy + r));

  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      total += field[y * WORLD_CELLS + x] * (1 - d / r);
    }
  }
  return total;
}
