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
 * District character (design/04). Qualitative, not a quality axis — none of these
 * is "better" than another. A place is coherent when one of them clearly dominates.
 */
export const CHARACTERS = [
  'industrious',
  'mercantile',
  'devout',
  'rustic',
  'raucous',
  'verdant',
] as const;

export type Character = (typeof CHARACTERS)[number];

export const CHARACTER_COUNT = CHARACTERS.length;

export function characterIndex(c: Character): number {
  return CHARACTERS.indexOf(c);
}

export type BuildingFamily = 'economic' | 'civic' | 'residential';

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
}

export interface Building {
  id: number;
  typeId: string;
  pos: Vec2;
  /** Radians, quantised by placement to keep frontages tidy. */
  rotation: number;
  /** Ticks since placed — evolution needs a settling period. */
  age: number;
}

export interface FieldReading {
  dominant: Character | null;
  /** Dominant's share of total character present, 0..1. Null when nothing is present. */
  coherence: number;
  /** Total character strength at this point, unnormalised. */
  intensity: number;
}
