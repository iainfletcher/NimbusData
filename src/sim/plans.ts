import type { RoadClass } from './roads';
import type { Vec2 } from './types';

/**
 * Planned fabric (design/05 §2).
 *
 * The authorship half of the dial, and until now the missing half: the player
 * could draw a road freehand and sculpt ground, but could not *compose*. A
 * crescent, a square and a grid are the three layouts that between them cover
 * most of what deliberate British town-planning actually did.
 *
 * The implementation is deliberately thin, and that thinness is the design
 * insight: **a plan is nothing but a road generator.** Frontage snapping already
 * aligns buildings to whatever road they are placed against, so laying a curved
 * road *is* laying out a crescent — the buildings that follow will sit on its
 * arc at a consistent setback without any further machinery.
 *
 * Planned fabric costing more than organic fabric therefore also falls out for
 * free: these lay a lot of road, and road is paid for in stone by the metre.
 */

export type PlanKind = 'crescent' | 'square' | 'grid' | 'terrace';

export interface PlannedRoad {
  points: Vec2[];
  cls: RoadClass;
}

export interface PlanSpec {
  kind: PlanKind;
  /** Where the plan is centred. */
  at: Vec2;
  /** Overall size in metres. */
  size: number;
  /** Rotation in radians. */
  angle: number;
}

/**
 * Turn a plan into the roads it consists of. Nothing is placed and nothing is
 * reserved — the roads are the plan.
 */
export function planRoads(spec: PlanSpec): PlannedRoad[] {
  switch (spec.kind) {
    case 'terrace':
      return [terrace(spec)];
    case 'crescent':
      return [crescent(spec)];
    case 'square':
      return square(spec);
    case 'grid':
      return grid(spec);
  }
}

/** A straight run, for a plain terraced street. */
function terrace(spec: PlanSpec): PlannedRoad {
  const half = spec.size / 2;
  const dx = Math.cos(spec.angle);
  const dy = Math.sin(spec.angle);
  return {
    cls: 'street',
    points: [
      { x: spec.at.x - dx * half, y: spec.at.y - dy * half },
      { x: spec.at.x + dx * half, y: spec.at.y + dy * half },
    ],
  };
}

/**
 * A shallow arc. Georgian rather than a semicircle — a full half-circle reads as
 * a roundabout at this scale, whereas a gentle bow reads as Bath.
 */
function crescent(spec: PlanSpec): PlannedRoad {
  const radius = spec.size * 0.85;
  const sweep = Math.PI * 0.62;
  const steps = 14;
  const points: Vec2[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = spec.angle - sweep / 2 + sweep * t;
    points.push({
      x: spec.at.x + Math.cos(a) * radius,
      // Pull the arc back toward its chord so the centre is not left stranded.
      y: spec.at.y + Math.sin(a) * radius,
    });
  }

  return { cls: 'street', points };
}

/** Four sides round an open middle: the classic market or garden square. */
function square(spec: PlanSpec): PlannedRoad[] {
  const half = spec.size / 2;
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);

  const corner = (dx: number, dy: number): Vec2 => ({
    x: spec.at.x + dx * cos - dy * sin,
    y: spec.at.y + dx * sin + dy * cos,
  });

  const c0 = corner(-half, -half);
  const c1 = corner(half, -half);
  const c2 = corner(half, half);
  const c3 = corner(-half, half);

  return [{ cls: 'street', points: [c0, c1, c2, c3, c0] }];
}

/** A regular block of streets. Deliberate, expensive, and slightly inhuman. */
function grid(spec: PlanSpec): PlannedRoad[] {
  const lines = 3;
  const half = spec.size / 2;
  const spacing = spec.size / (lines - 1);
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);

  const at = (u: number, v: number): Vec2 => ({
    x: spec.at.x + u * cos - v * sin,
    y: spec.at.y + u * sin + v * cos,
  });

  const roads: PlannedRoad[] = [];
  for (let i = 0; i < lines; i++) {
    const offset = -half + spacing * i;
    roads.push({ cls: 'street', points: [at(-half, offset), at(half, offset)] });
    roads.push({ cls: 'lane', points: [at(offset, -half), at(offset, half)] });
  }
  return roads;
}
