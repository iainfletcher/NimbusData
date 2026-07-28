import { CELL_SIZE, WORLD_CELLS, type Vec2 } from './types';
import { fbm } from './rng';
import { DEFAULT_EROSION, erode } from './erosion';
import { channelWidth, computeHydrology, type Hydrology } from './hydrology';

/**
 * Terrain shares the field grid (see ARCHITECTURE.md). Heights are metres above
 * sea level.
 *
 * The surface is generated as noise, then **eroded** so it drains sensibly, then
 * its water is **derived** rather than drawn (`hydrology.ts`). Nothing here
 * carves a river: the river is wherever the water ends up going.
 *
 * The heightmap is mutable, and every edit re-derives the hydrology — which is
 * the point of having terrain tools at all. Dam a valley and the lake behind it
 * appears because the fill pass now finds a depression, not because anything
 * special-cases dams.
 */
export const WATER_LEVEL = 0;

/** How far a brush stroke reaches and how hard it bites, in metres. */
export interface BrushStroke {
  at: Vec2;
  radius: number;
  /** Metres of rise (positive) or cut (negative) at the centre. */
  amount: number;
}

export class Terrain {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;
  readonly heights: Float32Array;

  private hydro: Hydrology;
  private version = 0;
  private waterStale = false;

  constructor(seed: number) {
    this.heights = new Float32Array(this.width * this.height);
    this.generate(seed);
    this.hydro = this.deriveWater();
  }

  /** Bumped whenever the ground or its water changes. */
  get shape(): number {
    return this.version;
  }

  /** True when the ground has moved but the water has not caught up yet. */
  get waterPending(): boolean {
    return this.waterStale;
  }

  /**
   * Recompute the water if a sculpt has invalidated it.
   *
   * Deriving hydrology is a full flood-fill plus accumulation over the whole
   * grid — perfectly fine once, and hopeless if it runs on every pointer move
   * while dragging a brush. The heightmap updates immediately so the ground
   * responds under the cursor; the water catches up on a beat.
   */
  settleWater(): boolean {
    if (!this.waterStale) return false;
    this.waterStale = false;
    this.hydro = this.deriveWater();
    return true;
  }

  get hydrology(): Hydrology {
    return this.hydro;
  }

  private generate(seed: number): void {
    const { width, height, heights } = this;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        // Large-scale structure first, detail second.
        //
        // A tilted plane with fine noise on it drains in parallel: every cell
        // sends its water to its own neighbour, nothing ever converges, and
        // accumulation stays near zero everywhere — which produced a map of
        // disconnected dashes rather than rivers. Drainage needs somewhere to
        // *collect*, so the dominant term has to be low-frequency basins and
        // ridges, with the fine noise only roughening them.
        const basins = fbm(nx * 1.15, ny * 1.15, seed, 3);
        const ridges = fbm(nx * 2.1 + 11, ny * 2.1 + 7, seed + 101, 3);
        const grain = fbm(nx * 6.5 + 31, ny * 6.5 + 17, seed + 977, 3);
        const tilt = (1 - nx) * 0.4 + (1 - ny) * 0.6;

        heights[y * width + x] =
          basins * 62 + ridges * 22 + grain * 7 + tilt * 46 - 52;
      }
    }

    // Erosion is what turns lumps into a landscape that drains.
    erode(heights, width, height, seed, {
      ...DEFAULT_EROSION,
      droplets: 45_000,
      erodeRate: 0.42,
      lifetime: 56,
    });
  }

  private deriveWater(): Hydrology {
    this.version++;
    return computeHydrology(this.heights, this.width, this.height, WATER_LEVEL);
  }

  /**
   * Raise, cut or level the ground. Feature scale only, with a smooth falloff —
   * never vertex-by-vertex sculpting (design/03 §7).
   *
   * `level` flattens toward the average height under the brush instead of
   * displacing, which is how you cut a terrace or a building platform.
   */
  sculpt(stroke: BrushStroke, mode: 'raise' | 'level' = 'raise'): void {
    const rCells = stroke.radius / CELL_SIZE;
    const cx = stroke.at.x / CELL_SIZE;
    const cy = stroke.at.y / CELL_SIZE;

    const x0 = Math.max(0, Math.floor(cx - rCells));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rCells));
    const y0 = Math.max(0, Math.floor(cy - rCells));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + rCells));
    if (x1 < x0 || y1 < y0) return;

    let target = 0;
    if (mode === 'level') {
      let sum = 0;
      let count = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rCells) continue;
          sum += this.heights[y * this.width + x];
          count++;
        }
      }
      if (count === 0) return;
      target = sum / count;
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rCells;
        if (d > 1) continue;
        // Smoothstep falloff: no rim at the edge of a stroke.
        const w = 1 - d * d * (3 - 2 * d);
        const i = y * this.width + x;

        if (mode === 'level') {
          this.heights[i] += (target - this.heights[i]) * w * 0.6;
        } else {
          this.heights[i] += stroke.amount * w;
        }
      }
    }

    // The ground has moved; the water follows on the next settle.
    this.version++;
    this.waterStale = true;
  }

  heightAtCell(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return WATER_LEVEL;
    return this.heights[cy * this.width + cx];
  }

  /** Bilinear sample in world metres. */
  heightAt(wx: number, wy: number): number {
    const fx = wx / CELL_SIZE;
    const fy = wy / CELL_SIZE;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    const h00 = this.heightAtCell(x0, y0);
    const h10 = this.heightAtCell(x0 + 1, y0);
    const h01 = this.heightAtCell(x0, y0 + 1);
    const h11 = this.heightAtCell(x0 + 1, y0 + 1);

    return (
      h00 * (1 - tx) * (1 - ty) +
      h10 * tx * (1 - ty) +
      h01 * (1 - tx) * ty +
      h11 * tx * ty
    );
  }

  private cellIndex(wx: number, wy: number): number {
    const cx = Math.floor(wx / CELL_SIZE);
    const cy = Math.floor(wy / CELL_SIZE);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return -1;
    return cy * this.width + cx;
  }

  /** Water surface here, or NaN if dry. */
  waterAt(wx: number, wy: number): number {
    const i = this.cellIndex(wx, wy);
    return i < 0 ? WATER_LEVEL : this.hydro.surface[i];
  }

  isWater(wx: number, wy: number): boolean {
    const i = this.cellIndex(wx, wy);
    if (i < 0) return true;
    return !Number.isNaN(this.hydro.surface[i]);
  }

  /**
   * Is there fresh water within reach of here?
   *
   * Used by `needs.ts`: a house beside a stream has no use for a well. The sea
   * does not count — it is the one body of water on the map you cannot drink —
   * which is checked by level rather than by a flag, since anything sitting at
   * the sea's own surface is the sea.
   */
  freshWaterNear(at: Vec2, radius: number): boolean {
    const step = CELL_SIZE;
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = at.x + dx;
        const y = at.y + dy;
        if (!this.isWater(x, y)) continue;
        if (this.waterAt(x, y) <= WATER_LEVEL + 0.2) continue;
        return true;
      }
    }
    return false;
  }

  /** Upstream catchment draining through here, in cells. */
  flowAt(wx: number, wy: number): number {
    const i = this.cellIndex(wx, wy);
    return i < 0 ? 0 : this.hydro.accumulation[i];
  }

  /** How good a watermill site this is: needs both flow and fall. */
  millPotentialAt(wx: number, wy: number): number {
    const i = this.cellIndex(wx, wy);
    return i < 0 ? 0 : this.hydro.millPotential[i];
  }

  channelWidthAt(wx: number, wy: number): number {
    return channelWidth(this.flowAt(wx, wy));
  }

  /** Steepest gradient magnitude in metres per metre — used to block placement. */
  slopeAt(wx: number, wy: number): number {
    const d = CELL_SIZE;
    const hx = this.heightAt(wx + d, wy) - this.heightAt(wx - d, wy);
    const hy = this.heightAt(wx, wy + d) - this.heightAt(wx, wy - d);
    return Math.hypot(hx, hy) / (2 * d);
  }

  /** Whether a footprint can be built on: out of water, not too steep. */
  isBuildable(pos: Vec2, width: number, depth: number): boolean {
    const hw = width / 2;
    const hd = depth / 2;
    const samples: Vec2[] = [
      { x: pos.x - hw, y: pos.y - hd },
      { x: pos.x + hw, y: pos.y - hd },
      { x: pos.x - hw, y: pos.y + hd },
      { x: pos.x + hw, y: pos.y + hd },
      { x: pos.x, y: pos.y },
    ];

    let min = Infinity;
    let max = -Infinity;
    for (const s of samples) {
      if (this.isWater(s.x, s.y)) return false;
      const h = this.heightAt(s.x, s.y);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    // Reject ground that would need a visibly implausible amount of levelling.
    return max - min < 4;
  }
}
