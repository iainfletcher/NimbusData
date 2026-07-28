/** Core simulation types. No rendering concerns live here. */

export interface Vec2 {
  x: number;
  y: number;
}

/** World is measured in metres. */
export const CELL_SIZE = 4;
export const WORLD_CELLS = 256;
export const WORLD_SIZE = CELL_SIZE * WORLD_CELLS;

/**
 * Which settlement something belongs to. These live here rather than in
 * `territory.ts` because military, culture and buildings all need them and none
 * of those should have to depend on the others to say whose thing this is.
 */
export const OWNER_PLAYER = 0;
export const OWNER_RIVAL = 1;
export const OWNER_COUNT = 2;

/**
 * District character (design/04). Qualitative, not a quality axis — none of these
 * is "better" than another. A place is coherent when one of them clearly dominates.
 *
 * `martial` was held back from the MVP catalogue on the grounds that nothing read
 * it. Now that territory has a military half, a garrison quarter is a real place
 * with its own architecture and its own housing, so it joins the palette on the
 * same terms as the rest: not better, not worse, unmistakably something.
 */
export const CHARACTERS = [
  'industrious',
  'mercantile',
  'devout',
  'rustic',
  'raucous',
  'verdant',
  'martial',
] as const;

export type Character = (typeof CHARACTERS)[number];

export const CHARACTER_COUNT = CHARACTERS.length;

export function characterIndex(c: Character): number {
  return CHARACTERS.indexOf(c);
}

export type BuildingFamily = 'economic' | 'civic' | 'residential' | 'military';

/**
 * What the town keeps.
 *
 * Four come out of the ground and two are **made** by combining the others
 * (`supply.ts`). The line matters: a raw good answers "is the ground here any
 * good", and a made good answers "does this building have neighbours", which
 * are two different questions and the second one had never been asked.
 *
 * Here rather than in `economy.ts` because the catalogue has to name them and
 * the catalogue must not depend on the economy.
 */
export const RESOURCE_KINDS = ['timber', 'stone', 'food', 'ore', 'iron', 'tools'] as const;
export type Resource = (typeof RESOURCE_KINDS)[number];

/**
 * What a building contributes to the military field (design/01 §2).
 *
 * Deliberately the opposite of a cultural emission in every property: it is
 * *built* rather than earned, it arrives the moment the building does, it has a
 * hard edge instead of a long tail, it costs food every tick forever, and it
 * vanishes completely the instant the building does.
 */
export interface Garrison {
  /** How hard it holds. Compared directly against the other side's. */
  strength: number;
  /** Metres of open ground it reaches. Tight — this is not culture. */
  reach: number;
  /** Food per tick, forever. Soldiers eat. */
  upkeep: number;
  /** Whether warbands can be raised here. */
  musters?: boolean;
}

export interface Emission {
  character: Character;
  /** Peak strength at the building's centre. */
  strength: number;
  /** Metres at which the emission has fallen to zero. */
  radius: number;
}

export interface BuildingType {
  id: string;
  name: string;
  family: BuildingFamily;
  /** Footprint in metres, axis-aligned. */
  width: number;
  depth: number;
  emissions: Emission[];
  /**
   * Residential only: what this becomes when the surrounding character is clear.
   * Keyed by dominant character.
   */
  evolvesTo?: Partial<Record<Character, string>>;
  /** Housing that has already evolved does not evolve again in the MVP. */
  isEvolved?: boolean;
  /** What it costs to build. Absent means free — greens and the like. */
  cost?: Partial<Record<Resource, number>>;
  /**
   * What this works takes in, per tick at full rate (`supply.ts`).
   *
   * Drawn from *neighbours within reach*, never from the town's stock — a
   * foundry with no mine near it does not quietly spend your ore, it stands
   * idle. This is the whole of what makes a chain a spatial decision.
   */
  consumes?: Partial<Record<Resource, number>>;
  /**
   * What it puts out, and how fast.
   *
   * `harvests` says what ground it draws on; this says what comes out of it.
   * A works with `harvests` is scaled by the land; one with `consumes` is
   * scaled by what reaches it; a couple have both.
   */
  produces?: { resource: Resource; rate: number };
  /** Military only: what it holds, how far, and what it eats. */
  garrison?: Garrison;
  /**
   * How many people this workplace needs before it produces at full rate
   * (`labour.ts`). A works at half staff yields half.
   */
  jobs?: number;
  /** How many workers live here. Housing only. */
  houses?: number;
  /**
   * Which land potential this building harvests, if any. Drives the yield
   * preview in the build UI, so the player can see what a site is worth
   * *before* paying for it.
   */
  harvests?: 'timber' | 'stone' | 'arable' | 'ore';
  /**
   * Household needs this building answers for anyone within reach
   * (`needs.ts`). This is what makes a church, a market and a tavern do
   * something rather than merely look like something.
   */
  serves?: ('water' | 'faith' | 'market' | 'ale')[];
}

export interface Building {
  id: number;
  typeId: string;
  /** Which settlement this belongs to. 0 is the player. */
  owner: number;
  pos: Vec2;
  /** Radians, quantised by placement to keep frontages tidy. */
  rotation: number;
  /** Ticks since placed — evolution needs a settling period. */
  age: number;
  /**
   * How far this building has drifted toward the *other* side, 0..1.
   *
   * Culture converts land, and land carries the buildings standing on it: sit
   * inside somebody else's integrated ground long enough and the place becomes
   * theirs, without a shot fired (design/01 §2, §4). Slow on purpose — this is
   * the one mechanic that could snowball, so it has to be watchable.
   */
  drift?: number;
}

export interface FieldReading {
  dominant: Character | null;
  /** Dominant's share of total character present, 0..1. Null when nothing is present. */
  coherence: number;
  /** Total character strength at this point, unnormalised. */
  intensity: number;
}
