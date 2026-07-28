import { buildingType } from './buildings';
import type { SeasonEffects } from './calendar';
import { OWNER_PLAYER, type Building } from './types';

/**
 * How many people actually live here — and the loop that was missing.
 *
 * Population used to *be* housing capacity: put up a cottage and three workers
 * existed. Nothing ever arrived, nothing ever left, and nothing in the game ever
 * asked the player for anything. That is the difference between a builder and a
 * sandbox, and it is why this could be played for an hour without ever feeling
 * like it wanted something.
 *
 * > **People come when there is room and food, and they leave when there is not.
 * > Housing is a ceiling, not a population.**
 *
 * That single change closes the loop every city builder runs on:
 *
 * ```
 *   build housing  →  people arrive  →  they fill jobs  →  works produce
 *        ↑                                                       ↓
 *        └──────────────  which pays for more housing  ←─────────┘
 * ```
 *
 * and it puts a real question at the centre of the game — *can I feed the next
 * hundred people?* — which is a question about where you put farms, which is a
 * question about the land. Every system already built now points at that.
 *
 * ### Why arrivals are gated on food rather than on happiness
 *
 * A happiness stat would be exactly the kind of opaque meter `00` exists to
 * avoid: you would tune it without understanding it. Food is legible, spatial
 * and already on screen — a surplus is a number you can see rising and a place
 * on the map you can point at. If a town stops growing, the reason is always
 * somewhere you can walk to.
 */

/** Share of the empty houses that fill per tick when things are going well. */
const ARRIVE_RATE = 0.012;

/** Share of the population that leaves per tick while there is no food. */
const DEPART_RATE = 0.006;

/**
 * Food in the barn per person before the town is confident enough to grow, and
 * the floor a brand-new settlement needs before anybody will come at all.
 *
 * Gating arrivals on a positive food *rate* was a deadlock and a real bug, not a
 * tuning problem: population starts at zero, so nothing is staffed, so the farm
 * produces nothing, so there is no surplus, so nobody arrives — a new town could
 * never be founded. Gating on the **stock** instead fixes it and is a better
 * rule: you start with food in the barn, people arrive and eat it, and you have
 * to get production going before it runs out. That is the opening tension the
 * game was missing.
 */
const FOOD_PER_HEAD = 0.55;

/** What must be in store before the first family will settle at all. */
const FOUNDING_STORE = 20;

export interface PopulaceReport {
  /** People living here. */
  population: number;
  /** Beds available. */
  capacity: number;
  /** Net change per tick, for the readout: a trend matters more than a level. */
  change: number;
  /** Why the town is not growing, when it is not. */
  blocked: 'room' | 'food' | 'leaving' | 'unserved' | null;
}

export class Populace {
  readonly report: PopulaceReport = {
    population: 0,
    capacity: 0,
    change: 0,
    blocked: null,
  };

  private exact = 0;

  update(
    buildings: readonly Building[],
    food: number,
    hungry: boolean,
    season: SeasonEffects,
    coverage = 1,
  ): void {
    let capacity = 0;
    for (const b of buildings) {
      if (b.owner !== OWNER_PLAYER) continue;
      capacity += buildingType(b.typeId).houses ?? 0;
    }

    const before = this.exact;
    const room = capacity - this.exact;

    if (hungry) {
      // Nobody stays where there is nothing to eat. They do not die, they go.
      this.exact -= this.exact * DEPART_RATE;
      this.report.blocked = 'leaving';
    } else if (room <= 0.5) {
      this.report.blocked = 'room';
    } else if (food < Math.max(FOUNDING_STORE, this.exact * FOOD_PER_HEAD)) {
      // A town with an empty barn does not attract anybody. Note this is the
      // *stock*, not the rate — see above. A town living off its stores still
      // grows, right up until the stores run out, which is exactly the rope a
      // new settlement should be given and exactly the rope it can hang itself
      // with.
      this.report.blocked = 'food';
    } else {
      // Winter is not a time to move house — and neither is anywhere that
      // cannot reach a well. Service scales arrivals rather than gating them,
      // so a badly served town grows *slowly* instead of stopping dead, which
      // is both truer and much easier to diagnose.
      this.exact += room * ARRIVE_RATE * season.harvest * Math.max(0.05, coverage);
      this.report.blocked = coverage < 0.6 ? 'unserved' : null;
    }

    this.exact = Math.max(0, Math.min(capacity, this.exact));

    this.report.population = Math.round(this.exact);
    this.report.capacity = capacity;
    this.report.change = this.exact - before;
  }

  /**
   * How full the town is, 0..1.
   *
   * Labour scales every home's workforce by this, so a half-populated town
   * staffs its works at half rate everywhere rather than filling some
   * completely and starving others — which is both fairer and much easier to
   * reason about when you are looking at the map wondering why nothing works.
   */
  get occupancy(): number {
    return this.report.capacity > 0 ? this.exact / this.report.capacity : 0;
  }

  /** Seeded population, for scenarios that drop a whole town in at once. */
  settle(n: number): void {
    this.exact = Math.max(this.exact, n);
  }
}
