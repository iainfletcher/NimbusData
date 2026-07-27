import { MinHeap } from './heap';

/**
 * Where the water goes (design/07 §4).
 *
 * Three standard steps out of GIS hydrology:
 *
 * 1. **Priority-flood** (Barnes, Lehman & Mulla 2014) fills depressions from the
 *    map edge inward, so every cell has somewhere to drain to. Cells raised by
 *    the fill are lakes — the fill height *is* the water surface.
 * 2. **D8 flow direction** (O'Callaghan & Mark 1984): each cell drains to its
 *    steepest downhill neighbour.
 * 3. **Flow accumulation**: process cells from high to low, handing each one's
 *    accumulated catchment to its downstream neighbour. Anything above a
 *    threshold is a watercourse.
 *
 * The point is that the river stops being painted on and becomes something the
 * landscape *explains*. Dig a channel and water finds it; dam a valley and a
 * lake appears behind the dam — because both are consequences of the same three
 * passes, not special cases.
 *
 * And it yields a real siting constraint almost for free: a watermill needs
 * **flow and fall**, so `millPotential` is accumulation times gradient. That is a
 * spatial decision derived from the land rather than a rule invented for the
 * player to learn.
 */

/** Cells of upstream catchment before ground counts as a watercourse. */
export const STREAM_THRESHOLD = 260;
export const RIVER_THRESHOLD = 2200;

/**
 * Lakes shallower than this are just damp ground. Erosion leaves a scattering of
 * one-cell pits, and without a real threshold every one of them becomes a pond.
 */
const MIN_LAKE_DEPTH = 1.2;

/**
 * Tiny increment applied as depressions are filled.
 *
 * Filling a pit to exactly level leaves a **flat**, and D8 cannot drain a flat —
 * every neighbour is the same height, so the search finds no downhill and the
 * flow stops dead. That is why the first attempt produced isolated ponds and no
 * rivers at all. Raising each filled cell an epsilon above the one that reached
 * it guarantees a downhill direction everywhere, and the drainage becomes
 * connected. This is the standard Priority-Flood + ε variant.
 */
const EPSILON = 1e-4;

export interface Hydrology {
  readonly width: number;
  readonly height: number;
  /** Heights after depressions are filled. */
  readonly filled: Float32Array;
  /** Upstream cell count draining through each cell. */
  readonly accumulation: Float32Array;
  /** Water surface elevation, or NaN where dry. */
  readonly surface: Float32Array;
  /** Accumulation × fall — high where a watermill would actually work. */
  readonly millPotential: Float32Array;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export function computeHydrology(
  heights: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
): Hydrology {
  const n = width * height;
  const filled = new Float32Array(n);
  const accumulation = new Float32Array(n).fill(1);
  const surface = new Float32Array(n).fill(NaN);
  const millPotential = new Float32Array(n);

  // ---- 1. Priority-flood --------------------------------------------------
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  const push = (i: number, h: number) => {
    if (closed[i]) return;
    closed[i] = 1;
    filled[i] = h;
    heap.push(i, h);
  };

  // Seed from the whole boundary: water leaves the map at its edges.
  for (let x = 0; x < width; x++) {
    push(x, heights[x]);
    push((height - 1) * width + x, heights[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y++) {
    push(y * width, heights[y * width]);
    push(y * width + width - 1, heights[y * width + width - 1]);
  }

  while (heap.size > 0) {
    const i = heap.pop();
    const cx = i % width;
    const cy = (i / width) | 0;

    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      // A neighbour can never sit below the cell that reached it, or water
      // would have nowhere to go — raising it is precisely what fills the pit.
      // The epsilon keeps filled ground very slightly tilted so it still drains.
      push(ni, Math.max(heights[ni], filled[i] + EPSILON));
    }
  }

  // ---- 2. D8 flow direction ----------------------------------------------
  const downstream = new Int32Array(n).fill(-1);

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx;
      let bestDrop = 0;
      let best = -1;

      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        const dist = d < 4 ? 1 : Math.SQRT2;
        const drop = (filled[i] - filled[ni]) / dist;
        if (drop > bestDrop) {
          bestDrop = drop;
          best = ni;
        }
      }

      downstream[i] = best;
    }
  }

  // ---- 3. Accumulation ----------------------------------------------------
  // Highest first, so a cell is always resolved before whatever it drains into.
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => filled[b] - filled[a]);

  for (const i of sorted) {
    const to = downstream[i];
    if (to >= 0) accumulation[to] += accumulation[i];
  }

  // ---- Water surface and mill sites --------------------------------------
  for (let i = 0; i < n; i++) {
    // The epsilon inflates fill slightly; subtract a generous allowance so it
    // never registers as standing water on its own.
    const lakeDepth = filled[i] - heights[i] - EPSILON * n * 0.5;
    const isLake = lakeDepth > MIN_LAKE_DEPTH;
    const isSea = heights[i] <= seaLevel;
    const isStream = accumulation[i] >= STREAM_THRESHOLD;

    if (isSea) surface[i] = seaLevel;
    else if (isLake) surface[i] = filled[i];
    else if (isStream) surface[i] = heights[i];

    // Fall to the downstream neighbour, which is what actually turns a wheel.
    const to = downstream[i];
    const fall = to >= 0 ? Math.max(0, filled[i] - filled[to]) : 0;
    millPotential[i] = isLake ? 0 : Math.sqrt(accumulation[i]) * fall;
  }

  return { width, height, filled, accumulation, surface, millPotential };
}

/** Convenience: is there standing or running water here? */
export function isWet(hydro: Hydrology, i: number): boolean {
  return !Number.isNaN(hydro.surface[i]);
}

/** Watercourse width in metres, from catchment. Zero when dry. */
export function channelWidth(accumulation: number): number {
  if (accumulation < STREAM_THRESHOLD) return 0;
  if (accumulation >= RIVER_THRESHOLD) {
    return Math.min(26, 9 + Math.sqrt(accumulation - RIVER_THRESHOLD) * 0.35);
  }
  return 2.5 + (accumulation - STREAM_THRESHOLD) / (RIVER_THRESHOLD - STREAM_THRESHOLD) * 6.5;
}
