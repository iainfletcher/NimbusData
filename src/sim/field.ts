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

/**
 * The character field (design/04).
 *
 * Each tick the field is rebuilt from scratch rather than integrated over time:
 * emissions are stamped, then blurred. This keeps it a pure function of building
 * layout, which makes it trivially reproducible and means removing a building
 * takes effect immediately rather than leaving a ghost.
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

  constructor() {
    const n = this.width * this.height;
    for (let i = 0; i < CHARACTER_COUNT; i++) this.layers.push(new Float32Array(n));
    this.scratch = new Float32Array(n);
  }

  rebuild(buildings: readonly Building[], diffusePasses = 2): void {
    for (const layer of this.layers) layer.fill(0);
    for (const b of buildings) this.stamp(b);
    for (let i = 0; i < diffusePasses; i++) {
      for (const layer of this.layers) this.blur(layer);
    }
  }

  /** Write one building's emissions into the layers with a smooth radial falloff. */
  private stamp(building: Building): void {
    const type = buildingType(building.typeId);
    if (type.emissions.length === 0) return;

    const cx = building.pos.x / CELL_SIZE;
    const cy = building.pos.y / CELL_SIZE;

    for (const em of type.emissions) {
      const layer = this.layers[characterIndex(em.character)];
      const rCells = em.radius / CELL_SIZE;
      const r2 = rCells * rCells;

      const x0 = Math.max(0, Math.floor(cx - rCells));
      const x1 = Math.min(this.width - 1, Math.ceil(cx + rCells));
      const y0 = Math.max(0, Math.floor(cy - rCells));
      const y1 = Math.min(this.height - 1, Math.ceil(cy + rCells));

      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          // Smooth falloff: 1 at the centre, 0 at the radius, gentle at both ends.
          const t = 1 - Math.sqrt(d2) / rCells;
          layer[y * this.width + x] += em.strength * t * t;
        }
      }
    }
  }

  /** Separable 1-2-1 blur with slight decay, so character bleeds outward. */
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
}

/**
 * Coherence floor for a place to "know what it is".
 *
 * With six characters, an even muddle sits at 1/6 ≈ 0.17 and a single unopposed
 * emitter reaches 1.0. Housing evolves only above this.
 */
export const COHERENCE_THRESHOLD = 0.55;
