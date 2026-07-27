import { buildingType } from './buildings';
import type { Conductance } from './conductance';
import type { CharacterField } from './field';
import { COHERENCE_THRESHOLD } from './field';
import { GeodesicFlood } from './flood';
import { CELL_SIZE, WORLD_CELLS, type Building } from './types';

/**
 * Cultural pressure and the border (design/01).
 *
 * The claim this exists to test: **a town pushes its own borders outward by
 * being good to live in, and a neglected one loses ground in peacetime, to
 * nobody, with no war declared.**
 *
 * Two properties from `01` and `04` are load-bearing and easy to get wrong:
 *
 * 1. **Culture is earned, not built.** There is no culture building. Pressure is
 *    radiated by ordinary buildings as a by-product of the town working, so the
 *    only way to project further is to build a better town.
 *
 * 2. **It comes from strength of character, not from niceness.** A coherent
 *    industrious dockside radiates exactly as hard as a coherent genteel
 *    crescent. What is rewarded is a quarter being *unmistakably something* —
 *    which is why the multiplier is coherence, and why a muddled district
 *    radiates almost nothing however much is built in it.
 *
 * Pressure spreads geodesically (`flood.ts`), so it runs along roads and is
 * stopped by ridges and water: a river really is the classic reason two halves
 * of a valley belong to different people.
 */

export const OWNER_PLAYER = 0;
export const OWNER_RIVAL = 1;
export const OWNER_COUNT = 2;

/**
 * How far culture reaches, in metres of open ground, per unit of output.
 * Culture is a settlement-scale thing and travels much further than the
 * district-scale character field.
 */
const REACH_PER_OUTPUT = 128;
const MAX_REACH = 420;

/**
 * How fast the claim moves toward the pressure balance, per tick.
 *
 * Deliberately slow. `01` makes stickiness the defining difference between
 * cultural and military pressure: a tower's hold vanishes the moment it falls,
 * whereas ground that has been yours for a generation stays yours for a while
 * after the reason for it has gone. Hysteresis is the mechanic, not a smoothing
 * detail.
 */
const CLAIM_RATE = 0.045;

/** Below this the ground is nobody's — open country, not contested. */
const CLAIMED_THRESHOLD = 0.12;

export interface TerritoryStats {
  /** Cells held, per owner. */
  cells: number[];
  /** Length of the contested frontier, in cells. */
  frontier: number;
  /**
   * Mean coherence of each owner's own ground, and total cultural output.
   *
   * Without these the headline "who holds more" is uninterpretable: a town could
   * be winning on size, on coherence, or on luck of terrain, and the cell count
   * alone cannot tell you which.
   */
  coherence: number[];
  output: number[];
}

export class Territory {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;

  /** Instantaneous cultural pressure, per owner. */
  readonly pressure: Float32Array[] = [];

  /**
   * Signed, settled claim: +1 firmly the player's, −1 firmly the rival's, 0
   * unclaimed or evenly contested. This is what the border is read from.
   */
  readonly claim: Float32Array;

  private flood = new GeodesicFlood();

  constructor() {
    const n = this.width * this.height;
    for (let i = 0; i < OWNER_COUNT; i++) this.pressure.push(new Float32Array(n));
    this.claim = new Float32Array(n);
  }

  /**
   * Recompute pressure from the current town, then let the claim drift toward
   * it. Pressure is instantaneous; the claim is not.
   */
  update(
    buildings: readonly Building[],
    field: CharacterField,
    conductance: Conductance,
    steps = 1,
  ): void {
    for (const layer of this.pressure) layer.fill(0);

    for (const b of buildings) {
      const output = culturalOutput(b, field);
      if (output <= 0) continue;

      const cx = Math.floor(b.pos.x / CELL_SIZE);
      const cy = Math.floor(b.pos.y / CELL_SIZE);
      if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) continue;

      const layer = this.pressure[b.owner ?? OWNER_PLAYER];
      const reach = Math.min(MAX_REACH, output * REACH_PER_OUTPUT) / CELL_SIZE;

      this.flood.run(conductance, cy * this.width + cx, reach, (cell, cost) => {
        const t = 1 - cost / reach;
        layer[cell] += output * t * t;
      });
    }

    this.settle(steps);
  }

  /** Move the claim toward the current balance of pressure. */
  private settle(steps: number): void {
    const player = this.pressure[OWNER_PLAYER];
    const rival = this.pressure[OWNER_RIVAL];
    const rate = 1 - (1 - CLAIM_RATE) ** steps;

    for (let i = 0; i < this.claim.length; i++) {
      const total = player[i] + rival[i];
      // Normalised balance: who is stronger here, and by how much of the total.
      const target = total > 1e-4 ? (player[i] - rival[i]) / total : 0;
      // Faint pressure should not claim ground outright, so scale by presence.
      const presence = Math.min(1, total / 0.35);
      this.claim[i] += (target * presence - this.claim[i]) * rate;
    }
  }

  /** Which owner holds a cell, or null for open country. */
  ownerAtCell(cx: number, cy: number): number | null {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return null;
    const v = this.claim[cy * this.width + cx];
    if (Math.abs(v) < CLAIMED_THRESHOLD) return null;
    return v > 0 ? OWNER_PLAYER : OWNER_RIVAL;
  }

  ownerAt(wx: number, wy: number): number | null {
    return this.ownerAtCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  stats(buildings?: readonly Building[], field?: CharacterField): TerritoryStats {
    const cells = new Array(OWNER_COUNT).fill(0);
    const coherence = new Array(OWNER_COUNT).fill(0);
    const output = new Array(OWNER_COUNT).fill(0);
    const counts = new Array(OWNER_COUNT).fill(0);
    let frontier = 0;

    if (buildings && field) {
      for (const b of buildings) {
        const owner = b.owner ?? OWNER_PLAYER;
        const reading = field.read(b.pos.x, b.pos.y);
        coherence[owner] += reading.dominant ? reading.coherence : 0;
        output[owner] += culturalOutput(b, field);
        counts[owner]++;
      }
      for (let o = 0; o < OWNER_COUNT; o++) {
        if (counts[o] > 0) coherence[o] /= counts[o];
      }
    }

    for (let cy = 0; cy < this.height; cy++) {
      for (let cx = 0; cx < this.width; cx++) {
        const owner = this.ownerAtCell(cx, cy);
        if (owner === null) continue;
        cells[owner]++;

        // A frontier cell is one whose neighbour belongs to somebody else.
        const right = this.ownerAtCell(cx + 1, cy);
        const down = this.ownerAtCell(cx, cy + 1);
        if ((right !== null && right !== owner) || (down !== null && down !== owner)) {
          frontier++;
        }
      }
    }

    return { cells, frontier, coherence, output };
  }
}

/**
 * What a building radiates.
 *
 * Coherence is the multiplier, which is the whole design in one line: a quarter
 * that is unmistakably *something* projects, and a muddle projects nothing no
 * matter how much stands in it. Age contributes because an established place
 * carries more weight than a new one (design/04's Antique, in embryo).
 */
function culturalOutput(b: Building, field: CharacterField): number {
  const type = buildingType(b.typeId);
  const reading = field.read(b.pos.x, b.pos.y);
  if (!reading.dominant) return 0;

  // Coherence is applied steeply, not linearly.
  //
  // A linear multiplier turned out to barely separate a well-ordered town from a
  // jumbled one — measured at 78% against 66%, which is only a fifth more
  // output. The reason is that it is genuinely hard to build an *incoherent*
  // town: character concentrates locally almost whatever the layout, so nearly
  // everything clears the threshold. For "unmistakably something" to be worth
  // anything, the response has to punish the middle of the range.
  const above = (reading.coherence - COHERENCE_THRESHOLD) / (1 - COHERENCE_THRESHOLD);
  // Squaring proved too much — it gave a six-to-one rout for a nine-point
  // coherence gap, and shrank everyone's reach so far that most of the map went
  // unclaimed. 1.6 keeps a clear advantage without annihilating the loser.
  const clarity = above <= 0 ? Math.max(0, reading.coherence) * 0.12 : above ** 1.6;

  const base =
    type.family === 'civic' ? 1.0 : type.family === 'economic' ? 0.62 : 0.34;

  // Landmarks carry further; a church is visible from the next parish.
  const landmark = type.id === 'church' || type.id === 'market' ? 1.7 : 1;

  // Standing a long while counts for something.
  const age = Math.min(1.35, 1 + b.age / 4000);

  return base * landmark * clarity * age;
}
