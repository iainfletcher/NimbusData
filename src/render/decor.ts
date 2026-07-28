import { Graphics } from 'pixi.js';
import type { DecorItem, Season, TreeSpecies, Vec2 } from '../sim';
import { lambertOf, lit, shade, SUN } from './palette';
import type { Point } from './projection';

/**
 * Drawing for generated detail. Kept apart from worldView's building code
 * because it is a different job: buildings are architecture, this is everything
 * growing and lying around between them.
 */

const FOLIAGE = [0x4f7d3f, 0x5b8a45, 0x44703a, 0x63914c, 0x3f6a3c];
const CONIFER = [0x35604a, 0x2e5442, 0x3c6b52];
const TRUNK = 0x5e4634;
const HEDGE = 0x46703c;
const WALL_STONE = 0x9c968a;
const SOIL = 0x6b563f;
const CROP = 0x6f8446;
const TIMBER = 0x8a6a48;
const IRON = 0x4a4a4a;
const GRAVE = 0xb0aa9c;
/** Crops in rotation: young green, ripe gold, ploughed fallow, pasture. */
const CROPS = [0x7a8f4a, 0xb59a48, 0x8a7350, 0x6f8a52, 0xa8913f];
const AWNING = [0xa8484a, 0x4a6a92, 0xb08a3a, 0x5c8a5c, 0x8a5a8a];
const FLEECE = 0xdcd6c4;

export interface DecorContext {
  /** World position and height → screen point. */
  project(wx: number, wy: number, h: number): Point;
  groundAt(wx: number, wy: number): number;
  isPlan: boolean;
  /** Which way the year has turned. Trees are how the calendar becomes visible. */
  season: Season;
}

/**
 * How each species is built (design/07 — the tree half of the mass grammar
 * argument).
 *
 * A tree drawn as a stick with three circles on it is a lollipop, and every
 * lollipop on the map is the same lollipop. What actually reads at this scale is
 * not branch structure — you cannot see a twig from here — it is **silhouette**:
 * how wide against how tall, how dense, whether the mass sits high on the trunk
 * or hangs down over it. Six species with genuinely different profiles do far
 * more than one species with better detail, and cost less.
 *
 * `spread` is crown width against the item's size, `lift` how high up the trunk
 * the mass sits, `droop` how much the blobs hang below their centre, `blobs` how
 * many pieces the canopy is made of, and `slim` narrows the whole crown.
 */
interface Profile {
  spread: number;
  lift: number;
  droop: number;
  blobs: number;
  slim: number;
  trunk: number;
  bark: number;
  /** Keeps its leaves through the winter. */
  evergreen?: boolean;
}

const PROFILES: Record<TreeSpecies, Profile> = {
  // Broad, heavy, low-slung. The tree a field corner has in it.
  oak: { spread: 1.15, lift: 0.5, droop: 0.16, blobs: 9, slim: 1, trunk: 0.2, bark: 0x5e4634 },
  // Tall, light and open, on a pale trunk — the one that stands out in a wood.
  birch: { spread: 0.62, lift: 0.62, droop: 0.05, blobs: 6, slim: 0.72, trunk: 0.1, bark: 0xc4bfae },
  // Wide and weeping, and it hangs *over* its own trunk.
  willow: { spread: 1.25, lift: 0.36, droop: 0.52, blobs: 11, slim: 1.05, trunk: 0.17, bark: 0x6a5741 },
  // A column. Nothing else in the landscape is this shape.
  poplar: { spread: 0.44, lift: 0.34, droop: 0, blobs: 8, slim: 0.42, trunk: 0.09, bark: 0x6f6250 },
  pine: { spread: 0.9, lift: 0.2, droop: 0, blobs: 0, slim: 1, trunk: 0.13, bark: 0x53412f, evergreen: true },
  // Small, scrubby, wind-bent. Marks ground nothing better will grow on.
  thorn: { spread: 0.95, lift: 0.34, droop: 0.2, blobs: 6, slim: 0.9, trunk: 0.15, bark: 0x554434 },
};

/**
 * Foliage through the year — and the reason this is worth doing at all.
 *
 * The calendar already drives the harvest, the labour and what the town eats,
 * but until now the only way to *see* what month it was was to read a text plate
 * in the corner. Turning the trees puts it in the picture: **the season is
 * something you notice out of the window rather than something you look up.**
 * Winter goes further and takes the leaves off entirely, so a bare wood is a
 * different landscape from a summer one and the year visibly has a shape.
 */
interface Foliage {
  tint: number;
  /** How strongly to push toward the tint. */
  mix: number;
  /** 0 = in full leaf, 1 = bare. Evergreens ignore it. */
  bare: number;
}

const SEASONS: Record<Season, Foliage> = {
  spring: { tint: 0xa8c25a, mix: 0.36, bare: 0.12 },
  summer: { tint: 0x3f6f34, mix: 0.22, bare: 0 },
  autumn: { tint: 0xc98a2e, mix: 0.55, bare: 0.2 },
  winter: { tint: 0x8a8a76, mix: 0.55, bare: 1 },
};

function pick(palette: number[], variant: number): number {
  return palette[Math.min(palette.length - 1, Math.floor(variant * palette.length))];
}

/**
 * Anything green and growing, turned to the season.
 *
 * Hedges, garden rows and the crops in a plot are as much of the green in a
 * close view as the trees are, so leaving them summer-bright while the wood goes
 * bare puts the picture at odds with itself.
 */
function seasonal(colour: number, ctx: DecorContext): number {
  const f = SEASONS[ctx.season];
  return mixTo(colour, f.tint, f.mix * 0.7);
}

/** An upright box, used for hedges, walls, woodpiles and carts. */
function box(
  g: Graphics,
  ctx: DecorContext,
  centre: Vec2,
  halfLength: number,
  halfWidth: number,
  angle: number,
  height: number,
  colour: number,
): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Vec2[] = [
    [-halfLength, -halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
  ].map(([dx, dy]) => ({
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  }));

  const ground = ctx.groundAt(centre.x, centre.y);

  if (ctx.isPlan) {
    const pts: number[] = [];
    for (const c of corners) {
      const p = ctx.project(c.x, c.y, ground);
      pts.push(p.x, p.y);
    }
    g.poly(pts).fill(colour);
    return;
  }

  const base = corners.map((c) => ctx.project(c.x, c.y, ground));
  const top = corners.map((c) => ctx.project(c.x, c.y, ground + height));

  const faces = [0, 1, 2, 3]
    .map((i) => {
      const j = (i + 1) % 4;
      return { i, j, depth: corners[i].x + corners[i].y + corners[j].x + corners[j].y };
    })
    .sort((a, b) => a.depth - b.depth);

  for (const f of faces) {
    g.poly([
      top[f.i].x, top[f.i].y,
      top[f.j].x, top[f.j].y,
      base[f.j].x, base[f.j].y,
      base[f.i].x, base[f.i].y,
    ]).fill(shade(colour, -0.22));
  }

  g.poly([
    top[0].x, top[0].y, top[1].x, top[1].y, top[2].x, top[2].y, top[3].x, top[3].y,
  ]).fill(shade(colour, 0.08));
}

export function drawDecorItem(g: Graphics, ctx: DecorContext, item: DecorItem): void {
  const ground = ctx.groundAt(item.pos.x, item.pos.y);

  switch (item.kind) {
    case 'tree':
    case 'bush': {
      drawTree(g, ctx, item);
      return;
    }

    case 'conifer': {
      const colour = pick(CONIFER, item.variant);
      if (ctx.isPlan) {
        const p = ctx.project(item.pos.x, item.pos.y, ground);
        g.circle(p.x, p.y, item.size * 0.85).fill(colour);
        return;
      }

      const base = ctx.project(item.pos.x, item.pos.y, ground);
      const tip = ctx.project(item.pos.x, item.pos.y, ground + item.height);
      const w = Math.max(0.3, item.size * 0.14);
      g.poly([
        base.x - w, base.y, base.x + w, base.y,
        base.x + w, base.y - 2, base.x - w, base.y - 2,
      ]).fill(TRUNK);

      // Three stacked skirts make a fir rather than a cone.
      for (let tier = 0; tier < 3; tier++) {
        const t = tier / 3;
        const bottom = ctx.project(
          item.pos.x,
          item.pos.y,
          ground + item.height * (0.12 + t * 0.32),
        );
        const width = item.size * (1.05 - t * 0.3);
        const apexY = tip.y + (bottom.y - tip.y) * (t * 0.42);
        g.poly([
          bottom.x - width, bottom.y,
          bottom.x + width, bottom.y,
          bottom.x, apexY,
        ]).fill(shade(colour, tier * 0.07 - 0.06));
      }
      return;
    }

    case 'hedge':
      box(g, ctx, item.pos, item.size, 0.75, item.angle, item.height,
        seasonal(shade(HEDGE, (item.variant - 0.5) * 0.16), ctx));
      return;

    case 'wall':
      box(g, ctx, item.pos, item.size, 0.45, item.angle, item.height,
        shade(WALL_STONE, (item.variant - 0.5) * 0.14));
      return;

    case 'gardenRow': {
      // Flat on the ground: a tilled row with something growing in it.
      const cos = Math.cos(item.angle);
      const sin = Math.sin(item.angle);
      const halfW = 0.85;
      const corners: Vec2[] = [
        [-item.size, -halfW],
        [item.size, -halfW],
        [item.size, halfW],
        [-item.size, halfW],
      ].map(([dx, dy]) => ({
        x: item.pos.x + dx * cos - dy * sin,
        y: item.pos.y + dx * sin + dy * cos,
      }));

      const pts: number[] = [];
      for (const c of corners) {
        const p = ctx.project(c.x, c.y, ctx.groundAt(c.x, c.y));
        pts.push(p.x, p.y);
      }
      g.poly(pts).fill(SOIL);

      if (!ctx.isPlan) {
        const n = Math.max(2, Math.round(item.size));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          const x = item.pos.x + (t - 0.5) * 2 * item.size * cos;
          const y = item.pos.y + (t - 0.5) * 2 * item.size * sin;
          const p = ctx.project(x, y, ctx.groundAt(x, y) + 0.5);
          g.circle(p.x, p.y, 0.62).fill(seasonal(CROP, ctx));
        }
      }
      return;
    }

    case 'woodpile':
      box(g, ctx, item.pos, item.size, item.size * 0.5, item.angle, item.height, TIMBER);
      return;

    case 'barrel':
      box(g, ctx, item.pos, item.size, item.size, item.angle, item.height,
        shade(TIMBER, -0.15));
      return;

    case 'cart':
      box(g, ctx, item.pos, item.size, item.size * 0.45, item.angle, item.height * 0.7,
        shade(TIMBER, 0.06));
      box(g, ctx, item.pos, item.size * 0.2, item.size * 0.5, item.angle, item.height * 0.35,
        IRON);
      return;

    case 'stone':
      box(g, ctx, item.pos, item.size, 0.18, item.angle, item.height, GRAVE);
      return;

    case 'fieldStrip': {
      // Flat on the ground, with a furrow line down it so it reads as ploughed.
      const cos = Math.cos(item.angle);
      const sin = Math.sin(item.angle);
      const corners: Vec2[] = [
        [-item.size, -item.height],
        [item.size, -item.height],
        [item.size, item.height],
        [-item.size, item.height],
      ].map(([dx, dy]) => ({
        x: item.pos.x + dx * cos - dy * sin,
        y: item.pos.y + dx * sin + dy * cos,
      }));

      const pts: number[] = [];
      for (const c of corners) {
        const p = ctx.project(c.x, c.y, ctx.groundAt(c.x, c.y));
        pts.push(p.x, p.y);
      }
      const crop = pick(CROPS, item.variant);
      g.poly(pts).fill(crop);

      if (!ctx.isPlan) {
        for (const off of [-0.45, 0, 0.45]) {
          const a = {
            x: item.pos.x - cos * item.size - sin * item.height * off,
            y: item.pos.y - sin * item.size + cos * item.height * off,
          };
          const bEnd = {
            x: item.pos.x + cos * item.size - sin * item.height * off,
            y: item.pos.y + sin * item.size + cos * item.height * off,
          };
          const pa = ctx.project(a.x, a.y, ctx.groundAt(a.x, a.y));
          const pb = ctx.project(bEnd.x, bEnd.y, ctx.groundAt(bEnd.x, bEnd.y));
          g.poly([pa.x, pa.y - 0.18, pb.x, pb.y - 0.18, pb.x, pb.y + 0.18, pa.x, pa.y + 0.18])
            .fill(shade(crop, -0.14));
        }
      }
      return;
    }

    case 'stall': {
      const canopy = pick(AWNING, item.variant);
      if (ctx.isPlan) {
        const p = ctx.project(item.pos.x, item.pos.y, ground);
        g.circle(p.x, p.y, item.size * 0.8).fill(canopy);
        return;
      }

      // A trestle under a striped awning, which is a market in one shape.
      box(g, ctx, item.pos, item.size * 0.75, item.size * 0.5, item.angle,
        item.height * 0.45, TIMBER);

      const cos = Math.cos(item.angle);
      const sin = Math.sin(item.angle);
      const corners: Vec2[] = [
        [-item.size, -item.size * 0.62],
        [item.size, -item.size * 0.62],
        [item.size, item.size * 0.62],
        [-item.size, item.size * 0.62],
      ].map(([dx, dy]) => ({
        x: item.pos.x + dx * cos - dy * sin,
        y: item.pos.y + dx * sin + dy * cos,
      }));

      const eaveH = ground + item.height * 0.78;
      const ridgeH = ground + item.height;
      const eave = corners.map((c) => ctx.project(c.x, c.y, eaveH));
      const ridgeA = ctx.project(
        item.pos.x - cos * item.size,
        item.pos.y - sin * item.size,
        ridgeH,
      );
      const ridgeB = ctx.project(
        item.pos.x + cos * item.size,
        item.pos.y + sin * item.size,
        ridgeH,
      );

      g.poly([
        eave[0].x, eave[0].y, eave[1].x, eave[1].y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ]).fill(shade(canopy, 0.1));
      g.poly([
        eave[3].x, eave[3].y, eave[2].x, eave[2].y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ]).fill(shade(canopy, -0.18));
      return;
    }

    case 'sheep': {
      if (ctx.isPlan) {
        const p = ctx.project(item.pos.x, item.pos.y, ground);
        g.circle(p.x, p.y, item.size * 0.7).fill(FLEECE);
        return;
      }
      const body = ctx.project(item.pos.x, item.pos.y, ground + item.height * 0.55);
      const base = ctx.project(item.pos.x, item.pos.y, ground);
      g.ellipse(base.x, base.y, item.size * 0.62, item.size * 0.3)
        .fill({ color: 0x2f3a2c, alpha: 0.22 });
      g.ellipse(body.x, body.y, item.size * 0.78, item.size * 0.5).fill(FLEECE);
      g.circle(
        body.x + Math.cos(item.angle) * item.size * 0.62,
        body.y - item.size * 0.12,
        item.size * 0.3,
      ).fill(0x50483f);
      return;
    }
  }
}


/** Deterministic 0..1 from a tree's variant and a salt. */
function wobble(variant: number, salt: number): number {
  const h = Math.sin(variant * 127.1 + salt * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * A tree, built from its species profile.
 *
 * The canopy is a cluster of blobs rather than one circle, on a spiral so the
 * pieces never line up, and each blob is lit by where it sits in the crown: the
 * top and the sunward side catch the key, the underside gets only the sky. That
 * is the same two-tone model the buildings use, and it is what stops a tree
 * reading as a flat green sticker.
 */
function drawTree(g: Graphics, ctx: DecorContext, item: DecorItem): void {
  const ground = ctx.groundAt(item.pos.x, item.pos.y);
  const isBush = item.kind === 'bush';
  const profile = PROFILES[item.species ?? 'oak'];
  const season = SEASONS[ctx.season];
  const bare = profile.evergreen || isBush ? 0 : season.bare;

  const base = pick(FOLIAGE, item.variant);
  const leaf = mixTo(base, season.tint, season.mix);

  if (ctx.isPlan) {
    const p = ctx.project(item.pos.x, item.pos.y, ground);
    g.circle(p.x, p.y, item.size * (isBush ? 0.8 : profile.spread * 0.9))
      .fill(shade(leaf, bare > 0.6 ? -0.3 : 0.05));
    return;
  }

  const trunkTop = ground + item.height * (isBush ? 0.15 : profile.lift);

  // Trunk: tapered, and leaning a little. A perfect vertical rectangle is most
  // of what makes the old version read as a lollipop stick.
  if (!isBush) {
    const lean = (wobble(item.variant, 3) - 0.5) * item.height * 0.07;
    const foot = ctx.project(item.pos.x, item.pos.y, ground);
    const fork = ctx.project(item.pos.x + lean, item.pos.y + lean * 0.4, trunkTop);
    const w = Math.max(0.22, item.size * profile.trunk);
    g.poly([
      foot.x - w, foot.y,
      foot.x + w, foot.y,
      fork.x + w * 0.55, fork.y,
      fork.x - w * 0.55, fork.y,
    ]).fill(profile.bark);

    // Winter: a few bare limbs where the canopy was, so a leafless tree is still
    // a tree and not a post.
    if (bare > 0.5) {
      const limbs = 3 + Math.floor(wobble(item.variant, 9) * 3);
      for (let i = 0; i < limbs; i++) {
        const a = (i / limbs) * Math.PI * 2 + wobble(item.variant, i) * 1.2;
        const reach = item.size * profile.spread * (0.55 + wobble(item.variant, i + 20) * 0.5);
        const tip = ctx.project(
          item.pos.x + lean + Math.cos(a) * reach * profile.slim,
          item.pos.y + lean * 0.4 + Math.sin(a) * reach * profile.slim,
          trunkTop + item.height * (0.18 + wobble(item.variant, i + 40) * 0.22),
        );
        g.moveTo(fork.x, fork.y).lineTo(tip.x, tip.y).stroke({
          color: profile.bark,
          width: Math.max(0.13, w * 0.45),
          alpha: 0.95,
        });
      }
    }
  }

  if (bare > 0.5) return;

  const crownH = item.height * (isBush ? 0.85 : 1 - profile.lift * 0.45);
  const count = isBush ? 5 : profile.blobs;
  const spread = item.size * (isBush ? 0.85 : profile.spread);

  // Back to front, so nearer blobs overlap further ones.
  const pieces: { x: number; y: number; z: number; r: number; l: number }[] = [];
  for (let i = 0; i < count; i++) {
    // A golden-angle spiral: even coverage, and never a visible lattice.
    const a = i * 2.39996 + item.variant * 6.28;
    const t = count === 1 ? 0 : i / (count - 1);
    const radius = spread * (0.28 + 0.72 * Math.sqrt(t)) * profile.slim;
    const dx = Math.cos(a) * radius;
    const dy = Math.sin(a) * radius * 0.85;
    // Lower blobs sit further out and hang; the crown rises toward the middle.
    const z = trunkTop + crownH * (0.62 - t * 0.34) - profile.droop * item.size * t;
    const r = spread * (0.62 - t * 0.18) * (0.85 + wobble(item.variant, i) * 0.3);
    // Lit by where the blob sits: sunward and upward catches the key.
    const l = lambertOf(dx, dy, spread * 0.9) * (1 - t * 0.55) - t * 0.3;
    pieces.push({ x: item.pos.x + dx, y: item.pos.y + dy, z, r, l });
  }
  pieces.sort((p, q) => p.x + p.y - (q.x + q.y));

  for (const piece of pieces) {
    const c = ctx.project(piece.x, piece.y, piece.z);
    g.circle(c.x, c.y, piece.r).fill(lit(leaf, piece.l, 0.1));
  }

  // A highlight on the sunward shoulder, which is what gives the mass volume.
  const top = ctx.project(
    item.pos.x - SUN.x * spread * 0.34,
    item.pos.y - SUN.y * spread * 0.34,
    trunkTop + crownH * 0.72,
  );
  g.circle(top.x, top.y, spread * 0.4).fill({ color: lit(leaf, 0.85, 0.1), alpha: 0.75 });
}

/** Mix a colour toward another by t. */
function mixTo(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((Math.round(ar + (br - ar) * t) << 16) |
      (Math.round(ag + (bg - ag) * t) << 8) |
      Math.round(ab + (bb - ab) * t)) >>> 0
  );
}
