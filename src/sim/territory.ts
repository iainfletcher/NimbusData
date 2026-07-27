import { buildingType } from './buildings';
import type { Conductance } from './conductance';
import type { CharacterField } from './field';
import { COHERENCE_THRESHOLD } from './field';
import { GeodesicFlood } from './flood';
import type { Military } from './military';
import {
  CELL_SIZE,
  OWNER_COUNT,
  OWNER_PLAYER,
  OWNER_RIVAL,
  WORLD_CELLS,
  type Building,
} from './types';

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

export { OWNER_PLAYER, OWNER_RIVAL, OWNER_COUNT };

/**
 * The two states territory can be in (design/01 §3), and the reason the two
 * fields make a strategy rather than a pair of overlays.
 *
 * - **Held** — inside somebody's military contour, culture below threshold. It
 *   costs upkeep, it does not grow, and it leaves the moment the soldiers do.
 * - **Integrated** — culture above threshold. Genuinely theirs; the garrison can
 *   be withdrawn and the land stays.
 *
 * Getting from one to the other takes time *and* a town worth radiating from,
 * which is the anti-snowball mechanism: blitzing wins a wide, sullen, expensive
 * empire that produces almost nothing.
 */
export type Standing = 'open' | 'held' | 'integrated' | 'contested';

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
  /**
   * Of those, how many are merely *held* — inside a military contour that
   * culture has not filled. A big gap between `cells` and `cells - held` is the
   * gilded cage of `01` §5, and it is the number that says an empire is sullen.
   */
  held: number[];
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

  /**
   * The military field, once there is one. Territory owns the *reading* of it
   * rather than the field itself, because "who holds this ground" and "whose
   * ground is this" are the same question asked of two different systems.
   */
  private military: Military | null = null;

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
    military: Military | null = null,
  ): void {
    this.military = military;
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

  /**
   * Move the claim toward the current balance of pressure.
   *
   * The one place the military field reaches into this one: **culture cannot
   * take ground that is actively defended** (`01` §2, §7 risk 4). Inside
   * somebody's military contour, only their culture is allowed to count, so a
   * border physically cannot drift through a garrisoned zone however lovely the
   * town on the other side is.
   *
   * Note what this does *not* do. It does not push the claim toward the holder;
   * it only stops the opponent's. Hold ground with soldiers and nothing happens
   * culturally at all — you have frozen it, not won it, and it stays frozen for
   * exactly as long as you keep paying. That is the difference between taking
   * and converting, expressed as three lines of arithmetic.
   */
  private settle(steps: number): void {
    const player = this.pressure[OWNER_PLAYER];
    const rival = this.pressure[OWNER_RIVAL];
    const rate = 1 - (1 - CLAIM_RATE) ** steps;
    const military = this.military;

    for (let i = 0; i < this.claim.length; i++) {
      let p = player[i];
      let r = rival[i];

      if (military) {
        const holder =
          military.holderAtCell(i % this.width, (i / this.width) | 0);
        if (holder === OWNER_PLAYER) r = 0;
        else if (holder === OWNER_RIVAL) p = 0;
      }

      const total = p + r;
      // Normalised balance: who is stronger here, and by how much of the total.
      const target = total > 1e-4 ? (p - r) / total : 0;
      // Faint pressure should not claim ground outright, so scale by presence.
      const presence = Math.min(1, total / 0.35);
      this.claim[i] += (target * presence - this.claim[i]) * rate;
    }
  }

  /**
   * Whose culture has actually taken a cell, ignoring soldiers entirely.
   *
   * This is the one that matters for everything that makes a place *work*:
   * buildings only evolve on integrated ground, production is only full there,
   * and supply runs from it alone. Ground you merely hold answers `null` here,
   * which is what gives the gilded cage its teeth.
   */
  integratedAtCell(cx: number, cy: number): number | null {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return null;
    const v = this.claim[cy * this.width + cx];
    if (Math.abs(v) < CLAIMED_THRESHOLD) return null;
    return v > 0 ? OWNER_PLAYER : OWNER_RIVAL;
  }

  integratedAt(wx: number, wy: number): number | null {
    return this.integratedAtCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  /**
   * Which owner controls a cell for map purposes: soldiers first, then culture.
   *
   * Military wins the tie because it is the only thing that can take ground
   * somebody else is defending. It is also the only claim that disappears the
   * same tick its source does.
   */
  ownerAtCell(cx: number, cy: number): number | null {
    const holder = this.military?.holderAtCell(cx, cy) ?? null;
    if (holder !== null) return holder;
    return this.integratedAtCell(cx, cy);
  }

  ownerAt(wx: number, wy: number): number | null {
    return this.ownerAtCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  /** The full story for a cell: open, contested, merely held, or genuinely theirs. */
  standingAtCell(cx: number, cy: number): { owner: number | null; standing: Standing } {
    if (this.military?.contestedAtCell(cx, cy)) {
      return { owner: null, standing: 'contested' };
    }

    const integrated = this.integratedAtCell(cx, cy);
    const holder = this.military?.holderAtCell(cx, cy) ?? null;

    if (integrated !== null && (holder === null || holder === integrated)) {
      return { owner: integrated, standing: 'integrated' };
    }
    if (holder !== null) return { owner: holder, standing: 'held' };
    if (integrated !== null) return { owner: integrated, standing: 'integrated' };
    return { owner: null, standing: 'open' };
  }

  standingAt(wx: number, wy: number): { owner: number | null; standing: Standing } {
    return this.standingAtCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  stats(buildings?: readonly Building[], field?: CharacterField): TerritoryStats {
    const cells = new Array(OWNER_COUNT).fill(0);
    const held = new Array(OWNER_COUNT).fill(0);
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
        const { owner, standing } = this.standingAtCell(cx, cy);
        if (owner === null) continue;
        cells[owner]++;
        if (standing === 'held') held[owner]++;

        // A frontier cell is one whose neighbour belongs to somebody else.
        const right = this.ownerAtCell(cx + 1, cy);
        const down = this.ownerAtCell(cx, cy + 1);
        if ((right !== null && right !== owner) || (down !== null && down !== owner)) {
          frontier++;
        }
      }
    }

    return { cells, held, frontier, coherence, output };
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
    type.family === 'civic'
      ? 1.0
      : type.family === 'military'
        ? 0.7
        : type.family === 'economic'
          ? 0.62
          : 0.34;

  // Landmarks carry further; a church is visible from the next parish, and so
  // is a keep. Note what this means: a garrison town is a real culture, not an
  // absence of one — it simply radiates *martial*, and a coherent martial
  // quarter converts ground exactly as a coherent devout one does.
  const landmark =
    type.id === 'church' || type.id === 'market' || type.id === 'keep' ? 1.7 : 1;

  // Standing a long while counts for something.
  const age = Math.min(1.35, 1 + b.age / 4000);

  return base * landmark * clarity * age;
}
