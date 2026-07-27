import { buildingType } from './buildings';
import { valueNoise } from './rng';
import { ROAD_COST, ROAD_HALF_WIDTH, nearestRoad, walkRoad, type Road } from './roads';
import { Terrain } from './terrain';
import { CELL_SIZE, WORLD_CELLS, WORLD_SIZE, type Building, type Vec2 } from './types';

/**
 * Organic fabric (design/05).
 *
 * Streets are not drawn and not laid out on a template — they are *desire lines*.
 * Every building wants to reach its neighbours; each of those journeys is routed
 * across a terrain cost field; and where journeys happen to share ground, that
 * ground is worn into a wider street.
 *
 * The hierarchy therefore falls out rather than being authored: a lane that
 * happens to be on everyone's way to the market becomes the high street, because
 * more journeys used it. That is what makes the result look like a place rather
 * than a graph — real towns are shaped by the same process.
 */

/** Routing runs on a coarser grid than the character field. 8m reads as a street. */
export const ROUTE_CELL = 8;
export const ROUTE_CELLS = Math.round(WORLD_SIZE / ROUTE_CELL);

/** Each building routes to this many neighbours. Higher makes a denser mesh. */
const NEIGHBOURS = 3;

const IMPASSABLE = Infinity;

export interface StreetVertex extends Vec2 {
  /** Half-width in metres at this point, from traffic. */
  halfWidth: number;
}

export interface Fabric {
  paths: StreetVertex[][];
  /** Traffic per route cell, exposed for debugging. */
  traffic: Float32Array;
  routeCells: number;
}

export function emptyFabric(): Fabric {
  return {
    paths: [],
    traffic: new Float32Array(ROUTE_CELLS * ROUTE_CELLS),
    routeCells: ROUTE_CELLS,
  };
}

/** Traffic → half-width. Deliberately chunky: a town has lanes, streets, and a high street. */
function halfWidthFor(traffic: number): number {
  if (traffic >= 8) return 4.5; // high street
  if (traffic >= 4) return 3.2; // street
  if (traffic >= 2) return 2.2; // lane
  return 1.4; // alley, back way
}

/**
 * How far a building's pull on routing reaches, and how strongly.
 *
 * Without this, routes take the cheapest line across open ground and the network
 * ends up looping *around* clusters like field boundaries. Real streets exist
 * because buildings front onto them, so travelling past a frontage has to be
 * cheaper than striking out across a field.
 */
const FRONTAGE_REACH = 26;
const FRONTAGE_DISCOUNT = 0.5;

export function generateFabric(
  terrain: Terrain,
  buildings: readonly Building[],
  roads: readonly Road[],
  seed: number,
): Fabric {
  if (buildings.length < 2) return emptyFabric();

  const cost = buildCostField(terrain, buildings, roads, seed);
  const nodes = buildings.map((b) => nearestOpenCell(cost, b.pos));

  const traffic = new Float32Array(ROUTE_CELLS * ROUTE_CELLS);
  const rawPaths: number[][] = [];

  for (const [a, b] of journeyPairs(buildings)) {
    const from = nodes[a];
    const to = nodes[b];
    if (from < 0 || to < 0 || from === to) continue;

    const path = findPath(cost, from, to);
    if (!path) continue;

    for (const cell of path) traffic[cell] += 1;
    rawPaths.push(path);
  }

  // Second pass: widths can only be read once every journey has been counted.
  const paths: StreetVertex[][] = [];
  for (const raw of rawPaths) {
    if (raw.length < 2) continue;
    const points = raw.map((cell) => cellCentre(cell));
    const widths = raw.map((cell) => halfWidthFor(traffic[cell]));
    const smoothed = smoothPath(points, widths);
    if (smoothed.length >= 2) paths.push(smoothed);
  }

  return { paths, traffic, routeCells: ROUTE_CELLS };
}

// ---------------------------------------------------------------------------
// Cost field
// ---------------------------------------------------------------------------

function buildCostField(
  terrain: Terrain,
  buildings: readonly Building[],
  roads: readonly Road[],
  seed: number,
): Float32Array {
  const cost = new Float32Array(ROUTE_CELLS * ROUTE_CELLS);

  for (let cy = 0; cy < ROUTE_CELLS; cy++) {
    for (let cx = 0; cx < ROUTE_CELLS; cx++) {
      const wx = (cx + 0.5) * ROUTE_CELL;
      const wy = (cy + 0.5) * ROUTE_CELL;
      const i = cy * ROUTE_CELLS + cx;

      if (terrain.isWater(wx, wy)) {
        cost[i] = IMPASSABLE;
        continue;
      }

      // Slope is the dominant terrain cost — this is why streets follow contours.
      const slope = terrain.slopeAt(wx, wy);
      let c = 1 + slope * 26;

      // A little deterministic wander, so paths kink like cart tracks rather than
      // running dead straight across open ground.
      c *= 0.86 + valueNoise(cx * 0.32, cy * 0.32, seed ^ 0x9e37) * 0.3;

      cost[i] = c;
    }
  }

  // Ground near a frontage is cheap to travel, so routes gather into streets
  // instead of wandering across open country. Strongest pull wins rather than
  // accumulating, so a dense cluster doesn't drop to free.
  const pull = new Float32Array(ROUTE_CELLS * ROUTE_CELLS);
  const reachCells = Math.ceil(FRONTAGE_REACH / ROUTE_CELL);

  for (const b of buildings) {
    const bx = b.pos.x / ROUTE_CELL;
    const by = b.pos.y / ROUTE_CELL;
    const x0 = Math.max(0, Math.floor(bx - reachCells));
    const x1 = Math.min(ROUTE_CELLS - 1, Math.ceil(bx + reachCells));
    const y0 = Math.max(0, Math.floor(by - reachCells));
    const y1 = Math.min(ROUTE_CELLS - 1, Math.ceil(by + reachCells));

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = Math.hypot(cx + 0.5 - bx, cy + 0.5 - by) * ROUTE_CELL;
        if (d >= FRONTAGE_REACH) continue;
        const strength = FRONTAGE_DISCOUNT * (1 - d / FRONTAGE_REACH);
        const i = cy * ROUTE_CELLS + cx;
        if (strength > pull[i]) pull[i] = strength;
      }
    }
  }

  for (let i = 0; i < cost.length; i++) {
    if (Number.isFinite(cost[i])) cost[i] *= 1 - pull[i];
  }

  // Buildings are solid, with a margin so streets don't scrape the walls.
  for (const b of buildings) {
    const type = buildingType(b.typeId);
    const margin = 0.6;
    const hw = type.width / 2 + margin;
    const hd = type.depth / 2 + margin;

    const x0 = Math.floor((b.pos.x - hw) / ROUTE_CELL);
    const x1 = Math.floor((b.pos.x + hw) / ROUTE_CELL);
    const y0 = Math.floor((b.pos.y - hd) / ROUTE_CELL);
    const y1 = Math.floor((b.pos.y + hd) / ROUTE_CELL);

    for (let cy = Math.max(0, y0); cy <= Math.min(ROUTE_CELLS - 1, y1); cy++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(ROUTE_CELLS - 1, x1); cx++) {
        cost[cy * ROUTE_CELLS + cx] = IMPASSABLE;
      }
    }
  }

  // Roads go on last and override: they are the armature the town hangs off, so
  // a journey should always prefer one. This is what turns desire paths into
  // short spurs from a frontage to the nearest road rather than long cross-country
  // tracks.
  for (const road of roads) {
    const halfWidth = ROAD_HALF_WIDTH[road.cls];
    const reach = Math.ceil(halfWidth / ROUTE_CELL);

    walkRoad(road, ROUTE_CELL / 2, (p) => {
      const cx0 = Math.floor(p.x / ROUTE_CELL);
      const cy0 = Math.floor(p.y / ROUTE_CELL);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          if (cx < 0 || cy < 0 || cx >= ROUTE_CELLS || cy >= ROUTE_CELLS) continue;
          cost[cy * ROUTE_CELLS + cx] = ROAD_COST;
        }
      }
    });
  }

  return cost;
}

/** Buildings sit on blocked ground, so each needs a doorstep to route from. */
function nearestOpenCell(cost: Float32Array, pos: Vec2): number {
  const cx0 = Math.floor(pos.x / ROUTE_CELL);
  const cy0 = Math.floor(pos.y / ROUTE_CELL);

  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring at distance r, so we find the genuinely nearest.
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = cx0 + dx;
        const cy = cy0 + dy;
        if (cx < 0 || cy < 0 || cx >= ROUTE_CELLS || cy >= ROUTE_CELLS) continue;
        const i = cy * ROUTE_CELLS + cx;
        if (Number.isFinite(cost[i])) return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Which journeys happen
// ---------------------------------------------------------------------------

/**
 * Nearest neighbours give local streets; a spanning tree guarantees the whole
 * town is connected, including across clusters separated by a river or a hill.
 */
function journeyPairs(buildings: readonly Building[]): [number, number][] {
  const n = buildings.length;
  const seen = new Set<number>();
  const pairs: [number, number][] = [];

  const add = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * n + hi;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([lo, hi]);
  };

  const d2 = (a: number, b: number) => {
    const dx = buildings[a].pos.x - buildings[b].pos.x;
    const dy = buildings[a].pos.y - buildings[b].pos.y;
    return dx * dx + dy * dy;
  };

  for (let i = 0; i < n; i++) {
    const others = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push({ j, d: d2(i, j) });
    others.sort((p, q) => p.d - q.d);
    for (let k = 0; k < Math.min(NEIGHBOURS, others.length); k++) add(i, others[k].j);
  }

  // Prim's spanning tree over the same points.
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  best[0] = 0;

  for (let iter = 0; iter < n; iter++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (pick < 0 || best[i] < best[pick])) pick = i;
    if (pick < 0) break;
    inTree[pick] = true;
    if (parent[pick] >= 0) add(pick, parent[pick]);

    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = d2(pick, i);
      if (d < best[i]) {
        best[i] = d;
        parent[i] = pick;
      }
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

function findPath(cost: Float32Array, start: number, goal: number): number[] | null {
  const n = ROUTE_CELLS * ROUTE_CELLS;
  const g = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const gx = goal % ROUTE_CELLS;
  const gy = (goal / ROUTE_CELLS) | 0;
  const heuristic = (i: number) => {
    const dx = Math.abs((i % ROUTE_CELLS) - gx);
    const dy = Math.abs(((i / ROUTE_CELLS) | 0) - gy);
    // Octile distance, admissible for 8-way movement at unit base cost.
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const open = new MinHeap();
  g[start] = 0;
  open.push(start, heuristic(start));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % ROUTE_CELLS;
    const cy = (current / ROUTE_CELLS) | 0;

    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ROUTE_CELLS || ny >= ROUTE_CELLS) continue;

      const ni = ny * ROUTE_CELLS + nx;
      if (closed[ni]) continue;

      const c = cost[ni];
      if (!Number.isFinite(c)) continue;

      // Diagonals may not cut a corner between two blocked cells.
      if (dx !== 0 && dy !== 0) {
        if (!Number.isFinite(cost[cy * ROUTE_CELLS + nx])) continue;
        if (!Number.isFinite(cost[ny * ROUTE_CELLS + cx])) continue;
      }

      const tentative = g[current] + c * step;
      if (tentative < g[ni]) {
        g[ni] = tentative;
        from[ni] = current;
        open.push(ni, tentative + heuristic(ni));
      }
    }
  }

  if (from[goal] < 0 && goal !== start) return null;

  const path: number[] = [];
  for (let at = goal; at >= 0; at = from[at]) {
    path.push(at);
    if (at === start) break;
  }
  return path.reverse();
}

/** Binary heap keyed on f-score. Lazy deletion — stale entries are skipped above. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.keys.length && this.keys[l] < this.keys[smallest]) smallest = l;
        if (r < this.keys.length && this.keys[r] < this.keys[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

// ---------------------------------------------------------------------------
// Path shaping
// ---------------------------------------------------------------------------

function cellCentre(cell: number): Vec2 {
  return {
    x: ((cell % ROUTE_CELLS) + 0.5) * ROUTE_CELL,
    y: (((cell / ROUTE_CELLS) | 0) + 0.5) * ROUTE_CELL,
  };
}

/**
 * A* returns a staircase. Chaikin corner-cutting turns it into something that
 * looks walked rather than computed, while keeping the route it found.
 */
function smoothPath(points: Vec2[], widths: number[], iterations = 2): StreetVertex[] {
  let current: StreetVertex[] = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    halfWidth: widths[i],
  }));

  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;
    const next: StreetVertex[] = [current[0]];

    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
        halfWidth: a.halfWidth * 0.75 + b.halfWidth * 0.25,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
        halfWidth: a.halfWidth * 0.25 + b.halfWidth * 0.75,
      });
    }

    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

// ---------------------------------------------------------------------------
// Frontage
// ---------------------------------------------------------------------------

/**
 * Buildings turn to face what they stand on — and *how strictly* depends on what
 * that is (design/05 §7).
 *
 * A player-drawn road is an intention, so frontages line up on it exactly, which
 * is what makes a terrace read as deliberate. A worn desire path is not, so
 * buildings near one sit at a looser, slightly wonky angle. The difference
 * between a planned crescent and a rambling hamlet is mostly this.
 */
export function orientToFabric(
  buildings: readonly Building[],
  fabric: Fabric,
  roads: readonly Road[] = [],
): boolean {
  let changed = false;

  for (const b of buildings) {
    // A road within reach wins outright, however close a path happens to be.
    const road = nearestRoadAngle(roads, b.pos, ROAD_FRONTAGE_RANGE);
    if (road !== null) {
      if (Math.abs(normaliseAngle(road - b.rotation)) > 1e-3) {
        b.rotation = road;
        changed = true;
      }
      continue;
    }

    let bestD2 = Infinity;
    let bestAngle = b.rotation;

    for (const path of fabric.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const c = path[i + 1];
        const near = closestPointOnSegment(b.pos, a, c);
        const dx = b.pos.x - near.x;
        const dy = b.pos.y - near.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        // Face the street: the frontage runs parallel to it.
        bestAngle = Math.atan2(c.y - a.y, c.x - a.x);
      }
    }

    if (bestD2 >= PATH_FRONTAGE_RANGE * PATH_FRONTAGE_RANGE) continue;

    // Deterministic wonk, so an unplanned lane doesn't look surveyed.
    const jitter = (valueNoise(b.id * 0.71, b.id * 0.37, 0x51de) - 0.5) * PATH_WONK;
    const angle = bestAngle + jitter;

    if (Math.abs(normaliseAngle(angle - b.rotation)) > 1e-3) {
      b.rotation = angle;
      changed = true;
    }
  }

  return changed;
}

/** How far a road reaches to claim a frontage, and how far a mere path does. */
const ROAD_FRONTAGE_RANGE = 28;
const PATH_FRONTAGE_RANGE = 30;
/** Radians of deliberate untidiness for buildings that only face a worn path. */
const PATH_WONK = 0.34;

function nearestRoadAngle(
  roads: readonly Road[],
  pos: Vec2,
  maxDistance: number,
): number | null {
  const hit = nearestRoad(roads, pos, maxDistance);
  return hit ? hit.angle : null;
}

function normaliseAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export { CELL_SIZE, WORLD_CELLS };
