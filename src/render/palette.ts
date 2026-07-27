import type { Character } from '../sim';

/**
 * Character colours. These are placeholders standing in for what will eventually
 * be architecture, materials and street furniture (design/04 §5) — but the MVP
 * has to answer "can you tell the quarters apart" somehow, and colour is the
 * cheapest honest proxy while the art doesn't exist.
 *
 * Chosen to stay distinguishable from each other rather than to be pretty.
 */
export const CHARACTER_COLOURS: Record<Character, number> = {
  industrious: 0xc1663a, // rust and soot
  mercantile: 0xd8a417, // gilt
  devout: 0x6b7fa3, // cold stone
  rustic: 0x8a9a4a, // olive and stubble
  raucous: 0xc2456b, // rose, lamplight
  verdant: 0x4f9e63, // leaf
};

export const CHARACTER_LABELS: Record<Character, string> = {
  industrious: 'Industrious',
  mercantile: 'Mercantile',
  devout: 'Devout',
  rustic: 'Rustic',
  raucous: 'Raucous',
  verdant: 'Verdant',
};

export const TERRAIN = {
  deepWater: 0x2b4a63,
  shallowWater: 0x3d6b86,
  shore: 0xb9ab84,
  lowland: 0x6f8a56,
  upland: 0x7d8560,
  high: 0x8e8574,
};

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function shade(colour: number, amount: number): number {
  return amount >= 0 ? mix(colour, 0xffffff, amount) : mix(colour, 0x000000, -amount);
}

/** Terrain colour by height in metres. */
export function terrainColour(h: number): number {
  if (h <= -6) return TERRAIN.deepWater;
  if (h <= 0) return mix(TERRAIN.deepWater, TERRAIN.shallowWater, (h + 6) / 6);
  if (h < 2) return mix(TERRAIN.shore, TERRAIN.lowland, h / 2);
  if (h < 14) return mix(TERRAIN.lowland, TERRAIN.upland, (h - 2) / 12);
  return mix(TERRAIN.upland, TERRAIN.high, Math.min(1, (h - 14) / 16));
}
