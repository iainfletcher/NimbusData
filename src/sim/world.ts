import { CharacterField, COHERENCE_THRESHOLD } from './field';
import { Terrain } from './terrain';
import { buildingType } from './buildings';
import { emptyFabric, generateFabric, orientToFabric, type Fabric } from './fabric';
import { nearestRoad, type Road, type RoadClass, type RoadHit } from './roads';
import { emptyDecor, generateDecor, type Decor } from './decor';
import { Crowd } from './people';
import { WORLD_SIZE, type Building, type Vec2 } from './types';

/** Ticks a cottage must stand before it can become something. */
const SETTLING_TICKS = 40;

/**
 * Routing the whole town costs a few hundred milliseconds, so it waits for the
 * player to stop placing rather than running on every click.
 */
const FABRIC_DEBOUNCE_TICKS = 4;

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
  private _fabricVersion = 0;
  private _decor: Decor = emptyDecor();
  readonly crowd = new Crowd();

  constructor(readonly seed: number) {
    this.terrain = new Terrain(seed);
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

  place(typeId: string, pos: Vec2, rotation = 0): PlacementResult {
    const check = this.canPlace(typeId, pos);
    if (!check.ok) return check;

    const building: Building = {
      id: this.nextId++,
      typeId,
      pos: { x: pos.x, y: pos.y },
      rotation,
      age: 0,
    };
    this.buildings.push(building);
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
  addRoad(points: Vec2[], cls: RoadClass = 'street'): Road | null {
    if (points.length < 2) return null;

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
    this.fabricDirty = false;
    this.fabricCooldown = 0;
    this._fabricVersion++;
  }

  tick(): void {
    this.tickCount++;

    if (this.fieldDirty) {
      this.field.rebuild(this.buildings);
      this.fieldDirty = false;
    }

    for (const b of this.buildings) b.age++;

    this.evolveHousing();

    if (this.fabricDirty) {
      if (this.fabricCooldown > 0) this.fabricCooldown--;
      else this.rebuildFabric();
    }
  }

  /**
   * Ambient people advance on real elapsed time rather than the sim tick, since
   * they feed back into nothing and 10Hz walking looks like stop-motion.
   */
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
