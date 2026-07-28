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
  // Iron and cold ash. The only unsaturated entry in the palette, which is how
  // it stays distinct from devout's blue-grey stone at a glance.
  martial: 0x4e545e,
};

export const CHARACTER_LABELS: Record<Character, string> = {
  industrious: 'Industrious',
  mercantile: 'Mercantile',
  devout: 'Devout',
  rustic: 'Rustic',
  raucous: 'Raucous',
  verdant: 'Verdant',
  martial: 'Martial',
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

/**
 * Two-tone lighting, and the single biggest thing standing between this and
 * looking like a diorama rather than a diagram.
 *
 * Shading by mixing toward white and black — which is what `shade` does, and
 * what every face in the game used to do — is *greyscale* shading. It makes a
 * lit wall paler and a shaded wall darker, and the whole scene drifts toward
 * grey at both ends. Real outdoor light does not work like that, and neither
 * does any painted or sculpted miniature:
 *
 * > **A sunlit face goes warm. A shaded face does not go dark, it goes
 * > *blue* — because the only light reaching it is the sky.**
 *
 * So faces are mixed toward a warm sun colour or a cool sky colour instead of
 * toward white or black. Nothing else about the geometry changes, and the whole
 * scene stops looking like flat-shaded polygons. It is also physically the right
 * model — key light plus hemispherical fill — arrived at for the cheapest
 * possible reason: two lerps and no extra draw calls.
 */
const SUN_COLOUR = 0xffd694;
const SKY_COLOUR = 0x415675;

/**
 * How hard the key and the fill push, and the ratio between them is the whole
 * tuning.
 *
 * The first attempt used a strong key, and every pale roof in the town washed
 * out to cream: a thatch already at 0xc0a765 mixed a third of the way to a light
 * warm colour has nowhere left to go. **Contrast has to come from the shadow
 * side, not the lit side** — which is also how it works outdoors, where the sun
 * is one stop of lift and the shade is three stops of loss. So the key is light
 * and the fill is heavy and properly dark.
 */
const SUN_STRENGTH = 0.15;
const SKY_STRENGTH = 0.42;

/**
 * Light a surface from how squarely it faces the sun.
 *
 * `lambert` is the cosine of the angle to the light, in −1..1: +1 is facing it
 * head on, 0 is edge on, −1 is facing directly away. An `ambient` term lifts
 * everything slightly so a fully turned-away face still reads as a material
 * rather than a hole.
 */
export function lit(colour: number, lambert: number, ambient = 0): number {
  const t = Math.max(-1, Math.min(1, lambert + ambient));
  return t >= 0
    ? mix(colour, SUN_COLOUR, t * SUN_STRENGTH)
    : mix(colour, SKY_COLOUR, -t * SKY_STRENGTH);
}

/**
 * The sun, in one place, so terrain relief, wall shading, roof slopes and cast
 * shadows all agree. Low in the north-west: the classic isometric key light,
 * which throws shadows away from the camera rather than across the thing casting
 * them.
 *
 * Elevation matters as much as bearing. At 38° a roof slope facing the sun and
 * one facing away differ strongly, which is what makes a pitched roof read as
 * two planes instead of one flat shape.
 */
export const SUN = { x: 0.58, y: 0.81 };
const SUN_ELEVATION = 0.66; // radians, ~38°

/** Unit vector along which light travels, in 3D. z points up. */
export const SUN_DIR = (() => {
  const len = Math.hypot(SUN.x, SUN.y);
  const c = Math.cos(SUN_ELEVATION);
  const s = Math.sin(SUN_ELEVATION);
  return { x: (SUN.x / len) * c, y: (SUN.y / len) * c, z: -s };
})();

/** How lit a surface with this outward normal is. Normal need not be unit. */
export function lambertOf(nx: number, ny: number, nz: number): number {
  const len = Math.hypot(nx, ny, nz) || 1;
  return -(nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z) / len;
}

/**
 * What level ground reads as. Anything that wants to show *relief* rather than
 * absolute orientation should measure against this, so flat ground comes out
 * neutral and the whole range is spent on slopes.
 */
export const FLAT_LAMBERT = lambertOf(0, 0, 1);

/**
 * Ground colour by height. Water is drawn separately now, from the derived
 * surface rather than from "below zero", so this only ever colours land.
 */
export function terrainColour(h: number): number {
  if (h < 1) return mix(TERRAIN.shore, TERRAIN.lowland, Math.max(0, h));
  if (h < 16) return mix(TERRAIN.lowland, TERRAIN.upland, (h - 1) / 15);
  return mix(TERRAIN.upland, TERRAIN.high, Math.min(1, (h - 16) / 22));
}

/** Water colour by depth, so a river reads shallower than a lake. */
export function waterColour(depth: number): number {
  const t = Math.min(1, Math.max(0, depth / 5));
  return mix(TERRAIN.shallowWater, TERRAIN.deepWater, t);
}

/**
 * Territory. The player reads warm, the rival cool — the two are meant to be
 * told apart at a glance from a long way out, so they sit at opposite ends of
 * the temperature range rather than merely being different hues.
 */
export const TERRITORY_COLOURS = [0xe0a23c, 0x6f8fd0];
export const FRONTIER_COLOUR = 0xfaf0d8;

/**
 * Military colours, and the reason they are a separate set (design/01 §6).
 *
 * The two fields have to be told apart *while overlapping*, which is the design's
 * own §7 risk 3 and the hardest thing to get right in the whole visual language.
 * Hue alone cannot do it, because both belong to the same side and must read as
 * the same side. So the distinction is carried by **value and edge**: culture is
 * a low-contrast wash with a long gradient; banner colours are near-white,
 * high-contrast, and only ever drawn as a hard one-cell line.
 *
 * The result is the reading `01` §6 asks for: a bright drawn contour enclosing
 * ground the warm haze does not fill says *we are standing here, but this isn't
 * ours* — wordlessly, with no numbers, at any zoom.
 */
export const BANNER_COLOURS = [0xffdb8a, 0xa8c8ff];

/** Where neither side can hold: a battle line. Neither banner, and alarming. */
export const CONTESTED_COLOUR = 0xff7a4d;

/**
 * How the ground itself turns through the year.
 *
 * Turning the trees and leaving the fields summer-green does about half a job:
 * a bare wood standing on lush grass reads as a bug rather than as February.
 * The land is most of the picture, so it has to turn too — and once it does,
 * winter is a different *landscape* rather than the same one with thinner trees.
 *
 * Deliberately restrained. This is a British year, not a set of filters: a wash
 * toward fresh green, toward dry gold, toward dull ochre, and back.
 */
export const GROUND_SEASON: Record<string, { tint: number; mix: number }> = {
  spring: { tint: 0x9ec254, mix: 0.28 },
  summer: { tint: 0x6f8a46, mix: 0.1 },
  autumn: { tint: 0xb2953f, mix: 0.36 },
  // Cold and grey, not merely a different green. The first attempt picked a
  // greyish *olive*, which mixed with an olive base produces olive — the ground
  // came out looking greener in February than in October.
  winter: { tint: 0x8d9382, mix: 0.62 },
};

/** Mix a colour toward another by t. Shared with the decor renderer. */
export function toward(colour: number, target: number, t: number): number {
  return mix(colour, target, t);
}

/**
 * Resource colours for the land overlay.
 *
 * The land has always held timber, stone, arable and ore, and none of it was
 * visible — so siting a works was a guess dressed up as a decision. These are
 * the four, keyed to what they are rather than to a ramp: green for wood, grey
 * for rock, wheat for arable, rust for ore.
 */
export const RESOURCE_COLOURS: Record<string, number> = {
  timber: 0x3f7a3a,
  stone: 0x8d8d94,
  arable: 0xc9a83c,
  ore: 0xb1552c,
};

/**
 * What each good in the chain is drawn as when it moves (`supply.ts`).
 *
 * Keyed to the land overlay where the two overlap — ore is the same rust as the
 * seam it came out of — so a line of ore running to a foundry is legibly the
 * same substance as the patch on the map it was dug from.
 */
export const SUPPLY_COLOURS: Record<string, number> = {
  timber: 0x6f9c56,
  stone: 0x9a9aa2,
  food: 0xc9a83c,
  ore: 0xb1552c,
  iron: 0x7e8fa6,
  tools: 0xd8a417,
};

export const RESOURCE_LABELS: Record<string, string> = {
  timber: 'Timber',
  stone: 'Stone',
  arable: 'Arable',
  ore: 'Ore',
};
