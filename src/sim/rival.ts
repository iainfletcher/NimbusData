import { allBuildingTypes, buildingType } from './buildings';
import type { CharacterField } from './field';
import { makeRng } from './rng';
import { OWNER_PLAYER, OWNER_RIVAL, type Territory } from './territory';
import type { Building, Character, Vec2 } from './types';

/**
 * A rival that actually grows.
 *
 * Until now the rival was a fixed jumble: it could lose ground but never take
 * any, so neglecting your own town cost nothing. That is the difference between
 * a diorama and a game — **there has to be something that takes the ground back
 * if you stop paying attention.**
 *
 * It plays by the same rules the design asks of the player, which is what makes
 * it a fair opponent rather than a difficulty knob:
 *
 * - It builds **toward the frontier**, so pressure comes from a direction and
 *   you can see it coming.
 * - It reinforces whatever character a place already has, so its quarters get
 *   *more* coherent over time and its culture grows stronger for the same
 *   reason yours does (design/04).
 * - It builds no faster when it is losing. There is no rubber band; if you out-
 *   build it you stay ahead, and that is meant to be the reward.
 */

/** Ticks between the rival adding a building. */
const BUILD_INTERVAL = 20;

/** How far from an existing building it will settle. */
const SPREAD = 46;

export class Rival {
  private cooldown = BUILD_INTERVAL;
  private rng: () => number;

  /** Buildings it has put up since the start, for the readout. */
  built = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed ^ 0x71a1);
  }

  /**
   * Occasionally add a building. Returns the placement request, or null — the
   * world owns placement, so the rival only ever proposes.
   */
  propose(
    buildings: readonly Building[],
    field: CharacterField,
    territory: Territory,
  ): { typeId: string; pos: Vec2 }[] {
    if (this.cooldown-- > 0) return [];
    this.cooldown = BUILD_INTERVAL;

    const own = buildings.filter((b) => b.owner === OWNER_RIVAL);
    if (own.length === 0) return [];

    const anchor = this.pickAnchor(own, territory);
    if (!anchor) return [];

    // Reinforce what is already there. A quarter that knows what it is projects
    // further, so the rival gets stronger by getting *clearer*, not just bigger.
    const reading = field.read(anchor.pos.x, anchor.pos.y);
    const typeId = this.pickType(reading.dominant);

    // Push toward the frontier rather than sprawling evenly.
    const toward = this.frontierDirection(anchor.pos, territory);
    const angle =
      Math.atan2(toward.y, toward.x) + (this.rng() - 0.5) * Math.PI * 0.9;
    const distance = 18 + this.rng() * SPREAD;

    // Several candidates rather than one: most spots are taken, in water or too
    // steep, and a rival that gives up on the first refusal barely grows at all.
    const options: { typeId: string; pos: Vec2 }[] = [];
    for (let i = 0; i < 8; i++) {
      const a = angle + (this.rng() - 0.5) * Math.PI * 0.8;
      const d = distance + i * 6;
      options.push({
        typeId,
        pos: { x: anchor.pos.x + Math.cos(a) * d, y: anchor.pos.y + Math.sin(a) * d },
      });
    }
    return options;
  }

  /** Prefer to extend from a building near contested ground. */
  private pickAnchor(own: readonly Building[], territory: Territory): Building | null {
    let best: Building | null = null;
    let bestScore = -Infinity;

    for (const b of own) {
      // A little noise so it does not always pick the same corner.
      const score = -Math.abs(territory.ownerAt(b.pos.x, b.pos.y) === OWNER_RIVAL ? 1 : 0)
        + this.rng() * 0.8
        + this.frontierPull(b.pos, territory);
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }

    return best;
  }

  /** Higher near ground the player holds. */
  private frontierPull(at: Vec2, territory: Territory): number {
    const dir = this.frontierDirection(at, territory);
    return Math.hypot(dir.x, dir.y) > 0 ? 1 : 0;
  }

  /**
   * Which way the player's ground lies, sampled on a ring. Returns a zero
   * vector when there is nothing nearby, in which case the rival simply sprawls.
   */
  private frontierDirection(at: Vec2, territory: Territory): Vec2 {
    let x = 0;
    let y = 0;

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const r of [120, 240, 360]) {
        const px = at.x + Math.cos(a) * r;
        const py = at.y + Math.sin(a) * r;
        if (territory.ownerAt(px, py) === OWNER_PLAYER) {
          x += Math.cos(a) / r;
          y += Math.sin(a) / r;
        }
      }
    }

    const len = Math.hypot(x, y);
    if (len < 1e-6) {
      const a = this.rng() * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a) };
    }
    return { x: x / len, y: y / len };
  }

  /** A building type that emits the character already dominant here. */
  private pickType(dominant: Character | null): string {
    const candidates = allBuildingTypes().filter((t) => {
      if (t.isEvolved) return false;
      if (t.family === 'residential') return true;
      if (!dominant) return false;
      return t.emissions.some((e) => e.character === dominant && e.strength > 0.6);
    });

    // Housing carries a town, so weight toward it without excluding trade.
    const pool = candidates.length > 0 ? candidates : [buildingType('cottage')];
    if (this.rng() < 0.55) return 'cottage';
    return pool[Math.floor(this.rng() * pool.length)].id;
  }
}
