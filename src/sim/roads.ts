import type { Vec2 } from './types';

/**
 * Roads are *intentional*. The player draws them, and they are a different kind
 * of thing from the desire paths in fabric.ts, which the town wears into the
 * ground by itself.
 *
 * The relationship between the two is the whole point (design/05):
 *
 *   A road is a cheap corridor. Once one exists, journeys use it for the trunk
 *   of the trip, so all the desire paths still needed are short spurs from a
 *   frontage to the nearest road.
 *
 * That makes the planned/organic dial continuous and physical rather than a mode
 * switch. Draw no roads and you get a rambling settlement threaded with tracks.
 * Draw plenty and you get a formal town with lanes behind. Draw some and you get
 * what a real British town actually is.
 */

export type RoadClass = 'lane' | 'street' | 'high';

export interface Road {
  id: number;
  /** Player-drawn polyline in world metres. */
  points: Vec2[];
  cls: RoadClass;
  /**
   * Assigned once, from the character the road ran through at the time, and
   * never revised. A street called Tanner's Row keeps the name long after the
   * tannery has gone — which is the town remembering (design/00, Pillar E).
   */
  name?: string;
}

export const ROAD_HALF_WIDTH: Record<RoadClass, number> = {
  lane: 2.2,
  street: 3.4,
  high: 5,
};

/** How cheap a road is to travel compared with open ground. */
export const ROAD_COST = 0.18;

export interface RoadHit {
  /** Nearest point on the road centreline. */
  point: Vec2;
  /** Direction of the road there, in radians. */
  angle: number;
  distance: number;
  halfWidth: number;
  road: Road;
}

/** Nearest point on any road, or null if none is within `maxDistance`. */
export function nearestRoad(
  roads: readonly Road[],
  pos: Vec2,
  maxDistance = Infinity,
): RoadHit | null {
  let best: RoadHit | null = null;

  for (const road of roads) {
    const halfWidth = ROAD_HALF_WIDTH[road.cls];

    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const near = closestPointOnSegment(pos, a, b);
      const distance = Math.hypot(pos.x - near.x, pos.y - near.y);
      if (distance > maxDistance) continue;
      if (best && distance >= best.distance) continue;

      best = {
        point: near,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        distance,
        halfWidth,
        road,
      };
    }
  }

  return best;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Walk a road's centreline, calling back at roughly `step` metre intervals.
 * Used for rasterising into the routing grid and for drawing.
 */
export function walkRoad(road: Road, step: number, fn: (p: Vec2) => void): void {
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i];
    const b = road.points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      fn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
}

export function roadLength(road: Road): number {
  let total = 0;
  for (let i = 0; i < road.points.length - 1; i++) {
    total += Math.hypot(
      road.points[i + 1].x - road.points[i].x,
      road.points[i + 1].y - road.points[i].y,
    );
  }
  return total;
}
