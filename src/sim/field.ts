import {
  CELL_SIZE,
  CHARACTER_COUNT,
  CHARACTERS,
  WORLD_CELLS,
  characterIndex,
  type Building,
  type Character,
  type FieldReading,
} from './types';
import { buildingType } from './buildings';
import { Conductance, openGround } from './conductance';
import { MinHeap } from './heap';

/**
 * The character field (design/04).
 *
 * Each tick the field is rebuilt from scratch rather than integrated over time:
 * emissions are stamped, then softened. This keeps it a pure function of
 * building layout, which makes it trivially reproducible and means removing a
 * building takes effect immediately rather than leaving a ghost.
 *
 * Emissions spread by **geodesic** distance through a cost field, not by
 * straight-line distance (design/07 §3). So character runs along streets, pools
 * where they meet, and is stopped by a ridge or a river. See `conductance.ts`
 * for why that matters more than it sounds.
 *
 * Read back as `dominant` (which character is strongest here) and `coherence`
 * (how clearly it dominates) — the design's central quantity.
 */
export class CharacterField {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;

  /** One Float32Array per character, indexed y * width + x. */
  readonly layers: Float32Array[] = [];

  private scratch: Float32Array;
  private conductance: Conductance = openGround();

  // Reused across stamps rather than reallocated per building per emission.
  private dist: Float32Array;
  private visited: Uint8Array;
  private touched: number[] = [];
  private heap = new MinHeap();

  constructor() {
    const n = this.width * this.height;
    for (let i = 0; i < CHARACTER_COUNT; i++) this.layers.push(new Float32Array(n));
    this.scratch = new Float32Array(n);
    this.dist = new Float32Array(n);
    this.visited = new Uint8Array(n);
  }

  rebuild(
    buildings: readonly Building[],
    conductance: Conductance = openGround(),
    smoothPasses = 1,
  ): void {
    this.conductance = conductance;
    for (const layer of this.layers) layer.fill(0);
    for (const b of buildings) this.stamp(b);
    for (let i = 0; i < smoothPasses; i++) {
      for (const layer of this.layers) this.blur(layer);
    }
  }

  /**
   * Write one building's emissions by walking outward through the cost field,
   * cheapest-first, until the accumulated cost exceeds the emission's reach.
   *
   * This is Dijkstra rather than a radial stamp, which is the whole point: the
   * shape of a district is decided by what it costs to get there, not by how far
   * away it is.
   */
  private stamp(building: Building): void {
    const type = buildingType(building.typeId);
    if (type.emissions.length === 0) return;

    const startX = Math.floor(building.pos.x / CELL_SIZE);
    const startY = Math.floor(building.pos.y / CELL_SIZE);
    if (startX < 0 || startY < 0 || startX >= this.width || startY >= this.height) return;
    const start = startY * this.width + startX;

    for (const em of type.emissions) {
      const layer = this.layers[characterIndex(em.character)];
      // Reach is expressed in metres of *open ground*; rough going costs more.
      const budget = em.radius / CELL_SIZE;

      this.floodFrom(start, budget, (cell, cost) => {
        const t = 1 - cost / budget;
        layer[cell] += em.strength * t * t;
      });
    }
  }

  /** Cheapest-first flood out to a cost budget. Clears its own scratch state. */
  private floodFrom(
    start: number,
    budget: number,
    visit: (cell: number, cost: number) => void,
  ): void {
    const { width, height } = this;
    const heap = this.heap;
    heap.clear();

    this.dist[start] = 0;
    this.visited[start] = 1;
    this.touched.length = 0;
    this.touched.push(start);
    heap.push(start, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      const cost = this.dist[current];
      if (this.visited[current] === 2) continue;
      this.visited[current] = 2;

      visit(current, cost);

      const cx = current % width;
      const cy = (current / width) | 0;

      for (let d = 0; d < 8; d++) {
        const nx = cx + NEIGHBOUR_DX[d];
        const ny = cy + NEIGHBOUR_DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const ni = ny * width + nx;
        if (this.visited[ni] === 2) continue;

        const step = NEIGHBOUR_STEP[d] * this.conductance.at(nx, ny);
        const next = cost + step;
        if (next > budget) continue;

        if (this.visited[ni] === 0 || next < this.dist[ni]) {
          if (this.visited[ni] === 0) this.touched.push(ni);
          this.dist[ni] = next;
          this.visited[ni] = 1;
          heap.push(ni, next);
        }
      }
    }

    for (const cell of this.touched) this.visited[cell] = 0;
    this.touched.length = 0;
  }

  /** A light separable blur, only to take the stair-stepping off the flood. */
  private blur(layer: Float32Array): void {
    const { width, height, scratch } = this;
    const decay = 0.985;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const l = layer[row + Math.max(0, x - 1)];
        const c = layer[row + x];
        const r = layer[row + Math.min(width - 1, x + 1)];
        scratch[row + x] = (l + 2 * c + r) * 0.25;
      }
    }

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const u = scratch[Math.max(0, y - 1) * width + x];
        const c = scratch[y * width + x];
        const d = scratch[Math.min(height - 1, y + 1) * width + x];
        layer[y * width + x] = (u + 2 * c + d) * 0.25 * decay;
      }
    }
  }

  strengthAtCell(character: Character, cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return 0;
    return this.layers[characterIndex(character)][cy * this.width + cx];
  }

  readCell(cx: number, cy: number): FieldReading {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) {
      return { dominant: null, coherence: 0, intensity: 0 };
    }

    const i = cy * this.width + cx;
    let total = 0;
    let best = 0;
    let bestIdx = -1;

    for (let c = 0; c < CHARACTER_COUNT; c++) {
      const v = this.layers[c][i];
      total += v;
      if (v > best) {
        best = v;
        bestIdx = c;
      }
    }

    // Below this there simply isn't a district here — open country, not a muddle.
    if (total < 0.02 || bestIdx < 0) {
      return { dominant: null, coherence: 0, intensity: total };
    }

    return {
      dominant: CHARACTERS[bestIdx],
      coherence: best / total,
      intensity: total,
    };
  }

  read(wx: number, wy: number): FieldReading {
    return this.readCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  /**
   * How well the town knows what it is: mean coherence over inhabited ground,
   * weighted by intensity so open country doesn't dilute the answer.
   *
   * Kept because it is the only number that says whether a change to the field
   * helped or hurt. Eyeballing a haze does not.
   */
  townCoherence(): { mean: number; cells: number } {
    let weighted = 0;
    let weight = 0;
    let cells = 0;

    for (let cy = 0; cy < this.height; cy++) {
      for (let cx = 0; cx < this.width; cx++) {
        const r = this.readCell(cx, cy);
        if (!r.dominant || r.intensity < 0.1) continue;
        weighted += r.coherence * r.intensity;
        weight += r.intensity;
        cells++;
      }
    }

    return { mean: weight > 0 ? weighted / weight : 0, cells };
  }
}

/**
 * Coherence floor for a place to "know what it is".
 *
 * With six characters, an even muddle sits at 1/6 ≈ 0.17 and a single unopposed
 * emitter reaches 1.0. Housing evolves only above this.
 */
export const COHERENCE_THRESHOLD = 0.55;

const NEIGHBOUR_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOUR_DY = [0, 0, 1, -1, 1, -1, 1, -1];
const NEIGHBOUR_STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
