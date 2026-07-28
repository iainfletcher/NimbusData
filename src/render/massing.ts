import { buildingType, type Character } from '../sim';
import { appearanceOf, type Appearance, type RoofForm } from './appearance';

/**
 * A **mass grammar** — the half of CGA Shape that was missing (design/07 §1).
 *
 * `grammar.ts` splits *faces* into storeys and bays. It says nothing about the
 * shape of the thing whose faces those are, and until now nothing did: every
 * building in the game was one box with one roof on it, with proportions looked
 * up from a table in `appearance.ts`. That is the reason a street of them read
 * as a row of crates with different hats.
 *
 * Here a building is instead **derived into volumes**, from a vocabulary that
 * real buildings are actually assembled from:
 *
 * > main range · cross-wing · lean-to · jetty · porch · chancel · turret ·
 * > stack · veranda
 *
 * The consequence is the one worth having, and it is the same argument
 * `grammar.ts` makes about facades, moved up a level:
 *
 * > **Type says what a building is. Character says what it is built like. The
 * > grammar composes it out of volumes.**
 *
 * So a merchant's house jetties its upper storey out over the street because
 * that is what mercantile means here, a farmhouse grows a lean-to and a byre
 * because that is what rustic means, and a chapel gets a lower chancel and a
 * porch — all from the same eight rules, none of them written per building
 * type. Adding a type costs an entry in the catalogue and nothing here.
 *
 * ### Why this is in `render` and not `sim`
 *
 * Massing is *appearance*. It changes nothing a simulation can read: footprints,
 * collision and placement all still use the catalogue's flat width × depth. A
 * jetty overhangs visually and owns no extra ground. Keeping it here means the
 * layering rule holds and the sim stays engine-agnostic.
 */

export interface Block {
  /** Centre in the building's own frame: u along its width, v along its depth. */
  u: number;
  v: number;
  width: number;
  depth: number;
  /** Height of this block's floor above the building's ground level. */
  base: number;
  /** Base to eaves. */
  height: number;
  /** Eaves to ridge. Zero with a flat form. */
  rise: number;
  form: RoofForm;
  ridgeAlongWidth: boolean;
  overhang: number;
  crown?: 'spire' | 'flat' | 'battlement';
  dormers?: number;
  framed?: boolean;
  /** Derive a facade on this block's camera-facing walls. */
  facade?: boolean;
  /** The block that carries the front door. At most one. */
  door?: boolean;
  /** Chimneys and flues: drawn as masonry, never given windows. */
  stack?: boolean;
  /**
   * For a `lean` roof: which side the high edge is on, along the block's v
   * axis. A lean-to slopes *away* from whatever it is leaning against.
   */
  leanFrom?: 1 | -1;
  /**
   * A piece of working machinery drawn on the block, after its walls.
   *
   * Some buildings are named after a *thing*, and without the thing they are
   * just a shed: a watermill with no wheel is a barn beside a stream. One piece
   * of recognisable machinery does more for legibility than any amount of
   * massing, because it is the object the building is named for.
   */
  feature?: 'wheel';
  /**
   * No walls: a roof carried on corner posts.
   *
   * This is what a market hall, a lych gate and a veranda all are, and it is
   * the one silhouette that reads unambiguously as *not a building you go
   * inside*. A market drawn with walls is a barn.
   */
  open?: boolean;
}

/**
 * Deterministic per-building variation, bucketed.
 *
 * A terrace wants its houses to differ; the renderer wants to cache. Eight
 * variants per type is enough that a row never reads as clones and small enough
 * that the cache stays trivial.
 */
export const MASS_VARIANTS = 8;

const CACHE = new Map<string, Block[]>();

export function massOf(typeId: string, variant: number): Block[] {
  const v = ((variant % MASS_VARIANTS) + MASS_VARIANTS) % MASS_VARIANTS;
  const key = `${typeId}:${v}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const blocks = derive(typeId, v);
  CACHE.set(key, blocks);
  return blocks;
}

/** Deterministic 0..1 from a variant and a salt. No RNG state to thread. */
function rnd(variant: number, salt: number): number {
  const h = Math.sin(variant * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** The style a building is built in: the character it most strongly emits. */
function styleOf(typeId: string): Character | null {
  const type = buildingType(typeId);
  if (type.emissions.length === 0) return null;
  let strongest = type.emissions[0];
  for (const e of type.emissions) if (e.strength > strongest.strength) strongest = e;
  return strongest.character;
}

function derive(typeId: string, variant: number): Block[] {
  const type = buildingType(typeId);
  const look = appearanceOf(typeId);

  // Ground cover — greens, orchards — is not a building and gets no massing.
  if (look.form === 'flat' && look.eaves < 2) {
    return [mainRange(typeId, look, variant, 1)];
  }

  const blocks: Block[] = [];
  const main = mainRange(typeId, look, variant, 0.98);
  blocks.push(main);

  // Per-type composition first, where a building is a specific known thing.
  // Everything else is composed from its character.
  switch (typeId) {
    case 'church':
      blocks.push(chancel(main, 0.62, 0.72), porch(main, look, variant));
      break;
    case 'chapel':
      blocks.push(chancel(main, 0.7, 0.8));
      break;
    case 'watermill':
      blocks.push(leanTo(main, look, -1, 0.55));
      main.feature = 'wheel';
      break;
    case 'foundry':
    case 'tannery':
      blocks.push(leanTo(main, look, 1, 0.5));
      break;

    case 'quarry': {
      // A quarry is **a hole in the ground with stone coming out of it**, not a
      // building. It was rendering as a dark shed, which is the single least
      // informative thing it could have been. There is no way to cut the terrain
      // from here, so it is built the other way round: a stepped worked face,
      // cut blocks stacked in the yard, and a hut for the tools.
      const bench = main.width;
      blocks.length = 0;
      for (let i = 0; i < 3; i++) {
        const t = i / 3;
        blocks.push({
          u: -bench * 0.08 * i,
          v: -bench * 0.08 * i,
          width: main.width * (1 - t * 0.28),
          depth: main.depth * (1 - t * 0.28),
          base: 0,
          height: 1.5 + i * 1.9,
          rise: 0,
          form: 'flat',
          ridgeAlongWidth: true,
          overhang: 0,
        });
      }
      // Cut blocks waiting to be carted away. Scale, and a reason for the road.
      for (let i = 0; i < 4; i++) {
        const a = rnd(variant, 30 + i) * Math.PI * 2;
        const d = main.width * (0.42 + rnd(variant, 40 + i) * 0.16);
        blocks.push({
          u: Math.cos(a) * d,
          v: Math.sin(a) * d,
          width: 1.5 + rnd(variant, 50 + i) * 1.1,
          depth: 1.4 + rnd(variant, 60 + i) * 1,
          base: 0,
          height: 0.9 + rnd(variant, 70 + i) * 1.2,
          rise: 0,
          form: 'flat',
          ridgeAlongWidth: true,
          overhang: 0,
        });
      }
      blocks.push({
        u: main.width * 0.42,
        v: -main.depth * 0.42,
        width: 6,
        depth: 5,
        base: 0,
        height: 3.2,
        rise: 1.8,
        form: 'gable',
        ridgeAlongWidth: true,
        overhang: 0.5,
        facade: true,
        door: true,
      });
      break;
    }

    case 'market':
      // A market hall is a roof on posts standing over an open floor. Given
      // walls it is a barn, and given a cross-wing it is a barn with a porch —
      // which is what it used to be. The whole of what makes it legible is that
      // you can see *through* it.
      main.open = true;
      main.facade = false;
      main.door = false;
      blocks.unshift(baseCourse(main, 0.9, 1.4));
      break;

    // ---- Fortification ---------------------------------------------------
    //
    // These are composed here rather than by character, because a tower is not
    // a house with martial trimmings — it is a different kind of object, and
    // the rules that produce a good farmhouse produce a bad castle.
    case 'watchtower':
      // **The building is the tower.** The first version put a turret on the
      // corner of a shaft that was nearly the same width, which read as two
      // chimneys side by side rather than as one fortification.
      main.crown = 'battlement';
      main.facade = true;
      blocks.unshift(baseCourse(main, 1.1, 2.2));
      blocks.push(forebuilding(main, look, 0.3));
      break;

    case 'keep':
      // A broad crenellated mass with one slimmer stair turret rising clear of
      // it, and a low forebuilding carrying the door. The turret has to be
      // *obviously* thinner than the mass or the two read as one lumpy shaft.
      main.crown = 'battlement';
      blocks.unshift(baseCourse(main, 1.3, 2.6));
      blocks.push(stairTurret(main), forebuilding(main, look, 0.38));
      break;

    default:
      composeByStyle(blocks, main, typeId, look, variant);
  }

  if (look.tower) blocks.push(tower(look, type.width, type.depth));

  return blocks;
}

/**
 * The vocabulary, applied by character.
 *
 * Each of these is a sentence about what the style *is*, not a list of
 * decorations. That is the difference between a mass grammar and a prop system.
 */
function composeByStyle(
  blocks: Block[],
  main: Block,
  typeId: string,
  look: Appearance,
  variant: number,
): void {
  const style = styleOf(typeId);
  const family = buildingType(typeId).family;
  const r = rnd(variant, 3);

  switch (style) {
    // Trade happens at the street. The upper storey oversails it, which is the
    // single most recognisable thing about a medieval trading street.
    case 'mercantile':
      blocks.push(jetty(main, look, variant));
      if (r > 0.45) blocks.push(porch(main, look, variant));
      break;

    // A farm accretes. It grows a lean-to against the long wall and, given
    // room, a byre at right angles to the house.
    case 'rustic':
      blocks.push(leanTo(main, look, r > 0.5 ? 1 : -1, 0.52));
      if (main.width > 12 && r > 0.6) blocks.push(crossWing(main, look, 0.7));
      break;

    // Stone, and a lower volume at one end: a chancel, a vestry, a side chapel.
    case 'devout':
      blocks.push(chancel(main, 0.7, 0.78));
      break;

    // Industry is a big shed with smaller ones bolted to it, and a flue.
    //
    // Not for housing, though. A workers' terrace emits `industrious` — that is
    // the whole point of it — so the style rules were giving a row of cottages a
    // twenty-metre factory chimney. **Character says what a building is built
    // like; it does not say what the building is for.**
    case 'industrious':
      blocks.push(leanTo(main, look, r > 0.5 ? 1 : -1, 0.62));
      if (!look.tower && family !== 'residential') blocks.push(flue(main, variant));
      break;

    // A drinking house is a muddle that has been added to for two centuries.
    case 'raucous':
      blocks.push(crossWing(main, look, 0.78));
      blocks.push(porch(main, look, variant));
      break;

    // Generous and open to the garden: a low veranda across the front.
    case 'verdant':
      blocks.push(veranda(main, look));
      break;

    // Martial *housing* — a barrack row. Blunt and plain, with a covered
    // entrance and nothing else. A battered base course belongs on a wall that
    // has to stop a battering ram; on a terrace it reads as a stone apron laid
    // in front of the door.
    case 'martial':
      if (family !== 'residential') blocks.push(baseCourse(main, 0.5, 1.1));
      else blocks.push(porch(main, look, variant));
      break;

    default:
      // Plain housing: a lean-to often enough to break up a terrace, and a
      // porch on the rest. Nothing is ever bare.
      if (r > 0.62) blocks.push(leanTo(main, look, r > 0.8 ? 1 : -1, 0.5));
      else if (r > 0.3 && family === 'residential') blocks.push(porch(main, look, variant));
      break;
  }
}

// ---- The vocabulary -------------------------------------------------------

function mainRange(typeId: string, look: Appearance, variant: number, shrink: number): Block {
  const type = buildingType(typeId);
  // Height varies a little per building, which is most of what stops a terrace
  // reading as extruded from one profile.
  const h = look.eaves * (0.93 + rnd(variant, 1) * 0.14);
  return {
    u: 0,
    v: 0,
    width: type.width * shrink,
    depth: type.depth * shrink,
    base: 0,
    height: look.form === 'flat' ? look.eaves : h,
    rise: look.rise,
    form: look.form,
    ridgeAlongWidth: look.ridgeAlongWidth,
    overhang: look.overhang ?? 0.5,
    dormers: look.dormers,
    framed: look.framed,
    facade: true,
    door: true,
  };
}

/**
 * A jettied upper storey: the floor above oversails the one below on brackets.
 *
 * Modelled as two blocks — a lower storey at full footprint and an upper one
 * that is *wider* — so the overhang is real geometry that catches its own
 * shadow, rather than a line painted on a wall.
 */
function jetty(main: Block, look: Appearance, variant: number): Block {
  const out = 0.55 + rnd(variant, 7) * 0.35;
  // The lower storey keeps the door and the shopfront; the jetty takes the roof.
  const split = main.height * 0.52;
  main.height = split;
  main.rise = 0;
  main.form = 'flat';
  main.overhang = 0;
  main.dormers = 0;

  return {
    u: main.u,
    v: main.v,
    width: main.width + out * 2,
    depth: main.depth + out * 2,
    base: split,
    height: Math.max(2.4, look.eaves - split),
    rise: look.rise,
    form: look.form === 'flat' ? 'gable' : look.form,
    ridgeAlongWidth: main.ridgeAlongWidth,
    overhang: look.overhang ?? 0.5,
    dormers: look.dormers,
    framed: true,
    facade: true,
  };
}

/** A lower range against one long wall, roofed with a single slope. */
function leanTo(main: Block, look: Appearance, side: 1 | -1, fraction: number): Block {
  const alongWidth = main.ridgeAlongWidth;
  const spanU = alongWidth ? main.width : main.depth;
  const spanV = alongWidth ? main.depth : main.width;
  const depth = Math.max(2.2, spanV * 0.42);
  const offset = (side * (spanV + depth)) / 2;

  return {
    u: alongWidth ? main.u : offset,
    v: alongWidth ? offset : main.v,
    width: alongWidth ? spanU * 0.82 : depth,
    depth: alongWidth ? depth : spanU * 0.82,
    base: 0,
    height: main.height * fraction,
    rise: Math.max(0.7, main.height * (1 - fraction) * 0.85),
    form: 'lean',
    // The slope falls away from the main range, so the high edge is the one
    // against it.
    ridgeAlongWidth: alongWidth,
    overhang: (look.overhang ?? 0.5) * 0.7,
    leanFrom: side,
  };
}

/** A wing at right angles, making an L. The ridge crosses the main one. */
function crossWing(main: Block, look: Appearance, fraction: number): Block {
  const alongWidth = main.ridgeAlongWidth;
  const spanU = alongWidth ? main.width : main.depth;
  const spanV = alongWidth ? main.depth : main.width;
  const wingU = Math.max(3, spanU * 0.42);
  const wingV = spanV * 1.15;
  const offset = (spanU - wingU) / 2;

  return {
    u: alongWidth ? offset : main.u,
    v: alongWidth ? main.v : offset,
    width: alongWidth ? wingU : wingV,
    depth: alongWidth ? wingV : wingU,
    base: 0,
    height: main.height * fraction,
    rise: main.rise * fraction,
    form: 'gable',
    // Crossed: this is the whole point of the wing.
    ridgeAlongWidth: !alongWidth,
    overhang: look.overhang ?? 0.5,
    framed: main.framed,
  };
}

/** A lower, narrower volume at one end — a chancel, a vestry, a back kitchen. */
function chancel(main: Block, heightFraction: number, widthFraction: number): Block {
  const alongWidth = main.ridgeAlongWidth;
  const spanU = alongWidth ? main.width : main.depth;
  const spanV = alongWidth ? main.depth : main.width;
  const extra = spanU * 0.34;
  const offset = -(spanU + extra) / 2;

  return {
    u: alongWidth ? offset : main.u,
    v: alongWidth ? main.v : offset,
    width: alongWidth ? extra : spanV * widthFraction,
    depth: alongWidth ? spanV * widthFraction : extra,
    base: 0,
    height: main.height * heightFraction,
    rise: main.rise * heightFraction,
    form: 'gable',
    ridgeAlongWidth: alongWidth,
    overhang: main.overhang,
  };
}

/** A small covered entrance on the front. Tiny, and it does a lot. */
function porch(main: Block, look: Appearance, variant: number): Block {
  const alongWidth = main.ridgeAlongWidth;
  const spanV = alongWidth ? main.depth : main.width;
  const size = Math.max(1.6, Math.min(3, main.width * 0.22));
  const along = (rnd(variant, 11) - 0.5) * (alongWidth ? main.width : main.depth) * 0.4;
  const offset = (spanV + size) / 2;

  return {
    u: alongWidth ? along : offset,
    v: alongWidth ? offset : along,
    width: alongWidth ? size * 1.5 : size,
    depth: alongWidth ? size : size * 1.5,
    base: 0,
    height: Math.max(2.2, main.height * 0.46),
    rise: 1.1,
    form: 'gable',
    ridgeAlongWidth: !alongWidth,
    overhang: (look.overhang ?? 0.5) * 0.8,
    door: true,
  };
}

/** A low open canopy across the front, on posts. */
function veranda(main: Block, look: Appearance): Block {
  const alongWidth = main.ridgeAlongWidth;
  const spanU = alongWidth ? main.width : main.depth;
  const spanV = alongWidth ? main.depth : main.width;
  const depth = 1.9;
  const offset = (spanV + depth) / 2;

  return {
    u: alongWidth ? main.u : offset,
    v: alongWidth ? offset : main.v,
    width: alongWidth ? spanU * 0.9 : depth,
    depth: alongWidth ? depth : spanU * 0.9,
    base: 0,
    height: Math.max(2.1, main.height * 0.52),
    rise: 0.5,
    form: 'lean',
    ridgeAlongWidth: alongWidth,
    overhang: (look.overhang ?? 0.5) * 1.4,
    leanFrom: -1,
    open: true,
  };
}

/**
 * A battered base course, so a fortification thickens where it meets the ground.
 *
 * Deliberately *low and barely wider* than the mass above it. The first version
 * was two metres tall and a metre and a half proud on every side, which does not
 * read as a batter at all — it reads as a separate slab the tower has been stood
 * on, and the dark top surface of the slab reads as a hole.
 */
function baseCourse(main: Block, out: number, height: number): Block {
  return {
    u: main.u,
    v: main.v,
    width: main.width + out * 2,
    depth: main.depth + out * 2,
    base: 0,
    height,
    rise: 0,
    form: 'flat',
    ridgeAlongWidth: main.ridgeAlongWidth,
    overhang: 0,
  };
}

/**
 * A slim stair turret at one corner of a keep, rising clear of the battlements.
 *
 * Its whole job is to break the silhouette of a box. It must be much thinner
 * than the mass — a turret two thirds the width of the thing it stands on is
 * not a turret, it is a second tower.
 */
function stairTurret(main: Block): Block {
  const size = Math.max(3.6, Math.min(main.width, main.depth) * 0.3);
  const half = size / 2;
  return {
    u: main.u - main.width / 2 + half + 0.6,
    v: main.v - main.depth / 2 + half + 0.6,
    width: size,
    depth: size,
    base: 0,
    height: main.height + 4.5,
    rise: 0,
    form: 'flat',
    ridgeAlongWidth: true,
    overhang: 0.45,
    crown: 'battlement',
  };
}

/**
 * A low block against a fortification, carrying the door.
 *
 * Scale is the point. A featureless shaft could be four metres tall or forty;
 * putting something recognisably one-storey against it settles the question
 * instantly, and gives the entrance somewhere to be.
 */
function forebuilding(main: Block, look: Appearance, fraction: number): Block {
  const along = main.width >= main.depth;
  const spanU = along ? main.width : main.depth;
  const size = Math.max(3.4, spanU * 0.55);
  const depth = Math.max(2.6, spanU * 0.34);
  const offset = (along ? main.depth : main.width) / 2 + depth / 2;

  return {
    u: along ? main.u : main.u + offset,
    v: along ? main.v + offset : main.v,
    width: along ? size : depth,
    depth: along ? depth : size,
    base: 0,
    height: Math.max(3, main.height * fraction),
    rise: 1.2,
    form: 'gable',
    ridgeAlongWidth: !along,
    overhang: (look.overhang ?? 0.5) * 0.8,
    facade: true,
    door: true,
  };
}

/** An industrial flue. Tall, thin, and off to one side. */
function flue(main: Block, variant: number): Block {
  const side = rnd(variant, 13) > 0.5 ? 1 : -1;
  return {
    u: (main.width / 2 - 1.4) * side,
    v: (main.depth / 2 - 1.4) * side,
    width: 1.7,
    depth: 1.7,
    base: 0,
    height: main.height + main.rise + 5 + rnd(variant, 17) * 4,
    rise: 0,
    form: 'flat',
    ridgeAlongWidth: true,
    overhang: 0.18,
    stack: true,
  };
}

/** A spire, stack or turret, taken over from `appearance.ts`. */
/**
 * A spire or a stack, at one end of the range's **long** axis.
 *
 * That last word was the bug. The offset was always applied along the type's
 * *width*, and a church is 16m wide by 26m deep — so its tower was pushed
 * sideways into the middle of the nave, buried, with only the spire poking
 * through the roof like a flèche. A west tower belongs at the end of the long
 * axis, standing clear, where you can see the shaft it sits on.
 */
function tower(look: Appearance, typeWidth: number, typeDepth: number): Block {
  const t = look.tower!;
  const half = t.width / 2;
  const along = typeWidth >= typeDepth;
  const span = along ? typeWidth : typeDepth;
  // Just proud of the gable, so the shaft reads as its own volume.
  const offset = -(span / 2) - half * 0.35;

  return {
    u: along ? offset : 0,
    v: along ? 0 : offset,
    width: t.width,
    depth: t.width,
    base: 0,
    height: t.height,
    rise: 0,
    form: 'flat',
    ridgeAlongWidth: true,
    overhang: 0.25,
    crown: t.crown ?? (t.width < 3.5 ? 'flat' : 'spire'),
    stack: t.width < 3.5,
    facade: t.width >= 3.5,
  };
}
