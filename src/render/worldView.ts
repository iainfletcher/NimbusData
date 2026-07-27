import { Container, Graphics } from 'pixi.js';
import {
  CELL_SIZE,
  COHERENCE_THRESHOLD,
  CHARACTER_COUNT,
  buildingType,
  type Building,
  type Fabric,
  type Road,
  type StreetVertex,
  type Vec2,
  type World,
} from '../sim';
import { ROAD_HALF_WIDTH, walkRoad } from '../sim';
import { Camera } from './camera';
import { CHARACTER_COLOURS, shade, terrainColour } from './palette';
import { projectionFor, type Point, type Projection, type ViewMode } from './projection';

/** Terrain is drawn every Nth cell — 4m cells are finer than the eye needs here. */
const TERRAIN_STEP = 2;
const OVERLAY_STEP = 2;

const NEUTRAL_BUILDING = 0x9c8f7d;
const MUDDLE = 0x6a6a6a;
/** Worn earth: what a desire path looks like. */
const PATH = 0xa89878;
/** Made-up surface: what an intentional road looks like. Cooler and harder. */
const ROAD = 0x8d8578;
const ROAD_EDGE = 0x736c62;

export class WorldView {
  readonly root = new Container();

  private terrain = new Graphics();
  private streets = new Graphics();
  private roads = new Graphics();
  private overlay = new Graphics();
  private buildings = new Graphics();
  private ghost = new Graphics();

  private projection: Projection;
  private terrainCacheMode: ViewMode | null = null;

  private buildingsDirty = true;
  private overlayDirty = true;
  private streetsDirty = true;
  private lastFabricVersion = -1;

  showOverlay = false;
  showStreets = true;

  constructor(
    private world: World,
    private camera: Camera,
    private mode: ViewMode = 'iso',
  ) {
    this.projection = projectionFor(mode);
    // Worn paths first, then made roads over them: a road is the more definite
    // thing and should visibly cut across the tracks that predate it.
    this.root.addChild(
      this.terrain,
      this.streets,
      this.roads,
      this.overlay,
      this.buildings,
      this.ghost,
    );
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  get currentProjection(): Projection {
    return this.projection;
  }

  setViewMode(mode: ViewMode): void {
    if (mode === this.mode) return;

    // Keep the world position at the centre of the screen fixed across the switch.
    const centreWorld = this.camera.screenToWorld(
      this.camera.viewportWidth / 2,
      this.camera.viewportHeight / 2,
      this.projection,
    );

    const previous = this.projection;
    this.mode = mode;
    this.projection = projectionFor(mode);
    this.terrainCacheMode = null;
    this.buildingsDirty = true;
    this.overlayDirty = true;
    this.streetsDirty = true;

    // Keep apparent scale constant across the switch, not just the centre point.
    this.camera.zoom *= previous.unitScale / this.projection.unitScale;

    const h = this.world.terrain.heightAt(centreWorld.x, centreWorld.y);
    this.camera.centreOnWorld(centreWorld.x, centreWorld.y, h, this.projection);
  }

  markBuildingsDirty(): void {
    this.buildingsDirty = true;
    this.overlayDirty = true;
  }

  markOverlayDirty(): void {
    this.overlayDirty = true;
  }

  private project(wx: number, wy: number, h: number): Point {
    return this.projection.project(wx, wy, h);
  }

  private projectOnGround(p: Vec2): Point {
    return this.project(p.x, p.y, this.world.terrain.heightAt(p.x, p.y));
  }

  render(): void {
    if (this.terrainCacheMode !== this.mode) {
      this.drawTerrain();
      this.terrainCacheMode = this.mode;
    }

    if (this.world.fabricVersion !== this.lastFabricVersion) {
      this.lastFabricVersion = this.world.fabricVersion;
      this.streetsDirty = true;
      // Frontages turn with the streets, so the buildings need redrawing too.
      this.buildingsDirty = true;
    }

    if (this.streetsDirty) {
      this.drawFabric();
      this.drawRoads();
      this.streetsDirty = false;
    }
    if (this.overlayDirty) {
      this.drawOverlay();
      this.overlayDirty = false;
    }
    if (this.buildingsDirty) {
      this.drawBuildings();
      this.buildingsDirty = false;
    }

    this.overlay.visible = this.showOverlay;
    this.streets.visible = this.showStreets;
    this.roads.visible = this.showStreets;

    // Camera is a transform on the container, not a redraw.
    const { zoom, x, y, viewportWidth, viewportHeight } = this.camera;
    this.root.scale.set(zoom);
    this.root.position.set(viewportWidth / 2 - x * zoom, viewportHeight / 2 - y * zoom);
  }

  private drawTerrain(): void {
    const g = this.terrain;
    g.clear();

    const t = this.world.terrain;
    const step = TERRAIN_STEP;
    const s = CELL_SIZE * step;

    for (let cy = 0; cy < t.height; cy += step) {
      for (let cx = 0; cx < t.width; cx += step) {
        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;

        const h00 = t.heightAt(wx, wy);
        const h10 = t.heightAt(wx + s, wy);
        const h01 = t.heightAt(wx, wy + s);
        const h11 = t.heightAt(wx + s, wy + s);
        const avg = (h00 + h10 + h01 + h11) / 4;

        // Cheap relief: light from the north-west.
        const dz = (h10 + h11) / 2 - (h00 + h01) / 2;
        const dx = (h01 + h11) / 2 - (h00 + h10) / 2;
        const relief = Math.max(-0.35, Math.min(0.35, -(dz + dx) * 0.06));

        const colour = shade(terrainColour(avg), relief);
        // Water is flat: drawing its true corner heights makes a jagged mess.
        const flat = avg <= 0;

        const p00 = this.project(wx, wy, flat ? 0 : h00);
        const p10 = this.project(wx + s, wy, flat ? 0 : h10);
        const p11 = this.project(wx + s, wy + s, flat ? 0 : h11);
        const p01 = this.project(wx, wy + s, flat ? 0 : h01);

        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill(colour);
      }
    }
  }

  /**
   * Streets are drawn as ribbons: each path is offset to either side by its
   * per-vertex half-width and closed into one polygon, so junctions and changes
   * of width join cleanly instead of leaving gaps at the seams.
   */
  private drawFabric(): void {
    const g = this.streets;
    g.clear();

    const fabric: Fabric = this.world.fabric;
    for (const path of fabric.paths) {
      if (path.length < 2) continue;

      const { left, right } = offsetPath(path);
      const points: number[] = [];

      for (const p of left) {
        const s = this.projectOnGround(p);
        points.push(s.x, s.y);
      }
      for (let i = right.length - 1; i >= 0; i--) {
        const s = this.projectOnGround(right[i]);
        points.push(s.x, s.y);
      }

      g.poly(points).fill(PATH);
    }
  }

  /**
   * Roads are drawn as a made surface with a kerb — deliberately crisper and
   * cooler than the worn earth of a desire path, so intention reads differently
   * from accident at a glance.
   */
  private drawRoads(): void {
    const g = this.roads;
    g.clear();

    for (const road of this.world.roads) {
      const halfWidth = ROAD_HALF_WIDTH[road.cls];
      const centre: Vec2[] = [];
      walkRoad(road, 6, (p) => centre.push(p));
      if (centre.length < 2) continue;

      const verts: StreetVertex[] = centre.map((p) => ({ ...p, halfWidth }));
      this.fillRibbon(g, verts, ROAD_EDGE, 1.5);
      this.fillRibbon(g, verts, ROAD, 0);
    }
  }

  private fillRibbon(
    g: Graphics,
    verts: StreetVertex[],
    colour: number,
    inflate: number,
  ): void {
    const widened = inflate
      ? verts.map((v) => ({ ...v, halfWidth: v.halfWidth + inflate }))
      : verts;
    const { left, right } = offsetPath(widened);
    const points: number[] = [];

    for (const p of left) {
      const s = this.projectOnGround(p);
      points.push(s.x, s.y);
    }
    for (let i = right.length - 1; i >= 0; i--) {
      const s = this.projectOnGround(right[i]);
      points.push(s.x, s.y);
    }

    g.poly(points).fill(colour);
  }

  /** Preview of a road being drawn. Pass null to clear. */
  setRoadPreview(points: Vec2[] | null, cls: keyof typeof ROAD_HALF_WIDTH): void {
    const g = this.ghost;
    if (!points || points.length < 2) return;

    const road: Road = { id: -1, points, cls };
    const centre: Vec2[] = [];
    walkRoad(road, 6, (p) => centre.push(p));
    if (centre.length < 2) return;

    this.fillRibbon(
      g,
      centre.map((p) => ({ ...p, halfWidth: ROAD_HALF_WIDTH[cls] })),
      0xe0d3a8,
      0,
    );
  }

  clearGhost(): void {
    this.ghost.clear();
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();

    const field = this.world.field;
    const t = this.world.terrain;
    const step = OVERLAY_STEP;
    const s = CELL_SIZE * step;
    const evenShare = 1 / CHARACTER_COUNT;

    for (let cy = 0; cy < field.height; cy += step) {
      for (let cx = 0; cx < field.width; cx += step) {
        const reading = field.readCell(cx, cy);
        if (!reading.dominant || reading.intensity < 0.05) continue;

        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;

        // Colour says what it is; washing toward grey says it doesn't know yet.
        const clarity = Math.max(0, (reading.coherence - evenShare) / (1 - evenShare));
        const colour = mixColour(MUDDLE, CHARACTER_COLOURS[reading.dominant], clarity);
        const alpha = Math.min(0.72, 0.16 + reading.intensity * 0.42);

        const p00 = this.project(wx, wy, t.heightAt(wx, wy));
        const p10 = this.project(wx + s, wy, t.heightAt(wx + s, wy));
        const p11 = this.project(wx + s, wy + s, t.heightAt(wx + s, wy + s));
        const p01 = this.project(wx, wy + s, t.heightAt(wx, wy + s));

        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill({
          color: colour,
          alpha,
        });
      }
    }
  }

  private drawBuildings(): void {
    const g = this.buildings;
    g.clear();

    // Painter's algorithm: in iso, things further "back" must be drawn first.
    const sorted = [...this.world.buildings].sort(
      (a, b) => a.pos.x + a.pos.y - (b.pos.x + b.pos.y),
    );
    for (const b of sorted) this.drawBuilding(g, b, 1);
  }

  /** The four ground corners, in world space, honouring the building's frontage. */
  private footprint(b: Building): Vec2[] {
    const type = buildingType(b.typeId);
    const hw = type.width / 2;
    const hd = type.depth / 2;
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);

    return [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([dx, dy]) => ({
      x: b.pos.x + dx * cos - dy * sin,
      y: b.pos.y + dx * sin + dy * cos,
    }));
  }

  private drawBuilding(g: Graphics, b: Building, alpha: number, tint?: number): void {
    const type = buildingType(b.typeId);
    const colour = tint ?? buildingColour(b.typeId);
    const h = this.world.terrain.heightAt(b.pos.x, b.pos.y);
    const corners = this.footprint(b);

    if (this.mode === 'plan') {
      const pts: number[] = [];
      for (const c of corners) {
        const s = this.project(c.x, c.y, h);
        pts.push(s.x, s.y);
      }
      g.poly(pts).fill({ color: colour, alpha });
      return;
    }

    // Isometric: an extruded box. Height stands in for storeys.
    const storeys = type.family === 'civic' ? 9 : type.isEvolved ? 8 : 6;
    const top = h + storeys;

    const base = corners.map((c) => this.project(c.x, c.y, h));
    const roof = corners.map((c) => this.project(c.x, c.y, top));

    // Any rotation is allowed, so sort the four walls back-to-front rather than
    // assuming which two are visible.
    const walls = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return {
          i,
          j,
          depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2,
        };
      })
      .sort((a, c) => a.depth - c.depth);

    for (const w of walls) {
      const facing = Math.abs(corners[w.j].x - corners[w.i].x);
      const across = Math.abs(corners[w.j].y - corners[w.i].y);
      // Walls more side-on to the light sit darker, which reads as a corner.
      const lit = facing > across ? -0.14 : -0.28;
      g.poly([
        roof[w.i].x,
        roof[w.i].y,
        roof[w.j].x,
        roof[w.j].y,
        base[w.j].x,
        base[w.j].y,
        base[w.i].x,
        base[w.i].y,
      ]).fill({ color: shade(colour, lit), alpha });
    }

    g.poly([
      roof[0].x,
      roof[0].y,
      roof[1].x,
      roof[1].y,
      roof[2].x,
      roof[2].y,
      roof[3].x,
      roof[3].y,
    ]).fill({ color: shade(colour, 0.12), alpha });
  }

  /** Placement preview. Pass null to clear. */
  setGhost(
    typeId: string | null,
    pos: Point | null,
    valid: boolean,
    rotation = 0,
  ): void {
    const g = this.ghost;
    g.clear();
    if (!typeId || !pos) return;

    this.drawBuilding(
      g,
      { id: -1, typeId, pos, rotation, age: 0 },
      0.55,
      valid ? 0x9ad6a0 : 0xd68a8a,
    );
  }
}

/** Offset a street centreline to both kerbs, mitring at each vertex. */
function offsetPath(path: StreetVertex[]): { left: Vec2[]; right: Vec2[] } {
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];

    let nx = -(next.y - prev.y);
    let ny = next.x - prev.x;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) {
      nx = 0;
      ny = 1;
    } else {
      nx /= len;
      ny /= len;
    }

    const w = path[i].halfWidth;
    left.push({ x: path[i].x + nx * w, y: path[i].y + ny * w });
    right.push({ x: path[i].x - nx * w, y: path[i].y - ny * w });
  }

  return { left, right };
}

function buildingColour(typeId: string): number {
  const type = buildingType(typeId);
  if (type.emissions.length === 0) return NEUTRAL_BUILDING;

  // Strongest emission decides the colour, so a building looks like what it does.
  let best = type.emissions[0];
  for (const e of type.emissions) if (e.strength > best.strength) best = e;
  return CHARACTER_COLOURS[best.character];
}

function mixColour(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

export { COHERENCE_THRESHOLD };
