/**
 * Time (design/00, Axis 6 and Axis 7).
 *
 * Real-time with pause, and seasons kept as **cycle and flavour rather than a
 * gate** — the world never stops to collect decisions. What the calendar is
 * really for is Axis 7: pressure that arrives from outside and from time,
 * never from the player's own bookkeeping.
 *
 * Winter is the whole point. It takes more food than it gives and slows
 * building, every year, whatever you do — so a town has to carry a surplus
 * through it. That is a thing you adapt to rather than a punishment for getting
 * a sum wrong, which is the distinction `00` insists on.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Ticks per season. Four of these make a year. */
export const TICKS_PER_SEASON = 85;

export interface SeasonEffects {
  /** Multiplier on food produced. */
  harvest: number;
  /** Multiplier on timber and stone won. */
  labour: number;
  /** Multiplier on what the town eats. */
  appetite: number;
}

const EFFECTS: Record<Season, SeasonEffects> = {
  // Sowing: plenty of work, nothing to reap yet.
  spring: { harvest: 0.5, labour: 1.1, appetite: 1 },
  // Long days, everything at once.
  summer: { harvest: 1.15, labour: 1.2, appetite: 1 },
  // The harvest, and the reason a town survives the winter.
  autumn: { harvest: 2.1, labour: 1, appetite: 1 },
  // Nothing grows, less gets done, and everyone is hungrier.
  winter: { harvest: 0.1, labour: 0.55, appetite: 1.25 },
};

export class Calendar {
  ticks = 0;

  get season(): Season {
    return SEASONS[Math.floor(this.ticks / TICKS_PER_SEASON) % SEASONS.length];
  }

  /** Years since founding, starting at 1. */
  get year(): number {
    return 1 + Math.floor(this.ticks / (TICKS_PER_SEASON * SEASONS.length));
  }

  /** How far through the current season, 0..1. */
  get progress(): number {
    return (this.ticks % TICKS_PER_SEASON) / TICKS_PER_SEASON;
  }

  get effects(): SeasonEffects {
    return EFFECTS[this.season];
  }

  advance(): boolean {
    const before = this.season;
    this.ticks++;
    return this.season !== before;
  }
}
