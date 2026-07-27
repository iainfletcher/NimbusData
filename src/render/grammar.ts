import { buildingType, type Character } from '../sim';

/**
 * A split grammar for facades (design/07 §1), after CGA Shape (Müller et al.,
 * SIGGRAPH 2006).
 *
 * A wall is not a texture, it is a **derivation**. Take the face, split it into
 * storeys, split each storey into bays, and give each bay a panel drawn from the
 * vocabulary its character allows. One rule set therefore produces a whole
 * street of related-but-different buildings, and adding a building type costs a
 * line rather than a new set of constants.
 *
 * The important consequence for the design: **architecture becomes a property of
 * character rather than of type**. A cottage in a devout quarter is derived by
 * the devout rules — stone, tall narrow openings, a plain ground floor — and the
 * quarter looks coherent because its buildings are literally built by the same
 * rules. That is `design/04`'s coherence expressed in the architecture itself
 * rather than alongside it.
 *
 * This is a facade grammar, not a full mass grammar: it splits faces, not
 * volumes. Massing is still handled by `appearance.ts`.
 */

export type Panel =
  | 'blank'
  | 'window'
  | 'tallWindow'
  | 'mullioned'
  | 'arched'
  | 'shopfront'
  | 'door'
  | 'vent'
  | 'loft';

/** A derived panel, in the face's own [0,1] parametric space. */
export interface FacadePanel {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  panel: Panel;
}

interface FacadeRule {
  /** Target metres per bay. Narrow bays read as older, denser building. */
  bayWidth: number;
  /** Metres per storey. */
  storeyHeight: number;
  /** Vocabulary for the ground floor and for the floors above. */
  ground: Panel[];
  upper: Panel[];
  /** Chance a bay is left blank, which is what stops a facade looking issued. */
  blankChance: number;
  /** Fraction of the top storey given over to a loft opening, if any. */
  loft: number;
}

/**
 * One rule set per character. These are the differences that make a quarter
 * legible at a glance: bay rhythm, opening shape, how much wall is left blank.
 */
const RULES: Record<Character, FacadeRule> = {
  // Regular bays, big workshop windows, little ornament.
  industrious: {
    bayWidth: 3.0,
    storeyHeight: 3.4,
    ground: ['window', 'window', 'vent', 'door'],
    upper: ['window', 'window', 'blank'],
    blankChance: 0.1,
    loft: 0,
  },
  // Shopfronts below, well-lit rooms above: a trading street.
  mercantile: {
    bayWidth: 3.4,
    storeyHeight: 3.2,
    ground: ['shopfront', 'shopfront', 'door'],
    upper: ['mullioned', 'window', 'window'],
    blankChance: 0.06,
    loft: 0.25,
  },
  // Stone, tall and narrow, and a great deal of plain wall.
  devout: {
    bayWidth: 4.2,
    storeyHeight: 4.4,
    ground: ['arched', 'blank', 'door'],
    upper: ['tallWindow', 'blank', 'tallWindow'],
    blankChance: 0.34,
    loft: 0,
  },
  // Irregular, low, small openings — a farmhouse is not a terrace.
  rustic: {
    bayWidth: 3.8,
    storeyHeight: 2.9,
    ground: ['window', 'door', 'blank'],
    upper: ['window', 'blank'],
    blankChance: 0.26,
    loft: 0.4,
  },
  // Wide ground-floor openings, lit upper rooms, a bit of a jumble.
  raucous: {
    bayWidth: 3.1,
    storeyHeight: 3.1,
    ground: ['shopfront', 'door', 'window'],
    upper: ['mullioned', 'window', 'window'],
    blankChance: 0.12,
    loft: 0.2,
  },
  // Generous, regular, garden-facing.
  verdant: {
    bayWidth: 3.6,
    storeyHeight: 3.2,
    ground: ['tallWindow', 'door', 'window'],
    upper: ['window', 'window', 'blank'],
    blankChance: 0.16,
    loft: 0,
  },
};

const DEFAULT_RULE: FacadeRule = RULES.rustic;

/** Which rule set a building derives from — its strongest emitted character. */
export function ruleFor(typeId: string): FacadeRule {
  const type = buildingType(typeId);
  if (type.emissions.length === 0) return DEFAULT_RULE;

  let strongest = type.emissions[0];
  for (const e of type.emissions) if (e.strength > strongest.strength) strongest = e;
  return RULES[strongest.character] ?? DEFAULT_RULE;
}

/** Deterministic hash, so a given wall of a given building never changes. */
function hash(a: number, b: number): number {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Derive a face into panels.
 *
 * Split vertically into storeys, then each storey horizontally into bays, then
 * assign each bay a terminal from the storey's vocabulary. The door is placed
 * once, on the middle bay of the ground floor, and only where one is wanted.
 */
export function deriveFacade(
  typeId: string,
  wallLength: number,
  wallHeight: number,
  seed: number,
  withDoor: boolean,
): FacadePanel[] {
  const rule = ruleFor(typeId);
  const out: FacadePanel[] = [];

  const storeys = Math.max(1, Math.min(4, Math.round(wallHeight / rule.storeyHeight)));
  const bays = Math.max(1, Math.min(8, Math.round(wallLength / rule.bayWidth)));

  // Openings sit within the storey, not against its floor and ceiling.
  const inset = 0.24;
  const doorBay = withDoor ? Math.floor(bays / 2) : -1;

  for (let s = 0; s < storeys; s++) {
    const isGround = s === 0;
    const isTop = s === storeys - 1;
    const v0 = s / storeys;
    const v1 = (s + 1) / storeys;
    const vocabulary = isGround ? rule.ground : rule.upper;

    for (let bay = 0; bay < bays; bay++) {
      const r = hash(seed + s * 71.3, bay * 17.9);

      let panel: Panel;
      if (isGround && bay === doorBay) {
        panel = 'door';
      } else if (r < rule.blankChance) {
        panel = 'blank';
      } else {
        // A door in the vocabulary is only ever used for the actual door.
        const choices = vocabulary.filter((p) => p !== 'door');
        panel = choices[Math.floor(hash(bay * 3.7, seed + s) * choices.length)] ?? 'blank';
      }

      if (isTop && rule.loft > 0 && panel !== 'door' && hash(seed + 5.1, bay) < rule.loft) {
        panel = 'loft';
      }

      if (panel === 'blank') continue;

      const u0 = bay / bays;
      const u1 = (bay + 1) / bays;
      const padU = (u1 - u0) * (panel === 'shopfront' ? 0.12 : 0.28);
      const padV = (v1 - v0) * inset;

      out.push({
        u0: u0 + padU,
        u1: u1 - padU,
        v0: panel === 'door' || panel === 'shopfront' ? v0 + padV * 0.35 : v0 + padV,
        v1: v1 - padV,
        panel,
      });
    }
  }

  return out;
}
