import { buildingType } from './buildings';
import { harvestable, type Land } from './land';
import { garrisonUpkeep, WARBAND_UPKEEP } from './military';
import type { Terrain } from './terrain';
import { OWNER_PLAYER, type Building } from './types';
import type { SeasonEffects } from './calendar';
import type { Standing } from './territory';

/**
 * A deliberately light resource layer (design/00, Axis 3).
 *
 * Three stocks, no transport, no ratios, no sliders. What makes it a *game*
 * rather than bookkeeping is that production is **spatial**: a sawmill yields
 * what the wood around it holds, a quarry what the slope around it holds, a farm
 * what the flat ground around it holds. So the only lever is *where you put
 * things*, which is exactly the kind of decision `00` argues for and exactly the
 * kind it argues against having to compute.
 *
 * Self-throttling falls out of catchment: two mills in one wood share it, so a
 * second is wasteful without being broken, and nobody has to work out the
 * correct number of mills. You can see the wood, and you can see the idle mill.
 */

export type Resource = 'timber' | 'stone' | 'food';

export interface Stocks {
  timber: number;
  stone: number;
  food: number;
}

/** What it costs to put a building up. */
export type Cost = Partial<Stocks>;

/** How far a producer reaches for its raw material, in metres. */
const CATCHMENT = 120;

/** Scale factors turning raw potential into a sane rate per tick. */
const TIMBER_RATE = 0.0022;
const STONE_RATE = 0.0026;
const FOOD_RATE = 0.0062;

/** A household eats this much per tick. */
const FOOD_PER_HOUSEHOLD = 0.042;

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
  readonly stocks: Stocks = { timber: 120, stone: 80, food: 100 };
  /** Net change per tick, kept for the readout so the trend is visible. */
  readonly rates: Stocks = { timber: 0, stone: 0, food: 0 };

  /** What the army is costing, kept separate so the bill is legible. */
  upkeep = 0;

  /** True when food ran out — growth stops until it doesn't. */
  hungry = false;

  update(
    buildings: readonly Building[],
    land: Land,
    terrain: Terrain,
    season: SeasonEffects = { harvest: 1, labour: 1, appetite: 1 },
    warbands = 0,
    territory: Standings | null = null,
  ): void {
    let timber = 0;
    let stone = 0;
    let food = 0;
    let households = 0;

    for (const b of buildings) {
      if (b.owner !== OWNER_PLAYER) continue;
      const type = buildingType(b.typeId);

      if (type.family === 'residential') households++;

      // Sullen ground works badly. Nothing is destroyed and nothing is
      // forbidden — it simply does not pay, which is a thing you can see on
      // the map rather than a rule you have to be told.
      const here = territory?.standingAt(b.pos.x, b.pos.y);
      const yield_ = here?.standing === 'held' ? HELD_YIELD : 1;

      switch (type.id) {
        case 'sawmill':
          timber += harvestable(land.timber, b.pos, CATCHMENT) * TIMBER_RATE * yield_;
          break;
        case 'quarry':
          stone += harvestable(land.stone, b.pos, CATCHMENT) * STONE_RATE * yield_;
          break;
        case 'farm':
          food += harvestable(land.arable, b.pos, CATCHMENT) * FOOD_RATE * yield_;
          break;
        case 'watermill':
          // A mill grinds what the river gives it, which is the payoff for the
          // hydrology: flow and fall are a real siting constraint (design/07 §4).
          food +=
            Math.min(2.4, terrain.millPotentialAt(b.pos.x, b.pos.y)) * 0.09 * yield_;
          break;
      }
    }

    // Winter is the pressure: it takes more than it gives, every year, whatever
    // the player does (design/00, Axis 7).
    timber *= season.labour;
    stone *= season.labour;
    food *= season.harvest;
    const eaten = households * FOOD_PER_HOUSEHOLD * season.appetite;

    // The standing army. Continuous, never repaid, and unaffected by the
    // season — the one bill that does not care whether the harvest came in.
    this.upkeep =
      (garrisonUpkeep(buildings, OWNER_PLAYER) + warbands * WARBAND_UPKEEP) *
      season.appetite;

    this.rates.timber = timber;
    this.rates.stone = stone;
    this.rates.food = food - eaten - this.upkeep;

    this.stocks.timber = Math.min(9999, this.stocks.timber + timber);
    this.stocks.stone = Math.min(9999, this.stocks.stone + stone);
    this.stocks.food = Math.min(9999, this.stocks.food + this.rates.food);

    // Running out stops the town growing, but never destroys anything: `00`
    // wants pressure that you adapt to, not punishment for bad arithmetic.
    if (this.stocks.food < 0) {
      this.stocks.food = 0;
      this.hungry = true;
    } else {
      this.hungry = false;
    }
  }

  canAfford(cost: Cost): boolean {
    return (
      this.stocks.timber >= (cost.timber ?? 0) &&
      this.stocks.stone >= (cost.stone ?? 0) &&
      this.stocks.food >= (cost.food ?? 0)
    );
  }

  spend(cost: Cost): void {
    this.stocks.timber -= cost.timber ?? 0;
    this.stocks.stone -= cost.stone ?? 0;
    this.stocks.food -= cost.food ?? 0;
  }
}

/** Roads are paved, so they cost stone by the metre. */
export function roadCost(lengthMetres: number, cls: string): Cost {
  const perMetre = cls === 'high' ? 0.5 : cls === 'street' ? 0.32 : 0.16;
  return { stone: Math.round(lengthMetres * perMetre) };
}
