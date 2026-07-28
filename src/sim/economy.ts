import { buildingType } from './buildings';
import { harvestable, type Land } from './land';
import type { Labour } from './labour';
import { garrisonUpkeep, WARBAND_UPKEEP } from './military';
import type { Terrain } from './terrain';
import { OWNER_PLAYER, RESOURCE_KINDS, type Building, type Resource } from './types';
import type { Supply } from './supply';
import type { SeasonEffects } from './calendar';
import type { Standing } from './territory';

/**
 * What the town produces and what it keeps (design/00, Axis 3).
 *
 * No transport, no ratios, no sliders. What makes it a *game* rather than
 * bookkeeping is that production is **spatial**, and it is spatial in two
 * different ways now:
 *
 * - A **harvesting** works yields what the ground around it holds. A sawmill
 *   yields its wood, a quarry its slope, a farm its flat ground.
 * - A **converting** works yields what its *neighbours* can feed it
 *   (`supply.ts`). A foundry with no mine in reach smelts nothing, however much
 *   ore is in the barn.
 *
 * So the only lever is where you put things, which is exactly the kind of
 * decision `00` argues for and exactly the kind it argues against having to
 * compute. Every yield is one product:
 *
 * > **ground × standing × staffing × feed**
 *
 * Self-throttling falls out of both halves. Two mills in one wood share it; two
 * foundries on one mine halve each other; and what a foundry draws off a mill
 * never reaches the barn. A second of anything is wasteful without being
 * broken, and nobody works out a correct ratio — you look at the map.
 */

export type { Resource };

/**
 * The town's stores.
 *
 * Four raw and two made. **Ore** sits in a few scarce seams, which is what makes
 * the metal chain the one you can be denied: a foundry with no seam in reach
 * cannot smelt, so a frontier seam is worth a war. **Iron** is what fortification
 * is built from and **tools** are what the landmarks are — a church, a market
 * cross, a guildhall and a keep all want them — so the two made goods are the
 * join between the resource game, the territory game and the era arc.
 */
export type Stocks = Record<Resource, number>;

/** What it costs to put a building up. */
export type Cost = Partial<Stocks>;

/** How far a producer reaches for its raw material, in metres. */
export const CATCHMENT = 120;

/**
 * Which land field a harvesting works draws on.
 *
 * The scale factors that used to live here are on the catalogue entries now,
 * beside the thing they scale — a works says what ground it takes and what comes
 * out of it, and the economy no longer needs a switch statement naming every
 * building in the game.
 */
const HARVEST_FIELD = {
  timber: 'timber',
  stone: 'stone',
  arable: 'arable',
  ore: 'ore',
} as const;

/**
 * One person eats this much per tick.
 *
 * Tuned so a full town's winter is genuinely lean rather than a formality: at
 * this rate a hundred and twenty people eat more over a winter than the frozen
 * fields produce, so the year only works if autumn's surplus was stored. The
 * first value was low enough that food piled up to thousands and stopped being
 * a constraint at all, which quietly removed the only thing gating growth.
 */
const FOOD_PER_HEAD = 0.024;

/**
 * What a producer yields on ground that is merely *held* — inside your military
 * contour but not culturally yours (design/01 §3).
 *
 * This is the unrest penalty, and it is the whole reason conquest is not free.
 * A seized province works at a third until you make it somewhere people want to
 * be, so a wide empire taken quickly is a wide empire that produces almost
 * nothing and bleeds garrison upkeep the entire time.
 */
const HELD_YIELD = 0.34;

export interface Standings {
  /** Where a building stands, in territorial terms. */
  standingAt(wx: number, wy: number): { owner: number | null; standing: Standing };
}

export class Economy {
  readonly stocks: Stocks = {
    timber: 120, stone: 80, food: 100, ore: 0, iron: 0, tools: 0,
  };
  /** Net change per tick, kept for the readout so the trend is visible. */
  readonly rates: Stocks = {
    timber: 0, stone: 0, food: 0, ore: 0, iron: 0, tools: 0,
  };

  /** What the army is costing, kept separate so the bill is legible. */
  upkeep = 0;

  /** Share of the town's jobs that are actually filled, 0..1. */
  staffed = 1;

  /** True when food ran out — growth stops until it doesn't. */
  hungry = false;

  update(
    buildings: readonly Building[],
    land: Land,
    terrain: Terrain,
    season: SeasonEffects = { harvest: 1, labour: 1, appetite: 1 },
    warbands = 0,
    territory: Standings | null = null,
    workforce: Labour | null = null,
    population: number | null = null,
    supply: Supply | null = null,
  ): void {
    const made: Stocks = { timber: 0, stone: 0, food: 0, ore: 0, iron: 0, tools: 0 };
    let households = 0;

    for (const b of buildings) {
      if (b.owner !== OWNER_PLAYER) continue;
      const type = buildingType(b.typeId);

      if (type.family === 'residential') households++;
      if (!type.produces) continue;

      const out = this.outputOf(b, land, terrain, territory, workforce, supply);
      // What the neighbours drew off never reaches the barn. That is the other
      // half of self-throttling: feed every sawmill you have into foundries and
      // your timber stops accumulating, and you can see exactly where it went.
      const kept = Math.max(0, out - (supply ? supply.takenFrom(b) : 0));
      made[type.produces.resource] += kept;
    }

    // Winter is the pressure: it takes more than it gives, every year, whatever
    // the player does (design/00, Axis 7).
    for (const r of RESOURCE_KINDS) {
      if (r !== 'food') made[r] *= season.labour;
    }
    made.food *= season.harvest;
    // **People eat, not buildings.** Counting houses meant an empty town ate as
    // much as a full one, which quietly broke the whole growth loop: building
    // housing cost you food whether or not anybody moved in.
    const mouths = population ?? households;
    const eaten = mouths * FOOD_PER_HEAD * season.appetite;

    this.staffed = workforce
      ? workforce.report.jobs > 0
        ? workforce.report.filled / workforce.report.jobs
        : 1
      : 1;

    // The standing army. Continuous, never repaid, and unaffected by the
    // season — the one bill that does not care whether the harvest came in.
    this.upkeep =
      (garrisonUpkeep(buildings, OWNER_PLAYER) + warbands * WARBAND_UPKEEP) *
      season.appetite;

    for (const r of RESOURCE_KINDS) this.rates[r] = made[r];
    this.rates.food = made.food - eaten - this.upkeep;

    for (const r of RESOURCE_KINDS) {
      this.stocks[r] = Math.min(9999, this.stocks[r] + this.rates[r]);
    }

    // Running out stops the town growing, but never destroys anything: `00`
    // wants pressure that you adapt to, not punishment for bad arithmetic.
    if (this.stocks.food < 0) {
      this.stocks.food = 0;
      this.hungry = true;
    } else {
      this.hungry = false;
    }
  }

  /**
   * What one works puts out this tick, before its neighbours take their share.
   *
   * Every multiplier a yield has, in one place: the ground under it, whether the
   * ground is really yours, whether anybody works there, and — for a works that
   * combines inputs — whether those inputs can reach it. A harvesting works is
   * scaled by its catchment; a converting one by its feed; the watermill by the
   * river, which is the payoff for the hydrology (design/07 §4).
   */
  outputOf(
    b: Building,
    land: Land,
    terrain: Terrain,
    territory: Standings | null = null,
    workforce: Labour | null = null,
    supply: Supply | null = null,
  ): number {
    const type = buildingType(b.typeId);
    if (!type.produces) return 0;

    // Sullen ground works badly. Nothing is destroyed and nothing is
    // forbidden — it simply does not pay, which is a thing you can see on
    // the map rather than a rule you have to be told.
    const here = territory?.standingAt(b.pos.x, b.pos.y);
    const held = here?.standing === 'held' ? HELD_YIELD : 1;

    // **Staffing is the second half of every yield.** A works produces what
    // its land holds *times how well it is manned*, so a sawmill in the
    // deepest wood on the map is worth nothing if nobody can walk to it. That
    // is the trade that makes siting a decision rather than a formality.
    let out = held * (workforce ? workforce.staffingOf(b) : 1) * type.produces.rate;

    if (type.harvests) {
      out *= harvestable(land[HARVEST_FIELD[type.harvests]], b.pos, CATCHMENT);
    }
    if (type.id === 'watermill') {
      out *= Math.min(2.4, terrain.millPotentialAt(b.pos.x, b.pos.y));
    }
    if (type.consumes && supply) out *= supply.feedOf(b);

    return out;
  }

  canAfford(cost: Cost): boolean {
    for (const r of RESOURCE_KINDS) {
      if (this.stocks[r] < (cost[r] ?? 0)) return false;
    }
    return true;
  }

  /** What a cost is short of, for the build UI. Empty when affordable. */
  shortfall(cost: Cost): Resource[] {
    return RESOURCE_KINDS.filter((r) => this.stocks[r] < (cost[r] ?? 0));
  }

  spend(cost: Cost): void {
    for (const r of RESOURCE_KINDS) this.stocks[r] -= cost[r] ?? 0;
  }
}

/** Roads are paved, so they cost stone by the metre. */
export function roadCost(lengthMetres: number, cls: string): Cost {
  const perMetre = cls === 'high' ? 0.5 : cls === 'street' ? 0.32 : 0.16;
  return { stone: Math.round(lengthMetres * perMetre) };
}
