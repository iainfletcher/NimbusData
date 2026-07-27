import { allBuildingTypes, buildingType } from './buildings';
import type { CharacterField } from './field';
import type { Military } from './military';
import { makeRng } from './rng';
import type { Territory } from './territory';
import { OWNER_PLAYER, OWNER_RIVAL, type Building, type Character, type Vec2 } from './types';

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
 *
 * It plays the military half on the same terms (`01` §2). It fortifies where it
 * is being pressed, and once it has a keep it musters columns and sends them at
 * whatever of yours is nearest. That is what stops the pillar from only working
 * in one direction: culture flows both ways, and so do soldiers.
 */

/** Ticks between the rival adding a building. */
const BUILD_INTERVAL = 20;

/** How far from an existing building it will settle. */
const SPREAD = 46;

/** Buildings it wants before it starts fortifying, and before it builds a keep. */
const TOWER_AT = 14;
const KEEP_AT = 26;

/** Ticks between musters, and how many columns it will keep in the field. */
const MUSTER_INTERVAL = 190;
const MAX_BANDS = 2;

/** Ticks between re-issuing marching orders. */
const ORDER_INTERVAL = 40;

export interface RivalOrders {
  /** Muster a warband, if it has a keep free. */
  muster: boolean;
  /** Warband id → where to send it. */
  marches: { id: number; to: Vec2 }[];
}

export class Rival {
  private cooldown = BUILD_INTERVAL;
  private musterCooldown = MUSTER_INTERVAL;
  private orderCooldown = ORDER_INTERVAL;
  private rng: () => number;

  /** Buildings it has put up since the start, for the readout. */
  built = 0;

  constructor(seed: number) {
    this.rng = makeRng(seed ^ 0x71a1);
  }

  /**
   * What the rival wants its soldiers to do this tick.
   *
   * Deliberately simple, and deliberately not adaptive: it musters on a fixed
   * clock and marches at whatever of yours is closest. A cleverer opponent would
   * be a worse test of the pillar, because then a border that moved would tell
   * you about the AI rather than about whether your town was good enough.
   */
  orders(military: Military, territory: Territory, buildings: readonly Building[]): RivalOrders {
    const out: RivalOrders = { muster: false, marches: [] };
    const own = buildings.filter((b) => b.owner === OWNER_RIVAL);
    const bands = military.bandsOf(OWNER_RIVAL);

    if (this.musterCooldown-- <= 0) {
      this.musterCooldown = MUSTER_INTERVAL;
      out.muster = bands.length < MAX_BANDS;
    }

    if (this.orderCooldown-- <= 0) {
      this.orderCooldown = ORDER_INTERVAL;
      for (const band of bands) {
        // A column already fighting is left alone; being told to walk away
        // mid-battle is how an army loses one column at a time.
        const target = this.nearestPlayerGround(band.pos, territory)
          ?? this.nearestPlayerBuilding(band.pos, buildings);
        if (target) out.marches.push({ id: band.id, to: target });
      }
    }

    void own;
    return out;
  }

  /** The closest ground the player has actually integrated, searched on rings. */
  private nearestPlayerGround(from: Vec2, territory: Territory): Vec2 | null {
    for (let r = 80; r <= 640; r += 80) {
      const steps = Math.max(8, Math.round(r / 14));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = from.x + Math.cos(a) * r;
        const y = from.y + Math.sin(a) * r;
        if (territory.integratedAt(x, y) === OWNER_PLAYER) return { x, y };
      }
    }
    return null;
  }

  private nearestPlayerBuilding(from: Vec2, buildings: readonly Building[]): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const b of buildings) {
      if (b.owner !== OWNER_PLAYER) continue;
      const d = Math.hypot(b.pos.x - from.x, b.pos.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = { x: b.pos.x, y: b.pos.y };
      }
    }
    return best;
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
    const typeId = this.pickFortification(own) ?? this.pickType(reading.dominant);

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

  /**
   * Whether this build should be a fortification instead of a town building.
   *
   * A settlement fortifies once it is worth defending, and it builds one keep
   * before it builds a second tower — a town with two keeps and no market is not
   * a town. Returns null to leave the choice to the character field.
   */
  private pickFortification(own: readonly Building[]): string | null {
    let towers = 0;
    let keeps = 0;
    for (const b of own) {
      const id = b.typeId;
      if (id === 'watchtower') towers++;
      else if (id === 'keep') keeps++;
    }

    if (own.length >= KEEP_AT && keeps === 0) return 'keep';
    if (own.length >= TOWER_AT && towers < 1 + Math.floor(own.length / 40)) {
      return this.rng() < 0.5 ? 'watchtower' : null;
    }
    return null;
  }

  /**
   * A building type that emits the character already dominant here.
   *
   * Fortifications are explicitly excluded, and finding out why was worth the
   * trial that caught it. A watchtower emits `martial` strongly, so the moment
   * one exists the dominant character around it is martial — and reinforcing
   * the dominant character then means *building more fortifications*, which
   * emit more martial, which is a settlement that becomes convinced it is a
   * fortress and never builds anything else. It out-garrisoned a besieging
   * column indefinitely, for free.
   *
   * **The rival fortifies on a policy, never on a vibe.** Walls come from
   * `pickFortification`, which is rationed; everything else comes from here.
   */
  private pickType(dominant: Character | null): string {
    const candidates = allBuildingTypes().filter((t) => {
      if (t.isEvolved || t.family === 'military') return false;
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
