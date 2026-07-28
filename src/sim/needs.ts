import { buildingType } from './buildings';
import type { Terrain } from './terrain';
import { OWNER_PLAYER, type Building } from './types';

/**
 * What a household needs, and whether it can reach it.
 *
 * Two things were wrong before this. Housing needed nothing but food, so the
 * only question a town ever asked was *is there enough to eat*; and the civic
 * buildings — church, market, tavern — **did nothing at all**. They emitted
 * character and were otherwise ornaments. Half the catalogue was decoration.
 *
 * The fix keeps the rule `00` insists on:
 *
 * > **A need is met if the thing that meets it is within walking distance. There
 * > is no meter, no ratio and no upkeep — only whether it is near enough.**
 *
 * So needs are *spatial*, exactly like jobs, and they are answered the same way:
 * by looking at the map. A quarter with no well is a quarter you can see has no
 * well. Nobody has to work out how many wells a hundred people require, because
 * the question is never "how many" — it is "is there one near this house".
 *
 * ### Why this is depth without admin
 *
 * Each need added is a *place* you must find room for near housing, competing
 * for the same ground as the works. That is the same currency the whole game is
 * played in — where things go — rather than a new panel. And because what a
 * house demands grows with the town's age (`ages.ts`), the town gets harder to
 * lay out as it grows, rather than merely bigger.
 */

export type Need = 'water' | 'faith' | 'market' | 'ale';

export const NEEDS: Need[] = ['water', 'faith', 'market', 'ale'];

export const NEED_LABELS: Record<Need, string> = {
  water: 'Water',
  faith: 'A church',
  market: 'A market',
  ale: 'An alehouse',
};

/** One word, for a build button that is already carrying a price. */
export const NEED_SHORT: Record<Need, string> = {
  water: 'water',
  faith: 'church',
  market: 'market',
  ale: 'ale',
};

/**
 * How far a household will go for each.
 *
 * Not one number, because they are not one kind of errand. Water is fetched
 * every day and by children, so it has to be close; a market is a weekly trip
 * and can be across town. Getting these different is most of what stops the
 * needs system feeling like four copies of the same rule.
 */
export const NEED_REACH: Record<Need, number> = {
  water: 85,
  faith: 165,
  market: 210,
  ale: 130,
};

/** Ticks between recomputations. Needs change when you build, not per tick. */
export const NEEDS_INTERVAL = 15;

export interface NeedsReport {
  /** Households short of each need. */
  short: Record<Need, number>;
  /** Houses counted. */
  houses: number;
  /** The worst-served need, for the readout. */
  worst: Need | null;
}

export class Needs {
  /** Service level per house, 0..1, keyed by building id. */
  private served = new Map<number, number>();
  /** Which needs each house is short of, for the map markers. */
  readonly missing = new Map<number, Need[]>();

  readonly report: NeedsReport = {
    short: { water: 0, faith: 0, market: 0, ale: 0 },
    houses: 0,
    worst: null,
  };

  /**
   * Work out what every house can reach.
   *
   * `demanded` comes from the town's age: a hamlet wants water and nothing
   * else, a market town wants all four. That is what makes growth a change in
   * *kind* rather than only in size.
   */
  update(
    buildings: readonly Building[],
    terrain: Terrain,
    demanded: readonly Need[],
    owner = OWNER_PLAYER,
  ): void {
    this.served.clear();
    this.missing.clear();
    for (const need of NEEDS) this.report.short[need] = 0;

    const houses: Building[] = [];
    const providers = new Map<Need, Building[]>();
    for (const need of NEEDS) providers.set(need, []);

    for (const b of buildings) {
      if (b.owner !== owner) continue;
      const type = buildingType(b.typeId);
      if (type.houses) houses.push(b);
      for (const need of type.serves ?? []) providers.get(need)!.push(b);
    }

    this.report.houses = houses.length;

    for (const house of houses) {
      const lacking: Need[] = [];

      for (const need of demanded) {
        if (this.reaches(house, need, providers.get(need)!, terrain)) continue;
        lacking.push(need);
        this.report.short[need]++;
      }

      if (lacking.length > 0) this.missing.set(house.id, lacking);
      this.served.set(
        house.id,
        demanded.length === 0 ? 1 : 1 - lacking.length / demanded.length,
      );
    }

    let worst: Need | null = null;
    let worstCount = 0;
    for (const need of demanded) {
      if (this.report.short[need] > worstCount) {
        worstCount = this.report.short[need];
        worst = need;
      }
    }
    this.report.worst = worst;
  }

  private reaches(
    house: Building,
    need: Need,
    providers: readonly Building[],
    terrain: Terrain,
  ): boolean {
    const reach = NEED_REACH[need];

    // Fresh water is a *place*, not a building. A house beside a stream has no
    // use for a well, which makes the river the game already simulates worth
    // building next to — the hydrology finally pays for itself in the economy
    // rather than only in the view.
    if (need === 'water' && terrain.freshWaterNear(house.pos, reach)) return true;

    for (const p of providers) {
      if (Math.hypot(p.pos.x - house.pos.x, p.pos.y - house.pos.y) <= reach) return true;
    }
    return false;
  }

  /** How well a house is served, 0..1. Unknown houses count as unserved. */
  servedOf(b: Building): number {
    return this.served.get(b.id) ?? 0;
  }

  /** Mean service across the town — what gates arrivals. */
  get coverage(): number {
    if (this.served.size === 0) return 1;
    let total = 0;
    for (const v of this.served.values()) total += v;
    return total / this.served.size;
  }
}
