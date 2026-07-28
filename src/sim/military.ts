import { buildingType } from './buildings';
import type { Conductance } from './conductance';
import { GeodesicFlood } from './flood';
import type { Terrain } from './terrain';
import {
  CELL_SIZE,
  OWNER_COUNT,
  WORLD_CELLS,
  WORLD_SIZE,
  type Building,
  type Vec2,
} from './types';

/**
 * Military pressure and warbands (design/01 §2–§3) — the other half of the lead
 * pillar, and the half that had never been built.
 *
 * The design's one-line claim is:
 *
 * > **Military pressure takes land. Cultural pressure converts it. So the way you
 * > defend a border is by building a town people want to live in.**
 *
 * That only means anything if the two fields are genuinely unalike, so every
 * property here is the deliberate opposite of the one in `territory.ts`:
 *
 * | | Military (here) | Cultural (`territory.ts`) |
 * |---|---|---|
 * | Source | Discrete points you build | The whole town, earned |
 * | Onset | Immediate | Slow accumulation |
 * | Falloff | Hard edge, tight radius | Gentle, long tail |
 * | If the source goes | Collapses the same tick | Lingers for a long time |
 * | Upkeep | Food, continuously, forever | None |
 * | Effect on land | **Holds** it | **Converts** it |
 *
 * Neither can do the other's job, which is what stops one being a better version
 * of the other. Soldiers can take ground *now*, and are the only thing that can
 * take ground somebody else is actively defending — but they never make it
 * yours, and they never stop eating.
 *
 * Pressure spreads geodesically, exactly as culture does, so a tower does not
 * hold across a river it cannot cross.
 */

/** Below this nobody is holding anything — it is just open country. */
const HOLD_THRESHOLD = 0.18;

/**
 * How decisively one side must out-push the other to actually hold ground.
 * Inside the margin the ground is *contested*: nobody holds it, and that is the
 * state a battle line sits in.
 */
const HOLD_MARGIN = 1.16;

/** Fraction of a source's reach given over to its falloff. Small = hard edge. */
const EDGE_FRACTION = 0.22;

/** Metres a warband covers per tick. */
const MARCH_SPEED = 5.2;

/** How near a warband must be to its target before it is considered arrived. */
const ARRIVE_RADIUS = 8;

/** Reach of a warband's own pressure, in metres. */
const WARBAND_REACH = 74;

/** Peak strength a warband at full health projects. */
const WARBAND_STRENGTH = 1.15;

/** Metres from integrated ground within which a warband is still fed. */
const SUPPLY_RANGE = 150;

/** Strength lost per tick out of supply, and regained per tick in it. */
const STARVE_RATE = 0.011;
const RECOVER_RATE = 0.02;

/** Metres at which opposing warbands are in contact. */
const CLASH_RANGE = 34;

/** Attrition per tick in contact, scaled by the opponent's strength. */
const CLASH_RATE = 0.055;

/** Ticks a warband must hold the ground under an enemy garrison to throw it down. */
const SIEGE_TICKS = 55;

/** What raising a warband costs, and how long a keep needs between musters. */
export const MUSTER_COST = { timber: 25, food: 40 };
export const MUSTER_COOLDOWN = 70;

/** Food per tick a warband in the field eats. Soldiers cost more than walls. */
export const WARBAND_UPKEEP = 0.09;

/**
 * Cost ceiling on a march. Generous enough to cross the map by any sane route
 * and low enough that "swim the length of a lake" is not a route.
 */
const ROUTE_BUDGET = 2600;

const ROUTE_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const ROUTE_DY = [0, 0, 1, -1, 1, -1, 1, -1];

function cellOf(p: Vec2): number {
  const cx = Math.floor(p.x / CELL_SIZE);
  const cy = Math.floor(p.y / CELL_SIZE);
  if (cx < 0 || cy < 0 || cx >= WORLD_CELLS || cy >= WORLD_CELLS) return -1;
  return cy * WORLD_CELLS + cx;
}

export interface Warband {
  id: number;
  owner: number;
  pos: Vec2;
  /** Where it has been told to go. Null means it stands where it is. */
  target: Vec2 | null;
  /**
   * Waypoints still to walk. Computed once when the order is given, by flooding
   * the same cost field culture travels on — so a column routes round a lake
   * instead of standing in it, and, because roads are cheap in that field,
   * **armies march on roads**. That was not designed in; it fell out of reusing
   * the conductance, and it is the right behaviour.
   */
  route: Vec2[];
  /** 0..1. What it projects, and what it has left to lose. */
  strength: number;
  /** Whether it is drawing supply, which is the only thing that feeds it. */
  supplied: boolean;
  /** Radians. Kept so it can be drawn facing the way it is going. */
  bearing: number;
  /** Ticks spent sitting on top of an enemy garrison. */
  siege: number;
}

/** What the territory layer needs to know to answer "who holds this". */
export interface HoldSource {
  owner: number;
  pos: Vec2;
  strength: number;
  reach: number;
}

/**
 * The military field: instantaneous pressure per owner, plus the warbands that
 * are half of what generates it.
 *
 * There is no hysteresis anywhere in this class, and that is the point. Culture
 * has a settled claim that drifts; military pressure is simply recomputed, so
 * losing the last tower on a frontier loses the frontier the same tick.
 */
export class Military {
  readonly width = WORLD_CELLS;
  readonly height = WORLD_CELLS;

  readonly pressure: Float32Array[] = [];
  readonly warbands: Warband[] = [];

  private flood = new GeodesicFlood();
  private routeCost = new Float32Array(WORLD_CELLS * WORLD_CELLS);
  private nextId = 1;
  /** Set while any source exists, so an empty field can skip the whole scan. */
  private live = false;

  constructor() {
    const n = this.width * this.height;
    for (let i = 0; i < OWNER_COUNT; i++) this.pressure.push(new Float32Array(n));
  }

  /** Recompute pressure from scratch. Cheap because sources are few. */
  update(buildings: readonly Building[], conductance: Conductance): void {
    for (const layer of this.pressure) layer.fill(0);
    this.live = false;

    for (const source of this.sources(buildings)) {
      const cx = Math.floor(source.pos.x / CELL_SIZE);
      const cy = Math.floor(source.pos.y / CELL_SIZE);
      if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) continue;

      this.live = true;
      const layer = this.pressure[source.owner];
      const reach = source.reach / CELL_SIZE;

      this.flood.run(conductance, cy * this.width + cx, reach, (cell, cost) => {
        // Full strength across most of the radius, then a short ramp to nothing.
        // Culture uses `t * t` for a long soft tail; this is the opposite shape
        // on purpose, and it is what makes a military border read as a drawn
        // line rather than a haze (design/01 §6).
        const t = 1 - cost / reach;
        const v = source.strength * Math.min(1, t / EDGE_FRACTION);
        if (v > layer[cell]) layer[cell] = v;
      });
    }
  }

  /** Every point projecting military pressure: garrisons, then warbands. */
  private *sources(buildings: readonly Building[]): Generator<HoldSource> {
    for (const b of buildings) {
      const g = buildingType(b.typeId).garrison;
      if (!g) continue;
      yield { owner: b.owner, pos: b.pos, strength: g.strength, reach: g.reach };
    }
    for (const w of this.warbands) {
      yield {
        owner: w.owner,
        pos: w.pos,
        strength: WARBAND_STRENGTH * w.strength,
        reach: WARBAND_REACH * (0.5 + 0.5 * w.strength),
      };
    }
  }

  /**
   * Who is holding a cell, or null for nobody.
   *
   * Null covers two very different situations that behave identically for the
   * purposes of culture: open country nobody has soldiers near, and a contested
   * band where two sides are pushing hard enough to cancel out. The second is a
   * battle line, and leaving it unheld is what lets culture keep flowing across
   * a stalemate.
   */
  holderAtCell(cx: number, cy: number): number | null {
    if (!this.live) return null;
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return null;

    const i = cy * this.width + cx;
    let best = -1;
    let bestValue = 0;
    let runnerUp = 0;

    for (let o = 0; o < OWNER_COUNT; o++) {
      const v = this.pressure[o][i];
      if (v > bestValue) {
        runnerUp = bestValue;
        bestValue = v;
        best = o;
      } else if (v > runnerUp) {
        runnerUp = v;
      }
    }

    if (bestValue < HOLD_THRESHOLD) return null;
    if (runnerUp > 0 && bestValue < runnerUp * HOLD_MARGIN) return null;
    return best;
  }

  holderAt(wx: number, wy: number): number | null {
    return this.holderAtCell(Math.floor(wx / CELL_SIZE), Math.floor(wy / CELL_SIZE));
  }

  /** True where two sides are pushing and neither is winning — the battle line. */
  contestedAtCell(cx: number, cy: number): boolean {
    if (!this.live) return false;
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return false;

    const i = cy * this.width + cx;
    const a = this.pressure[0][i];
    const b = this.pressure[1][i];
    const low = Math.min(a, b);
    return low >= HOLD_THRESHOLD && Math.max(a, b) < low * HOLD_MARGIN;
  }

  /** Total pressure of an owner at a cell, for the renderer. */
  strengthAtCell(owner: number, cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return 0;
    return this.pressure[owner][cy * this.width + cx];
  }

  get anyPresence(): boolean {
    return this.live;
  }

  // ---- Warbands ----------------------------------------------------------

  muster(owner: number, at: Vec2): Warband {
    const band: Warband = {
      id: this.nextId++,
      owner,
      pos: { x: at.x, y: at.y },
      target: null,
      route: [],
      strength: 1,
      supplied: true,
      bearing: 0,
      siege: 0,
    };
    this.warbands.push(band);
    return band;
  }

  /**
   * Give a column its marching orders, routing it over the cost field.
   *
   * Flood outward from the *destination*, then walk downhill from where the
   * column is standing. One flood answers the whole route, and because the field
   * is the one roads are cheap in, the descent naturally picks up a road and
   * follows it — which is both correct and much nicer to watch than a straight
   * line across country.
   *
   * Falls back to steering straight at the target if nothing connects, so an
   * order is never silently dropped.
   */
  order(band: Warband, to: Vec2, conductance: Conductance): void {
    band.target = { x: to.x, y: to.y };
    band.route = this.findRoute(band.pos, to, conductance);
  }

  private findRoute(from: Vec2, to: Vec2, conductance: Conductance): Vec2[] {
    const w = this.width;
    const toCell = cellOf(to);
    const fromCell = cellOf(from);
    if (toCell < 0 || fromCell < 0 || toCell === fromCell) return [];

    const cost = this.routeCost;
    cost.fill(Infinity);
    this.flood.run(conductance, toCell, ROUTE_BUDGET, (cell, c) => {
      cost[cell] = c;
    });

    if (!Number.isFinite(cost[fromCell])) return [];

    // Descend the cost field. Each step must strictly improve, so this cannot
    // loop; the guard is a belt-and-braces bound on a 256×256 grid.
    const route: Vec2[] = [];
    let cell = fromCell;
    for (let guard = 0; guard < w * 4 && cell !== toCell; guard++) {
      const cx = cell % w;
      const cy = (cell / w) | 0;
      let best = -1;
      let bestCost = cost[cell];

      for (let d = 0; d < 8; d++) {
        const nx = cx + ROUTE_DX[d];
        const ny = cy + ROUTE_DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
        const ni = ny * w + nx;
        if (cost[ni] < bestCost) {
          bestCost = cost[ni];
          best = ni;
        }
      }

      if (best < 0) break;
      cell = best;
      // One waypoint every few cells: a column does not need a turn per metre,
      // and the straight runs between them are what make it read as a march.
      if (route.length === 0 || guard % 4 === 0) {
        route.push({
          x: ((cell % w) + 0.5) * CELL_SIZE,
          y: (((cell / w) | 0) + 0.5) * CELL_SIZE,
        });
      }
    }

    route.push({ x: to.x, y: to.y });
    return route;
  }

  bandsOf(owner: number): Warband[] {
    return this.warbands.filter((w) => w.owner === owner);
  }

  bandNear(pos: Vec2, maxDistance: number, owner?: number): Warband | null {
    let best: Warband | null = null;
    let bestD = maxDistance;
    for (const w of this.warbands) {
      if (owner !== undefined && w.owner !== owner) continue;
      const d = Math.hypot(w.pos.x - pos.x, w.pos.y - pos.y);
      if (d <= bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  /**
   * Advance every warband one tick: march, eat, fight, besiege.
   *
   * `integratedAt` is passed in rather than looked up, because supply is the one
   * place the military system is *deliberately* dependent on the cultural one —
   * §3's rule that you cannot chain conquests, since supply runs from integrated
   * ground only and never from ground you merely hold. It is what forces a
   * conqueror to stop and become a city-builder between wars.
   */
  advance(
    terrain: Terrain,
    integratedAt: (wx: number, wy: number) => number | null,
    onRaze: (building: Building) => void,
    buildings: readonly Building[],
    onLost?: (band: Warband, starved: boolean) => void,
  ): void {
    for (const w of this.warbands) {
      this.march(w, terrain);
      this.feed(w, integratedAt);
    }

    this.clash();
    this.besiege(onRaze, buildings);

    for (let i = this.warbands.length - 1; i >= 0; i--) {
      const band = this.warbands[i];
      if (band.strength > 0.02) continue;
      // Why a column died is the interesting part: starved is a supply failure
      // and therefore the player's planning; broken is a battle they lost.
      onLost?.(band, !band.supplied);
      this.warbands.splice(i, 1);
    }
  }

  /**
   * Walk toward the target, refusing to march into water or up a cliff.
   *
   * Five candidate headings fanned around the direct line, nearest first: it is
   * not pathfinding, but it slides along a shoreline instead of standing in it,
   * which is all a marching column needs to look like it knows where it is going.
   */
  private march(w: Warband, terrain: Terrain): void {
    if (!w.target) return;

    // Walk the routed waypoints when there are any; the final target is only
    // steered at directly once the route runs out, or if there never was one.
    const leg = w.route.length > 0 ? w.route[0] : w.target;
    const dx = leg.x - w.pos.x;
    const dy = leg.y - w.pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance < ARRIVE_RADIUS) {
      if (w.route.length > 0) w.route.shift();
      else w.target = null;
      return;
    }

    const desired = Math.atan2(dy, dx);
    const step = Math.min(MARCH_SPEED, distance);

    for (const spread of [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7]) {
      const a = desired + spread;
      const nx = w.pos.x + Math.cos(a) * step;
      const ny = w.pos.y + Math.sin(a) * step;
      if (nx < 4 || ny < 4 || nx > WORLD_SIZE - 4 || ny > WORLD_SIZE - 4) continue;
      if (!terrain.isBuildable({ x: nx, y: ny }, 6, 6)) continue;

      w.pos.x = nx;
      w.pos.y = ny;
      w.bearing = a;
      return;
    }

    // Boxed in even with a route. Drop this leg and try the next one rather
    // than standing still forever, which is what the first version did.
    if (w.route.length > 0) w.route.shift();
    else w.target = null;
  }

  /** Supply from integrated ground only, never from ground merely held. */
  private feed(w: Warband, integratedAt: (wx: number, wy: number) => number | null): void {
    let supplied = integratedAt(w.pos.x, w.pos.y) === w.owner;

    if (!supplied) {
      for (let i = 0; i < 8 && !supplied; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (const r of [SUPPLY_RANGE * 0.5, SUPPLY_RANGE]) {
          if (integratedAt(w.pos.x + Math.cos(a) * r, w.pos.y + Math.sin(a) * r) === w.owner) {
            supplied = true;
            break;
          }
        }
      }
    }

    w.supplied = supplied;
    w.strength = supplied
      ? Math.min(1, w.strength + RECOVER_RATE)
      : w.strength - STARVE_RATE;
  }

  /**
   * Combat, in one rule: warbands in contact wear each other down in proportion
   * to how strong the other one is.
   *
   * This is Lanchester attrition, and it is chosen because it needs no numbers on
   * screen to be legible (design/01 §6, Pillar A). The stronger column visibly
   * survives; the weaker one visibly fades and disbands. There is nothing to
   * click during a battle, because the decisions were where to build, whether to
   * muster, and whether you had supply — all of which were made beforehand.
   */
  private clash(): void {
    const damage = new Map<number, number>();

    for (let i = 0; i < this.warbands.length; i++) {
      for (let j = i + 1; j < this.warbands.length; j++) {
        const a = this.warbands[i];
        const b = this.warbands[j];
        if (a.owner === b.owner) continue;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > CLASH_RANGE) continue;

        damage.set(a.id, (damage.get(a.id) ?? 0) + b.strength * CLASH_RATE);
        damage.set(b.id, (damage.get(b.id) ?? 0) + a.strength * CLASH_RATE);
      }
    }

    for (const w of this.warbands) {
      const d = damage.get(w.id);
      if (d) {
        w.strength -= d;
        // Fighting stops a column dead. It is not marching anywhere right now.
        w.target = null;
        w.route.length = 0;
      }
    }
  }

  /**
   * A warband standing on an enemy garrison, on ground it now holds, eventually
   * throws it down.
   *
   * Only military buildings are razed. Ordinary buildings change hands instead,
   * by drifting culturally (design/01 §5, "inherited pride") — burning a town
   * you wanted to own is the behaviour of a system that has confused winning
   * with destroying.
   */
  private besiege(onRaze: (b: Building) => void, buildings: readonly Building[]): void {
    for (const w of this.warbands) {
      const victim = buildings.find((b) => {
        if (b.owner === w.owner) return false;
        if (!buildingType(b.typeId).garrison) return false;
        const t = buildingType(b.typeId);
        const r = Math.max(t.width, t.depth) / 2 + 12;
        return Math.hypot(b.pos.x - w.pos.x, b.pos.y - w.pos.y) <= r;
      });

      if (!victim || this.holderAt(w.pos.x, w.pos.y) !== w.owner) {
        w.siege = 0;
        continue;
      }

      w.siege++;
      if (w.siege >= SIEGE_TICKS) {
        w.siege = 0;
        onRaze(victim);
      }
    }
  }
}

/** Total food per tick owed to standing garrisons, for the readout and the bill. */
export function garrisonUpkeep(buildings: readonly Building[], owner: number): number {
  let total = 0;
  for (const b of buildings) {
    if (b.owner !== owner) continue;
    const g = buildingType(b.typeId).garrison;
    if (g) total += g.upkeep;
  }
  return total;
}
