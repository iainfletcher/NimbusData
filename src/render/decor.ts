import { Graphics } from 'pixi.js';
import type { DecorItem, Vec2 } from '../sim';
import { shade } from './palette';
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

export interface DecorContext {
  /** World position and height → screen point. */
  project(wx: number, wy: number, h: number): Point;
  groundAt(wx: number, wy: number): number;
  isPlan: boolean;
}

function pick(palette: number[], variant: number): number {
  return palette[Math.min(palette.length - 1, Math.floor(variant * palette.length))];
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
      const isBush = item.kind === 'bush';
      const trunkHeight = isBush ? item.height * 0.15 : item.height * 0.45;
      const colour = pick(FOLIAGE, item.variant);

      if (ctx.isPlan) {
        const p = ctx.project(item.pos.x, item.pos.y, ground);
        g.circle(p.x, p.y, item.size).fill(shade(colour, 0.05));
        return;
      }

      if (!isBush) {
        const base = ctx.project(item.pos.x, item.pos.y, ground);
        const fork = ctx.project(item.pos.x, item.pos.y, ground + trunkHeight);
        const w = Math.max(0.35, item.size * 0.16);
        g.poly([
          base.x - w, base.y, base.x + w, base.y, fork.x + w, fork.y, fork.x - w, fork.y,
        ]).fill(TRUNK);
      }

      // A canopy of two overlapping blobs reads rounder than a single circle.
      const crown = ctx.project(item.pos.x, item.pos.y, ground + item.height * 0.82);
      const under = ctx.project(item.pos.x, item.pos.y, ground + trunkHeight + item.size * 0.5);
      g.circle(under.x, under.y, item.size * 0.92).fill(shade(colour, -0.2));
      g.circle(crown.x, crown.y, item.size * 0.78).fill(colour);
      g.circle(
        crown.x - item.size * 0.24,
        crown.y - item.size * 0.24,
        item.size * 0.42,
      ).fill(shade(colour, 0.14));
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
        shade(HEDGE, (item.variant - 0.5) * 0.16));
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
          g.circle(p.x, p.y, 0.62).fill(CROP);
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
  }
}
