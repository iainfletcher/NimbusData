import { MinHeap } from './heap';
import type { Conductance } from './conductance';
import { WORLD_CELLS } from './types';

/**
 * Cheapest-first flood over a cost field.
 *
 * Extracted because two systems now spread the same way and for the same
 * reason: the character field (`field.ts`) and cultural pressure
 * (`territory.ts`) both travel by **geodesic** distance rather than Euclidean,
 * so both run along streets, pool where streets meet, and stop at a ridge or a
 * river. Sharing the implementation also shares the scratch buffers, which
 * matters when it runs per emitter on every edit.
 */
export class GeodesicFlood {
  private readonly width = WORLD_CELLS;
  private readonly height = WORLD_CELLS;

  private dist: Float32Array;
  private state: Uint8Array;
  private touched: number[] = [];
  private heap = new MinHeap();

  constructor() {
    const n = this.width * this.height;
    this.dist = new Float32Array(n);
    this.state = new Uint8Array(n);
  }

  /**
   * Walk outward from `start` until accumulated cost exceeds `budget`, calling
   * `visit` once per cell with the cost of reaching it. Scratch state is reset
   * before returning, so the instance can be reused immediately.
   */
  run(
    conductance: Conductance,
    start: number,
    budget: number,
    visit: (cell: number, cost: number) => void,
  ): void {
    const { width, height, heap } = this;
    heap.clear();

    this.dist[start] = 0;
    this.state[start] = 1;
    this.touched.length = 0;
    this.touched.push(start);
    heap.push(start, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      if (this.state[current] === 2) continue;
      this.state[current] = 2;

      const cost = this.dist[current];
      visit(current, cost);

      const cx = current % width;
      const cy = (current / width) | 0;

      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const ni = ny * width + nx;
        if (this.state[ni] === 2) continue;

        const next = cost + STEP[d] * conductance.at(nx, ny);
        if (next > budget) continue;

        if (this.state[ni] === 0 || next < this.dist[ni]) {
          if (this.state[ni] === 0) this.touched.push(ni);
          this.dist[ni] = next;
          this.state[ni] = 1;
          heap.push(ni, next);
        }
      }
    }

    for (const cell of this.touched) this.state[cell] = 0;
    this.touched.length = 0;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
