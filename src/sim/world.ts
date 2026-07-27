import { CharacterField, COHERENCE_THRESHOLD } from './field';
import { Terrain } from './terrain';
import { buildingType } from './buildings';
import { emptyFabric, generateFabric, orientToFabric, type Fabric, type StreetVertex } from './fabric';
import { closestPointOnSegment, nearestRoad, type Road, type RoadClass, type RoadHit } from './roads';
import { emptyDecor, generateDecor, type Decor } from './decor';
import { Crowd } from './people';
import { Conductance, openGround } from './conductance';
import { OWNER_PLAYER, OWNER_RIVAL, Territory } from './territory';
import { Calendar } from './calendar';
import { Rival } from './rival';
import { Economy, roadCost } from './economy';
import { computeLand, type Land } from './land';
import { planRoads, type PlanSpec } from './plans';
import { makeNameRng, streetName, townName } from './names';
import { CHARACTER_COUNT, CHARACTERS, characterIndex, type Character } from './types';
import { WORLD_SIZE, type Building, type Vec2 } from './types';
import type { BrushStroke } from './terrain';

/** Ticks a cottage must stand before it can become something. */
const SETTLING_TICKS = 40;

/**
 * Routing the whole town costs a few hundred milliseconds, so it waits for the
 * player to stop placing rather than running on every click.
 */
const FABRIC_DEBOUNCE_TICKS = 4;

/** Ticks of quiet after a brush stroke before the water is recomputed. */
const WATER_SETTLE_TICKS = 3;

/**
 * Ticks between territory recomputations. Culture moves on a scale of years, so
 * there is nothing to gain from resolving it every tenth of a second.
 */
const TERRITORY_INTERVAL = 12;

export interface PlacementResult {
  ok: boolean;
  reason?: string;
  building?: Building;
}

export class World {
  readonly terrain: Terrain;
  readonly field = new CharacterField();
  readonly buildings: Building[] = [];
  readonly roads: Road[] = [];

  private nextId = 1;
  private nextRoadId = 1;
  private fieldDirty = true;
  private tickCount = 0;

  private _fabric: Fabric = emptyFabric();
  private fabricDirty = false;
  private fabricCooldown = 0;
  private waterCooldown = 0;
  private _fabricVersion = 0;
  private _decor: Decor = emptyDecor();
  readonly crowd = new Crowd();
  private conductance: Conductance = openGround();
  readonly territory = new Territory();
  readonly economy = new Economy();
  readonly calendar = new Calendar();
  private rival: Rival;
  /** How many buildings the rival has added since the start. */
  rivalBuilt = 0;
  private land: Land;
  private territoryCooldown = 0;
  /**
   * When false the character field falls back to flat cost, which makes geodesic
   * spread equivalent to Euclidean. Kept as a live A/B so the effect of the cost
   * field can be judged rather than assumed.
   */
  useFlow = true;

  /** This town's name. Fixed by the seed. */
  readonly name: string;

  private nameRng: () => number;
  private usedStreetNames = new Set<string>();

  constructor(readonly seed: number) {
    this.terrain = new Terrain(seed);
    this.nameRng = makeNameRng(seed);
    this.name = townName(this.nameRng);
    this.land = computeLand(this.terrain, seed);
    this.rival = new Rival(seed);
  }

  /**
   * Give any unnamed road a name drawn from the character it runs through.
   * Named once and left alone thereafter.
   */
  private nameRoads(): void {
    for (const road of this.roads) {
      if (road.name) continue;
      road.name = streetName(
        this.dominantAlong(road),
        this.usedStreetNames,
        this.nameRng,
      );
    }
  }

  /** The character a road mostly runs through, weighted by how strongly. */
  private dominantAlong(road: Road): Character | null {
    const tally = new Float64Array(CHARACTER_COUNT);
    let samples = 0;

    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 12));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const reading = this.field.read(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        if (!reading.dominant) continue;
        tally[characterIndex(reading.dominant)] += reading.intensity;
        samples++;
      }
    }

    if (samples === 0) return null;

    let best = -1;
    let bestValue = 0;
    for (let c = 0; c < CHARACTER_COUNT; c++) {
      if (tally[c] > bestValue) {
        bestValue = tally[c];
        best = c;
      }
    }
    return best >= 0 ? CHARACTERS[best] : null;
  }

  canPlace(typeId: string, pos: Vec2): PlacementResult {
    const type = buildingType(typeId);

    const half = Math.max(type.width, type.depth) / 2;
    if (
      pos.x - half < 0 ||
      pos.y - half < 0 ||
      pos.x + half > WORLD_SIZE ||
      pos.y + half > WORLD_SIZE
    ) {
      return { ok: false, reason: 'Outside the world' };
    }

    if (!this.terrain.isBuildable(pos, type.width, type.depth)) {
      return { ok: false, reason: 'Ground is water or too steep' };
    }

    if (type.cost && !this.economy.canAfford(type.cost)) {
      return { ok: false, reason: 'Not enough materials' };
    }

    for (const other of this.buildings) {
      const otherType = buildingType(other.typeId);
      // Axis-aligned overlap test with a small gap so buildings never touch.
      const gap = 2;
      const dx = Math.abs(other.pos.x - pos.x);
      const dy = Math.abs(other.pos.y - pos.y);
      if (
        dx < (type.width + otherType.width) / 2 + gap &&
        dy < (type.depth + otherType.depth) / 2 + gap
      ) {
        return { ok: false, reason: 'Overlaps an existing building' };
      }
    }

    return { ok: true };
  }

  place(
    typeId: string,
    pos: Vec2,
    rotation = 0,
    owner: number = OWNER_PLAYER,
  ): PlacementResult {
    const check = this.canPlace(typeId, pos);
    if (!check.ok) return check;

    const building: Building = {
      id: this.nextId++,
      typeId,
      owner,
      pos: { x: pos.x, y: pos.y },
      rotation,
      age: 0,
    };
    this.buildings.push(building);
    // The rival builds on its own account, so only the player's spending counts.
    const type = buildingType(typeId);
    if (type.cost && owner === OWNER_PLAYER) this.economy.spend(type.cost);
    this.fieldDirty = true;
    this.markFabricDirty();
    return { ok: true, building };
  }

  remove(id: number): boolean {
    const i = this.buildings.findIndex((b) => b.id === id);
    if (i < 0) return false;
    this.buildings.splice(i, 1);
    this.fieldDirty = true;
    this.markFabricDirty();
    return true;
  }

  buildingAt(wx: number, wy: number): Building | null {
    // Reverse order so the most recently placed wins a tie.
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const b = this.buildings[i];
      const t = buildingType(b.typeId);
      if (
        Math.abs(wx - b.pos.x) <= t.width / 2 &&
        Math.abs(wy - b.pos.y) <= t.depth / 2
      ) {
        return b;
      }
    }
    return null;
  }

  /**
   * Lay an intentional road. Unlike desire paths, roads are authored and permanent
   * — the town never draws one for you and never removes one (design/05 §7).
   */
  addRoad(points: Vec2[], cls: RoadClass = 'street', free = false): Road | null {
    if (points.length < 2) return null;

    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }
    const cost = roadCost(length, cls);
    if (!free) {
      if (!this.economy.canAfford(cost)) return null;
      this.economy.spend(cost);
    }

    const road: Road = {
      id: this.nextRoadId++,
      points: points.map((p) => ({ x: p.x, y: p.y })),
      cls,
    };
    this.roads.push(road);
    this.markFabricDirty();
    return road;
  }

  removeRoad(id: number): boolean {
    const i = this.roads.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.roads.splice(i, 1);
    this.markFabricDirty();
    return true;
  }

  /**
   * Find the worn path nearest a point. The game already knows where people
   * actually walk; this is what lets the player see it.
   */
  pathNear(pos: Vec2, maxDistance: number): { path: StreetVertex[]; distance: number } | null {
    let best: { path: StreetVertex[]; distance: number } | null = null;

    for (const path of this._fabric.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const near = closestPointOnSegment(pos, path[i], path[i + 1]);
        const d = Math.hypot(pos.x - near.x, pos.y - near.y);
        if (d > maxDistance) continue;
        if (best && d >= best.distance) continue;
        best = { path, distance: d };
      }
    }

    return best;
  }

  /**
   * Pave a desire path into a road (design/05 §7).
   *
   * The town shows you where it wants a road; you decide whether to build it.
   * The paved road keeps the path's exact wander, so it is visibly a different
   * kind of thing from one you drew yourself: **roads you draw are straight
   * because you drew them, roads you pave bend because people did.**
   */
  paveNearestPath(pos: Vec2, maxDistance = 22): Road | null {
    const found = this.pathNear(pos, maxDistance);
    if (!found) return null;

    // Class follows how well worn it already is.
    let widest = 0;
    for (const v of found.path) widest = Math.max(widest, v.halfWidth);
    const cls: RoadClass = widest >= 4 ? 'high' : widest >= 2.6 ? 'street' : 'lane';

    // Thin the vertex count: Chaikin left it dense, and a road needs corners it
    // can actually round.
    const points: Vec2[] = [];
    const stride = Math.max(1, Math.floor(found.path.length / 12));
    for (let i = 0; i < found.path.length; i += stride) {
      points.push({ x: found.path[i].x, y: found.path[i].y });
    }
    const last = found.path[found.path.length - 1];
    const tail = points[points.length - 1];
    if (Math.hypot(tail.x - last.x, tail.y - last.y) > 1) {
      points.push({ x: last.x, y: last.y });
    }

    return this.addRoad(points, cls);
  }

  /**
   * Lay out a planned composition — a crescent, a square, a grid (design/05 §2).
   *
   * A plan is only ever a set of roads: frontage snapping does the rest, so
   * building along a curve produces a crescent without any further machinery.
   * All-or-nothing on cost, since half a square is not a square.
   */
  applyPlan(spec: PlanSpec): boolean {
    const roads = planRoads(spec);

    let total = 0;
    for (const r of roads) {
      for (let i = 0; i < r.points.length - 1; i++) {
        total += Math.hypot(
          r.points[i + 1].x - r.points[i].x,
          r.points[i + 1].y - r.points[i].y,
        );
      }
    }

    const cost = roadCost(total, 'street');
    if (!this.economy.canAfford(cost)) return false;
    this.economy.spend(cost);

    for (const r of roads) this.addRoad(r.points, r.cls, true);
    return true;
  }

  /** Nearest road to a point, for frontage snapping. */
  roadNear(pos: Vec2, maxDistance: number): RoadHit | null {
    return nearestRoad(this.roads, pos, maxDistance);
  }

  /** The street network. Regenerated shortly after buildings change. */
  get fabric(): Fabric {
    return this._fabric;
  }

  /** Generated detail — trees, hedges, garden rows. Never placed by the player. */
  get decor(): Decor {
    return this._decor;
  }

  /** Bumped whenever the fabric is rebuilt, so renderers know to redraw. */
  get fabricVersion(): number {
    return this._fabricVersion;
  }

  /** Force an immediate rebuild rather than waiting out the debounce. */
  rebuildFabric(): void {
    this._fabric = generateFabric(this.terrain, this.buildings, this.roads, this.seed);
    orientToFabric(this.buildings, this._fabric, this.roads);
    // Decor follows the fabric: plots sit behind whatever a building faces.
    this._decor = generateDecor(
      this.terrain,
      this.buildings,
      this.roads,
      this._fabric,
      this.seed,
    );
    // People walk the network, so they have to be rehomed when it changes.
    this.crowd.reset(this.roads, this._fabric, this.buildings.length, this.seed);
    // Character travels the same ground people do, so the cost field follows the
    // fabric too — and the character field has to be redone once it changes.
    this.conductance = Conductance.build(this.terrain, this.roads, this._fabric);
    this.fieldDirty = true;
    this.fabricDirty = false;
    this.fabricCooldown = 0;
    this._fabricVersion++;
  }

  tick(): void {
    this.tickCount++;

    if (this.fieldDirty) {
      this.field.rebuild(this.buildings, this.useFlow ? this.conductance : openGround());
      this.fieldDirty = false;
      // Naming needs the field to be current, so it follows the rebuild.
      this.nameRoads();
    }

    this.calendar.advance();

    for (const b of this.buildings) b.age++;

    this.economy.update(this.buildings, this.land, this.terrain, this.calendar.effects);

    // The rival only proposes; the world decides whether the ground allows it.
    for (const move of this.rival.propose(this.buildings, this.field, this.territory)) {
      const placed = this.place(
        move.typeId,
        move.pos,
        this.rivalFacing(move.pos),
        OWNER_RIVAL,
      );
      if (placed.ok) {
        this.rivalBuilt++;
        break;
      }
    }

    this.evolveHousing();

    if (this.fabricDirty) {
      if (this.fabricCooldown > 0) this.fabricCooldown--;
      else this.rebuildFabric();
    }

    // Culture is slow by design, so it is recomputed on a lazy cadence and the
    // claim is then allowed to drift by however many ticks have passed.
    if (this.territoryCooldown > 0) {
      this.territoryCooldown--;
    } else {
      this.territoryCooldown = TERRITORY_INTERVAL;
      this.territory.update(
        this.buildings,
        this.field,
        this.useFlow ? this.conductance : openGround(),
        TERRITORY_INTERVAL,
      );
    }

    // Water settles a beat after the last brush stroke, then everything that
    // stands on the ground is rebuilt against the new shape.
    if (this.terrain.waterPending) {
      if (this.waterCooldown > 0) this.waterCooldown--;
      else if (this.terrain.settleWater()) {
        this.land = computeLand(this.terrain, this.seed);
        this.fieldDirty = true;
        this.markFabricDirty();
      }
    }
  }

  /**
   * Ambient people advance on real elapsed time rather than the sim tick, since
   * they feed back into nothing and 10Hz walking looks like stop-motion.
   */
  /**
   * Reshape the ground. Everything downstream — water, routing, character —
   * follows from the heightmap, so all of it is invalidated together.
   */
  sculpt(stroke: BrushStroke, mode: 'raise' | 'level' = 'raise'): void {
    this.terrain.sculpt(stroke, mode);
    this.waterCooldown = WATER_SETTLE_TICKS;
  }

  /** Face a new rival building at its own nearest road, as the player's do. */
  private rivalFacing(pos: Vec2): number {
    const hit = nearestRoad(this.roads, pos, 30);
    return hit ? hit.angle : 0;
  }

  /** Force the character field to be recomputed, e.g. after toggling flow. */
  invalidateField(): void {
    this.fieldDirty = true;
  }

  updatePeople(dtSeconds: number): void {
    this.crowd.update(dtSeconds);
  }

  private markFabricDirty(): void {
    this.fabricDirty = true;
    this.fabricCooldown = FABRIC_DEBOUNCE_TICKS;
  }

  /**
   * Housing becomes the house that belongs where it stands (design/04): not better
   * or worse, but characteristic. Only where the surroundings are clearly one thing.
   */
  private evolveHousing(): void {
    let changed = false;

    for (const b of this.buildings) {
      // A hungry town does not grow. It is not punished, it simply waits.
      if (this.economy.hungry) break;

      const type = buildingType(b.typeId);
      if (!type.evolvesTo || b.age < SETTLING_TICKS) continue;

      const reading = this.field.read(b.pos.x, b.pos.y);
      if (!reading.dominant || reading.coherence < COHERENCE_THRESHOLD) continue;

      const nextId = type.evolvesTo[reading.dominant];
      if (!nextId) continue;

      const nextType = buildingType(nextId);
      // Growing a bigger footprint must not clip a neighbour.
      const grown = this.fitsInPlace(b, nextType.width, nextType.depth);
      if (!grown) continue;

      b.typeId = nextId;
      b.age = 0;
      changed = true;
    }

    if (changed) {
      this.fieldDirty = true;
      this.markFabricDirty();
    }
  }

  private fitsInPlace(building: Building, width: number, depth: number): boolean {
    if (!this.terrain.isBuildable(building.pos, width, depth)) return false;

    for (const other of this.buildings) {
      if (other.id === building.id) continue;
      const ot = buildingType(other.typeId);
      const dx = Math.abs(other.pos.x - building.pos.x);
      const dy = Math.abs(other.pos.y - building.pos.y);
      if (dx < (width + ot.width) / 2 + 1 && dy < (depth + ot.depth) / 2 + 1) {
        return false;
      }
    }
    return true;
  }

  get ticks(): number {
    return this.tickCount;
  }
}
