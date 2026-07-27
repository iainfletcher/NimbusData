import { buildingType, type Character } from '../sim';

/**
 * What a building is made of and what shape its roof is (design/04 §5).
 *
 * This replaces flat character-coloured boxes, which passed success criterion 1
 * only by cheating: quarters read apart because each character had an arbitrary
 * hue, not because they looked like different places. Real districts are told
 * apart by **material and form** — soot brick under slate is a different world
 * from limestone under lead, whatever colour you call them.
 *
 * The character overlay keeps the arbitrary hues, because as a *diagnostic* they
 * are exactly right. This is the honest view.
 */

export type RoofForm = 'gable' | 'hip' | 'flat';

export interface Appearance {
  wall: number;
  roof: number;
  form: RoofForm;
  /** Height to the eaves, in metres. */
  eaves: number;
  /** Extra height from eaves to ridge. */
  rise: number;
  /** True when the ridge runs along the building's width rather than its depth. */
  ridgeAlongWidth: boolean;
  /** A spire or bell tower at one end — landmarks only. */
  tower?: { height: number; width: number };
  /** Exposed timber frame on the walls. */
  framed?: boolean;
  /** Dormer windows in the roof slope. */
  dormers?: number;
  /** How far the roof oversails the walls, in metres. */
  overhang?: number;
}

/** Material palettes, one per character. Chosen as materials, not as hues. */
const MATERIALS: Record<Character, { wall: number; roof: number }> = {
  // Soot-blackened brick under slate.
  industrious: { wall: 0x6d5a4e, roof: 0x484d55 },
  // Lime render and honey stone under clay tile.
  mercantile: { wall: 0xc4b391, roof: 0x9c5b45 },
  // Pale limestone under lead.
  devout: { wall: 0xcac3b0, roof: 0x5f646c },
  // Timber frame and cob under thatch.
  rustic: { wall: 0xbaa98a, roof: 0xc0a765 },
  // Painted render under old tile.
  raucous: { wall: 0xb2856b, roof: 0x8d564a },
  // Pale weatherboard among planting.
  verdant: { wall: 0xa9ac8f, roof: 0x6f7a5c },
};

/** Vegetation, for the things that aren't really buildings. */
const FOLIAGE = { wall: 0x4d7a44, roof: 0x3f6a38 };

/** Dark oak, for the framed buildings. */
export const TIMBER_FRAME = 0x4a3626;

const DEFAULT: Appearance = {
  wall: 0xa89b88,
  roof: 0x7a6f63,
  form: 'gable',
  eaves: 4.5,
  rise: 3,
  ridgeAlongWidth: true,
  overhang: 0.5,
};

/** Per-type overrides, where a building wants a specific silhouette. */
const OVERRIDES: Record<string, Partial<Appearance>> = {
  // Landmarks: taller, steeper, and the church gets its tower.
  church: { eaves: 9, rise: 7, form: 'gable', tower: { height: 20, width: 5.5 }, overhang: 0.4 },
  chapel: { eaves: 6, rise: 4.5, overhang: 0.4 },
  guildhall: { eaves: 8, rise: 4, form: 'hip', framed: true, overhang: 0.9 },
  market: { eaves: 4, rise: 2.5, form: 'hip', overhang: 1.4 },

  // Industry: big sheds, shallow roofs, tall stacks read as chimneys.
  foundry: { eaves: 9, rise: 2.5, form: 'gable', tower: { height: 19, width: 2.6 }, overhang: 0.3 },
  tannery: { eaves: 6, rise: 2, overhang: 0.4 },
  sawmill: { eaves: 6, rise: 2.5, framed: true, overhang: 0.8 },
  workshop: { eaves: 5, rise: 2.5, framed: true, overhang: 0.7 },
  warehouse: { eaves: 8, rise: 2, overhang: 0.4 },
  watermill: { eaves: 7, rise: 3.5, framed: true, overhang: 0.7 },
  farm: { eaves: 5.5, rise: 4, framed: true, overhang: 0.8 },

  // Not buildings: ground cover with no roof to speak of.
  green: { form: 'flat', eaves: 0.4, rise: 0, wall: FOLIAGE.wall, roof: FOLIAGE.roof },
  orchard: { form: 'flat', eaves: 1.6, rise: 0, wall: FOLIAGE.wall, roof: FOLIAGE.roof },

  // Housing: the evolved forms are what actually distinguish a quarter.
  cottage: { eaves: 3.6, rise: 2.8, framed: true, overhang: 0.7 },
  terrace: { eaves: 6.5, rise: 2.4, ridgeAlongWidth: true, dormers: 3, overhang: 0.4 },
  merchant_house: { eaves: 7.5, rise: 3.2, ridgeAlongWidth: false, framed: true, overhang: 0.9 },
  close_cottage: { eaves: 4, rise: 3.4, dormers: 1, overhang: 0.6 },
  farmhouse: { eaves: 4.6, rise: 3.8, framed: true, dormers: 1, overhang: 0.8 },
  lodging_house: { eaves: 7, rise: 2.8, framed: true, dormers: 2, overhang: 0.9 },
  garden_cottage: { eaves: 3.8, rise: 3, framed: true, overhang: 0.7 },
};

const CACHE = new Map<string, Appearance>();

export function appearanceOf(typeId: string): Appearance {
  const cached = CACHE.get(typeId);
  if (cached) return cached;

  const type = buildingType(typeId);

  // Material follows the character the building most strongly emits, so a
  // foundry quarter is built of what foundries are built of.
  let material = { wall: DEFAULT.wall, roof: DEFAULT.roof };
  if (type.emissions.length > 0) {
    let strongest = type.emissions[0];
    for (const e of type.emissions) if (e.strength > strongest.strength) strongest = e;
    material = MATERIALS[strongest.character];
  }

  // Housing emits little or nothing, so it takes its material from what it
  // became — a workers' terrace is brick and slate because of where it stands.
  if (type.family === 'residential' && type.emissions.length > 0) {
    const c = type.emissions[0].character;
    material = MATERIALS[c];
  }

  const appearance: Appearance = {
    ...DEFAULT,
    ...material,
    // A long thin building puts its ridge along the long axis, as it must.
    ridgeAlongWidth: type.width >= type.depth,
    ...OVERRIDES[typeId],
  };

  CACHE.set(typeId, appearance);
  return appearance;
}
