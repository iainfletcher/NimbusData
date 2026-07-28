import { buildingType } from './buildings';
import type { Need } from './needs';
import { OWNER_PLAYER, type Building } from './types';

/**
 * How a town grows up (design/03 §6 — the era arc).
 *
 * The catalogue used to be open from the first second: every building in the
 * game available before a single person lived there. That is a level editor,
 * not a game — there is no arc, nothing is ever *earned*, and the twenty-fifth
 * building is no more interesting than the first.
 *
 * The obvious fix is a tech tree with research points, and it is the wrong one
 * here. Points to spend is a currency, a screen and a set of ratios — precisely
 * the "admin with no expression" that `00` exists to refuse. So:
 *
 * > **Progress is something your town achieves, not a currency you spend.**
 *
 * An age advances when the town is *demonstrably* that kind of place: enough
 * people, the right buildings actually standing, the needs of the last age
 * actually met. There is nothing to allocate and nothing to optimise. You play
 * well and the town grows up, which is the same relationship the territory
 * pillar has with culture.
 *
 * ### The bit that makes it more than an unlock list
 *
 * Each age also **demands more of housing** (`needs.ts`). A hamlet wants water.
 * A village wants water and a church. A market town wants a market and an
 * alehouse too. So advancing is not a pure reward — it raises the standard, and
 * a town that grows faster than it can serve itself will stall on its own
 * success. That tension is the whole reason to have ages at all.
 */

export interface Age {
  id: string;
  name: string;
  /** Told to the player as the goal, in plain words. */
  blurb: string;
  /** What housing demands while the town is in this age. */
  demands: Need[];
  /** Building types available from this age onward. */
  unlocks: string[];
  /** What the town must show before it advances out of this age. */
  requires: {
    population?: number;
    /** Building type → how many must be standing. */
    buildings?: Record<string, number>;
    /** Every demanded need met for at least this share of housing. */
    coverage?: number;
  };
}

export const AGES: Age[] = [
  {
    id: 'hamlet',
    name: 'Hamlet',
    blurb: 'A few families, a field and somewhere to draw water.',
    demands: ['water'],
    unlocks: [
      'cottage', 'farm', 'well', 'sawmill', 'quarry', 'workshop',
      'watermill', 'green', 'orchard',
    ],
    requires: {
      population: 40,
      buildings: { farm: 1 },
      coverage: 0.8,
    },
  },
  {
    id: 'village',
    name: 'Village',
    blurb: 'A church, and enough people to fill it.',
    demands: ['water', 'faith'],
    unlocks: ['chapel', 'almshouse', 'alehouse', 'tannery', 'warehouse', 'watchtower'],
    requires: {
      population: 110,
      buildings: { chapel: 1 },
      coverage: 0.75,
    },
  },
  {
    id: 'market',
    name: 'Market Town',
    blurb: 'A market cross, an alehouse, and trade worth defending.',
    demands: ['water', 'faith', 'market', 'ale'],
    unlocks: ['market', 'tavern', 'church', 'guildhall', 'merchant_house', 'mine'],
    requires: {
      population: 240,
      buildings: { market: 1, tavern: 1 },
      coverage: 0.7,
    },
  },
  {
    id: 'borough',
    name: 'Borough',
    blurb: 'Walls, a foundry, and a name that carries.',
    demands: ['water', 'faith', 'market', 'ale'],
    unlocks: ['foundry', 'keep'],
    requires: {},
  },
];

/** What is missing before the town can advance. Empty means it is ready. */
export interface AgeProgress {
  age: Age;
  index: number;
  /** Human-readable outstanding requirements, in the order they should be shown. */
  outstanding: string[];
  /** 0..1 across all requirements, for a bar. */
  progress: number;
  /** True when this is the last age. */
  final: boolean;
}

export class Ages {
  index = 0;

  get current(): Age {
    return AGES[this.index];
  }

  get demands(): Need[] {
    return this.current.demands;
  }

  /** What the town is growing toward, or null at the last age. */
  get next(): Age | null {
    return AGES[this.index + 1] ?? null;
  }

  /** Every type available now, accumulated across the ages reached so far. */
  unlocked(): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i <= this.index; i++) {
      for (const id of AGES[i].unlocks) out.add(id);
    }
    // Evolved housing is grown, never placed, so it is always "available" to the
    // simulation even though it never appears in the palette.
    for (const id of EVOLVED) out.add(id);
    return out;
  }

  /**
   * Check the requirements and report what is left.
   *
   * Deliberately phrased as sentences rather than as a checklist of keys: the
   * player should be able to read the goal and know what to build without
   * decoding anything.
   */
  progress(
    buildings: readonly Building[],
    population: number,
    coverage: number,
  ): AgeProgress {
    const age = this.current;
    const need = age.requires;
    const outstanding: string[] = [];
    let met = 0;
    let total = 0;

    if (need.population !== undefined) {
      total++;
      if (population >= need.population) met++;
      else outstanding.push(`${population} of ${need.population} people`);
    }

    for (const [typeId, count] of Object.entries(need.buildings ?? {})) {
      total++;
      const have = buildings.filter(
        (b) => b.owner === OWNER_PLAYER && b.typeId === typeId,
      ).length;
      if (have >= count) met++;
      else {
        const name = buildingType(typeId).name;
        outstanding.push(count === 1 ? `a ${name.toLowerCase()}` : `${have}/${count} ${name}`);
      }
    }

    if (need.coverage !== undefined) {
      total++;
      if (coverage >= need.coverage) met++;
      else {
        outstanding.push(
          `${Math.round(coverage * 100)}% of homes served (need ${Math.round(need.coverage * 100)}%)`,
        );
      }
    }

    return {
      age,
      index: this.index,
      outstanding,
      progress: total === 0 ? 1 : met / total,
      final: this.index >= AGES.length - 1,
    };
  }

  /** Advance if the requirements are met. Returns the new age, or null. */
  advance(
    buildings: readonly Building[],
    population: number,
    coverage: number,
  ): Age | null {
    const state = this.progress(buildings, population, coverage);
    if (state.final || state.outstanding.length > 0) return null;
    this.index++;
    return this.current;
  }
}

/**
 * Which age brings this building type in, if any.
 *
 * The palette uses this to say *when*, not merely *no*. A locked button that
 * reads "Borough" is a plan; one that reads "unavailable" is a wall.
 */
export function ageThatUnlocks(typeId: string): Age | null {
  for (const age of AGES) {
    if (age.unlocks.includes(typeId)) return age;
  }
  return null;
}

/** Housing that is grown rather than placed, so ages never gate it. */
const EVOLVED = [
  'terrace', 'merchant_house', 'close_cottage', 'farmhouse',
  'lodging_house', 'garden_cottage', 'barrack_row',
];
