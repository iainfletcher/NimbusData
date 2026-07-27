import { ROAD_HALF_WIDTH, walkRoad, type Road } from './roads';
import { Terrain } from './terrain';
import { CELL_SIZE, WORLD_CELLS } from './types';
import type { Fabric } from './fabric';

/**
 * How hard it is for the character of a place to reach the next square metre
 * (design/07 §3).
 *
 * The character field used to spread by symmetric blur, which is a distance
 * calculation wearing a costume: character reached equally far in every
 * direction regardless of what stood in the way. Real character doesn't behave
 * like that. It runs along streets, it pools in the market place, and it stops
 * at a ridge or a river.
 *
 * So instead of Euclidean distance, emissions spread by **geodesic** distance
 * through this cost field. A quarter behind a hill stays a separate place even
 * when it is close; a foundry's grime runs down the valley and along the road.
 *
 * The practical effect on play is the point: coherence becomes a question about
 * terrain — "is there a ridge between my tannery and my church?" — rather than
 * arithmetic about radii.
 */

/** Cost of crossing one cell of ordinary open ground. */
const OPEN = 1;

/** Streets carry character: cheap to travel, so districts follow the fabric. */
const ON_ROAD = 0.4;
const ON_PATH = 0.68;

/**
 * Water is a near-barrier. Not infinite — a town on both banks is still one
 * town — but a river is the classic reason two halves of a place feel different.
 */
const WATER = 9;

/** How sharply a slope resists. Perona–Malik's edge-stopping term. */
const SLOPE_K = 0.16;
const SLOPE_WEIGHT = 7;

export class Conductance {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;
  /** Traversal cost per cell. Higher is harder. */
  readonly cost: Float32Array;

  private constructor(cost: Float32Array) {
    this.cost = cost;
  }

  static build(terrain: Terrain, roads: readonly Road[], fabric: Fabric): Conductance {
    const n = WORLD_CELLS * WORLD_CELLS;
    const cost = new Float32Array(n);

    for (let cy = 0; cy < WORLD_CELLS; cy++) {
      for (let cx = 0; cx < WORLD_CELLS; cx++) {
        const wx = (cx + 0.5) * CELL_SIZE;
        const wy = (cy + 0.5) * CELL_SIZE;
        const i = cy * WORLD_CELLS + cx;

        if (terrain.isWater(wx, wy)) {
          cost[i] = WATER;
          continue;
        }

        // Edge-stopping: gentle ground is transparent, a scarp is nearly opaque.
        const slope = terrain.slopeAt(wx, wy);
        const resist = 1 - 1 / (1 + (slope / SLOPE_K) ** 2);
        cost[i] = OPEN + resist * SLOPE_WEIGHT;
      }
    }

    // Streets are corridors. Laid after terrain so they cut through it, which is
    // exactly what a road does to a hillside.
    const mark = (x: number, y: number, value: number) => {
      if (x < 0 || y < 0 || x >= WORLD_CELLS || y >= WORLD_CELLS) return;
      const i = y * WORLD_CELLS + x;
      if (value < cost[i]) cost[i] = value;
    };

    for (const road of roads) {
      const reach = Math.ceil(ROAD_HALF_WIDTH[road.cls] / CELL_SIZE);
      walkRoad(road, CELL_SIZE / 2, (p) => {
        const cx = Math.floor(p.x / CELL_SIZE);
        const cy = Math.floor(p.y / CELL_SIZE);
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) mark(cx + dx, cy + dy, ON_ROAD);
        }
      });
    }

    for (const path of fabric.paths) {
      for (const v of path) {
        const cx = Math.floor(v.x / CELL_SIZE);
        const cy = Math.floor(v.y / CELL_SIZE);
        const reach = Math.max(0, Math.round(v.halfWidth / CELL_SIZE));
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) mark(cx + dx, cy + dy, ON_PATH);
        }
      }
    }

    return new Conductance(cost);
  }

  at(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return WATER;
    return this.cost[cy * this.width + cx];
  }
}

/** A flat cost field, for before any fabric exists. */
export function openGround(): Conductance {
  const cost = new Float32Array(WORLD_CELLS * WORLD_CELLS).fill(OPEN);
  return Object.assign(Object.create(Conductance.prototype), {
    width: WORLD_CELLS,
    height: WORLD_CELLS,
    cost,
  }) as Conductance;
}
