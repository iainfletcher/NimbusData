import { CELL_SIZE, WORLD_CELLS, type Vec2 } from './types';
import { fbm } from './rng';

/**
 * Terrain shares the field grid (see ARCHITECTURE.md). Heights are metres above
 * sea level; anything at or below WATER_LEVEL is water.
 */
export const WATER_LEVEL = 0;

export class Terrain {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;
  readonly heights: Float32Array;

  constructor(seed: number) {
    this.heights = new Float32Array(this.width * this.height);
    this.generate(seed);
  }

  private generate(seed: number): void {
    const { width, height, heights } = this;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;

        // Broad rolling land, with a valley cut through it for a river.
        const base = fbm(nx * 3.5, ny * 3.5, seed, 5);
        const ridge = fbm(nx * 1.5 + 11, ny * 1.5 + 7, seed + 101, 3);

        // A meandering river channel: distance from a noisy vertical line.
        const meander = fbm(ny * 2.2, 0.5, seed + 313, 3);
        const riverX = 0.42 + (meander - 0.5) * 0.28;
        const distToRiver = Math.abs(nx - riverX);
        const channel = Math.max(0, 1 - distToRiver / 0.045);

        let h = base * 26 + ridge * 14 - 8;
        h -= channel * channel * 22;

        heights[y * width + x] = h;
      }
    }
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

  isWater(wx: number, wy: number): boolean {
    return this.heightAt(wx, wy) <= WATER_LEVEL;
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
