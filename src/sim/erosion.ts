import { makeRng } from './rng';

/**
 * Droplet hydraulic erosion.
 *
 * Fractal noise makes lumps, not landscape: it has no idea what water does, so
 * every slope is equally plausible and nothing drains anywhere. Running a few
 * tens of thousands of droplets down the surface carves valleys that actually
 * join up, sharpens ridges between them, and lays sediment out in fans where the
 * ground flattens.
 *
 * It matters here for more than looks: `hydrology.ts` derives the rivers from
 * this surface, so the terrain has to be one water could plausibly have shaped.
 * Run once at generation.
 */

export interface ErosionParams {
  droplets: number;
  /** Steps before a droplet gives up. */
  lifetime: number;
  /** How much a droplet keeps its heading versus following the slope. */
  inertia: number;
  /** Sediment carried per unit of speed and water. */
  capacity: number;
  erodeRate: number;
  depositRate: number;
  evaporation: number;
  gravity: number;
  /** Radius in cells over which erosion is spread, so it doesn't cut pits. */
  brush: number;
}

export const DEFAULT_EROSION: ErosionParams = {
  droplets: 60_000,
  lifetime: 42,
  inertia: 0.06,
  capacity: 5,
  erodeRate: 0.32,
  depositRate: 0.24,
  evaporation: 0.022,
  gravity: 5,
  brush: 2,
};

export function erode(
  heights: Float32Array,
  width: number,
  height: number,
  seed: number,
  params: ErosionParams = DEFAULT_EROSION,
): void {
  const rng = makeRng(seed ^ 0xe0d3);
  const { brush } = params;

  // Precompute the deposit/erode kernel once; it's the same for every droplet.
  const offsets: number[] = [];
  const weights: number[] = [];
  let weightSum = 0;
  for (let dy = -brush; dy <= brush; dy++) {
    for (let dx = -brush; dx <= brush; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > brush) continue;
      const w = 1 - d / (brush + 1);
      offsets.push(dy * width + dx);
      weights.push(w);
      weightSum += w;
    }
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= weightSum;

  const at = (x: number, y: number): number => {
    const xi = Math.min(width - 2, Math.max(0, Math.floor(x)));
    const yi = Math.min(height - 2, Math.max(0, Math.floor(y)));
    return yi * width + xi;
  };

  /** Height and gradient by bilinear interpolation. */
  const sample = (x: number, y: number) => {
    const xi = Math.min(width - 2, Math.max(0, Math.floor(x)));
    const yi = Math.min(height - 2, Math.max(0, Math.floor(y)));
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * width + xi;

    const h00 = heights[i];
    const h10 = heights[i + 1];
    const h01 = heights[i + width];
    const h11 = heights[i + width + 1];

    return {
      height:
        h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy,
      gx: (h10 - h00) * (1 - fy) + (h11 - h01) * fy,
      gy: (h01 - h00) * (1 - fx) + (h11 - h10) * fx,
    };
  };

  const change = (x: number, y: number, amount: number) => {
    const base = at(x, y);
    for (let k = 0; k < offsets.length; k++) {
      const idx = base + offsets[k];
      if (idx < 0 || idx >= heights.length) continue;
      heights[idx] += amount * weights[k];
    }
  };

  for (let d = 0; d < params.droplets; d++) {
    let x = rng() * (width - 1);
    let y = rng() * (height - 1);
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < params.lifetime; step++) {
      const here = sample(x, y);

      dirX = dirX * params.inertia - here.gx * (1 - params.inertia);
      dirY = dirY * params.inertia - here.gy * (1 - params.inertia);

      const len = Math.hypot(dirX, dirY);
      if (len < 1e-6) break;
      dirX /= len;
      dirY /= len;

      const nx = x + dirX;
      const ny = y + dirY;
      if (nx < 1 || ny < 1 || nx >= width - 2 || ny >= height - 2) break;

      const drop = sample(nx, ny).height - here.height;

      // Uphill, or carrying more than it can: put sediment down.
      const carry = Math.max(-drop * speed * water * params.capacity, 0.008);

      if (sediment > carry || drop > 0) {
        const deposit =
          drop > 0 ? Math.min(drop, sediment) : (sediment - carry) * params.depositRate;
        sediment -= deposit;
        change(x, y, deposit);
      } else {
        const taken = Math.min((carry - sediment) * params.erodeRate, -drop);
        sediment += taken;
        change(x, y, -taken);
      }

      speed = Math.sqrt(Math.max(0, speed * speed + drop * -params.gravity));
      water *= 1 - params.evaporation;
      if (water < 0.01) break;

      x = nx;
      y = ny;
    }
  }
}
