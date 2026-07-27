import type { Fabric } from './fabric';
import { makeRng } from './rng';
import { walkRoad, type Road } from './roads';
import type { Vec2 } from './types';

/**
 * Ambient people.
 *
 * Decorative only, exactly as the decorative-logistics rule in `design/00`
 * requires: they have no needs, no errands and no intelligence. They walk the
 * street network because that is what makes a town look inhabited, and if you
 * deleted every one of them the simulation would be unchanged.
 *
 * The point is the other half of the thesis — "legible and *alive*". A still
 * town reads as a diagram.
 */

export interface Person {
  pos: Vec2;
  /** Direction of travel, for facing. */
  heading: number;
  /** Which route they're on and how far along it. */
  route: Vec2[];
  leg: number;
  along: number;
  speed: number;
  /** Palette index for clothing. */
  tint: number;
  /** Phase offset so a crowd doesn't bob in unison. */
  phase: number;
}

/** Walking pace, metres per second. */
const SLOW = 0.9;
const FAST = 1.6;

/** One person per this many buildings' worth of town, capped. */
const PER_BUILDING = 3;
const MAX_PEOPLE = 150;

export class Crowd {
  people: Person[] = [];
  private routes: Vec2[][] = [];

  /** Rebuild routes and repopulate. Called when the street network changes. */
  reset(roads: readonly Road[], fabric: Fabric, buildingCount: number, seed: number): void {
    this.routes = [];

    for (const road of roads) {
      const pts: Vec2[] = [];
      walkRoad(road, 5, (p) => pts.push(p));
      if (pts.length >= 2) this.routes.push(pts);
    }
    for (const path of fabric.paths) {
      if (path.length >= 2) this.routes.push(path.map((p) => ({ x: p.x, y: p.y })));
    }

    const wanted = Math.min(MAX_PEOPLE, Math.floor(buildingCount * PER_BUILDING));
    this.people = [];
    if (this.routes.length === 0 || wanted === 0) return;

    const rng = makeRng(seed ^ 0x9a1c);
    for (let i = 0; i < wanted; i++) {
      const route = this.routes[Math.floor(rng() * this.routes.length)];
      const leg = Math.floor(rng() * (route.length - 1));
      this.people.push({
        pos: { x: route[leg].x, y: route[leg].y },
        heading: 0,
        route,
        leg,
        along: rng(),
        speed: SLOW + rng() * (FAST - SLOW),
        tint: Math.floor(rng() * 6),
        phase: rng() * Math.PI * 2,
      });
    }
  }

  /**
   * Advance everyone. Driven by real elapsed time rather than the sim tick,
   * because walking at 10Hz looks like stop-motion — and since none of this
   * feeds back into the simulation, it costs nothing to let it run free.
   */
  update(dt: number): void {
    if (this.routes.length === 0) return;
    const step = Math.min(dt, 0.1);

    for (const person of this.people) {
      let remaining = person.speed * step;

      while (remaining > 0) {
        const from = person.route[person.leg];
        const to = person.route[person.leg + 1];
        if (!to) {
          this.rehome(person);
          break;
        }

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-4) {
          person.leg++;
          person.along = 0;
          continue;
        }

        person.heading = Math.atan2(dy, dx);

        const travelled = person.along * length;
        const left = length - travelled;

        if (remaining < left) {
          person.along += remaining / length;
          remaining = 0;
        } else {
          remaining -= left;
          person.leg++;
          person.along = 0;
          if (person.leg >= person.route.length - 1) {
            this.rehome(person);
            break;
          }
        }
      }

      const from = person.route[person.leg];
      const to = person.route[Math.min(person.leg + 1, person.route.length - 1)];
      person.pos = {
        x: from.x + (to.x - from.x) * person.along,
        y: from.y + (to.y - from.y) * person.along,
      };
    }
  }

  /**
   * Pick a new route starting near where they are. The network is dense enough
   * that the nearest endpoint is usually a step away, so the switch reads as
   * turning a corner rather than teleporting.
   */
  private rehome(person: Person): void {
    let best: Vec2[] | null = null;
    let bestFromStart = true;
    let bestD2 = Infinity;

    for (const route of this.routes) {
      if (route === person.route) continue;

      const start = route[0];
      const end = route[route.length - 1];
      const dStart = (start.x - person.pos.x) ** 2 + (start.y - person.pos.y) ** 2;
      const dEnd = (end.x - person.pos.x) ** 2 + (end.y - person.pos.y) ** 2;

      if (dStart < bestD2) {
        bestD2 = dStart;
        best = route;
        bestFromStart = true;
      }
      if (dEnd < bestD2) {
        bestD2 = dEnd;
        best = route;
        bestFromStart = false;
      }
    }

    if (!best) {
      // Nowhere else to go: turn round and walk back.
      person.route = [...person.route].reverse();
      person.leg = 0;
      person.along = 0;
      return;
    }

    person.route = bestFromStart ? best : [...best].reverse();
    person.leg = 0;
    person.along = 0;
  }
}
