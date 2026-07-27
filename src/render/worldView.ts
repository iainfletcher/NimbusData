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
import { appearanceOf, type Appearance } from './appearance';
import { CHARACTER_COLOURS, shade, terrainColour } from './palette';
import { projectionFor, type Point, type Projection, type ViewMode } from './projection';

/** Terrain is drawn every Nth cell — 4m cells are finer than the eye needs here. */
const TERRAIN_STEP = 2;
const OVERLAY_STEP = 2;

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

  /** Local (dx, dy) in the building's own frame → world position. */
  private local(b: Building, dx: number, dy: number): Vec2 {
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);
    return { x: b.pos.x + dx * cos - dy * sin, y: b.pos.y + dx * sin + dy * cos };
  }

  /** The four ground corners, in world space, honouring the building's frontage. */
  private footprint(b: Building): Vec2[] {
    const type = buildingType(b.typeId);
    const hw = type.width / 2;
    const hd = type.depth / 2;
    return [
      this.local(b, -hw, -hd),
      this.local(b, hw, -hd),
      this.local(b, hw, hd),
      this.local(b, -hw, hd),
    ];
  }

  /**
   * Buildings are drawn as walls up to the eaves with a pitched roof over them.
   * The roof is doing most of the work: a gable end reads as a house where a flat
   * box reads as a crate, and roof material is how you tell slate from thatch at
   * a distance.
   */
  private drawBuilding(g: Graphics, b: Building, alpha: number, tint?: number): void {
    const look = appearanceOf(b.typeId);
    const wall = tint ?? look.wall;
    const roof = tint ?? look.roof;
    const ground = this.world.terrain.heightAt(b.pos.x, b.pos.y);
    const corners = this.footprint(b);

    if (this.mode === 'plan') {
      const pts: number[] = [];
      for (const c of corners) {
        const s = this.project(c.x, c.y, ground);
        pts.push(s.x, s.y);
      }
      g.poly(pts).fill({ color: look.form === 'flat' ? wall : roof, alpha });
      return;
    }

    const eaves = ground + look.eaves;
    const base = corners.map((c) => this.project(c.x, c.y, ground));
    const top = corners.map((c) => this.project(c.x, c.y, eaves));

    // Walls, back to front. Any rotation is allowed, so sort rather than assume.
    const walls = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return { i, j, depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2 };
      })
      .sort((a, c) => a.depth - c.depth);

    for (const w of walls) {
      const sideOn = Math.abs(corners[w.j].x - corners[w.i].x) > Math.abs(corners[w.j].y - corners[w.i].y);
      g.poly([
        top[w.i].x, top[w.i].y,
        top[w.j].x, top[w.j].y,
        base[w.j].x, base[w.j].y,
        base[w.i].x, base[w.i].y,
      ]).fill({ color: shade(wall, sideOn ? -0.12 : -0.26), alpha });
    }

    if (look.form === 'flat') {
      g.poly([
        top[0].x, top[0].y, top[1].x, top[1].y, top[2].x, top[2].y, top[3].x, top[3].y,
      ]).fill({ color: shade(wall, 0.1), alpha });
    } else {
      this.drawRoof(g, b, look, eaves, alpha, wall, roof);
    }

    if (look.tower) this.drawTower(g, b, look, ground, alpha, wall, roof);
  }

  private drawRoof(
    g: Graphics,
    b: Building,
    look: Appearance,
    eaves: number,
    alpha: number,
    wall: number,
    roof: number,
  ): void {
    const type = buildingType(b.typeId);
    const hw = type.width / 2;
    const hd = type.depth / 2;
    const ridgeH = eaves + look.rise;

    // Along the ridge is "u"; across it is "v". Working in the building's own
    // frame keeps gable and hip identical apart from the inset.
    const alongWidth = look.ridgeAlongWidth;
    const halfU = alongWidth ? hw : hd;
    const halfV = alongWidth ? hd : hw;
    const inset = look.form === 'hip' ? Math.min(halfU * 0.45, halfV) : 0;

    const at = (u: number, v: number, h: number) => {
      const p = alongWidth ? this.local(b, u, v) : this.local(b, v, u);
      return this.project(p.x, p.y, h);
    };

    const ridgeA = at(-halfU + inset, 0, ridgeH);
    const ridgeB = at(halfU - inset, 0, ridgeH);

    const eaveNegA = at(-halfU, -halfV, eaves);
    const eaveNegB = at(halfU, -halfV, eaves);
    const eavePosA = at(-halfU, halfV, eaves);
    const eavePosB = at(halfU, halfV, eaves);

    // Which long slope is nearer the viewer decides draw order.
    const centreNeg = alongWidth ? this.local(b, 0, -halfV) : this.local(b, -halfV, 0);
    const centrePos = alongWidth ? this.local(b, 0, halfV) : this.local(b, halfV, 0);
    const negFirst = centreNeg.x + centreNeg.y < centrePos.x + centrePos.y;

    const slopeNeg = () =>
      g.poly([
        eaveNegA.x, eaveNegA.y, eaveNegB.x, eaveNegB.y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ]).fill({ color: shade(roof, 0.08), alpha });

    const slopePos = () =>
      g.poly([
        eavePosA.x, eavePosA.y, eavePosB.x, eavePosB.y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ]).fill({ color: shade(roof, -0.16), alpha });

    if (negFirst) {
      slopeNeg();
      slopePos();
    } else {
      slopePos();
      slopeNeg();
    }

    if (look.form === 'hip') {
      // Hipped ends are roof, not wall.
      g.poly([
        eaveNegA.x, eaveNegA.y, eavePosA.x, eavePosA.y, ridgeA.x, ridgeA.y,
      ]).fill({ color: shade(roof, -0.05), alpha });
      g.poly([
        eaveNegB.x, eaveNegB.y, eavePosB.x, eavePosB.y, ridgeB.x, ridgeB.y,
      ]).fill({ color: shade(roof, -0.05), alpha });
    } else {
      // Gable ends are wall carried up to the ridge — the silhouette that reads
      // most strongly as a house.
      g.poly([
        eaveNegA.x, eaveNegA.y, eavePosA.x, eavePosA.y, ridgeA.x, ridgeA.y,
      ]).fill({ color: shade(wall, -0.2), alpha });
      g.poly([
        eaveNegB.x, eaveNegB.y, eavePosB.x, eavePosB.y, ridgeB.x, ridgeB.y,
      ]).fill({ color: shade(wall, -0.2), alpha });
    }
  }

  /** A spire for a church, a stack for a foundry. Landmarks, either way. */
  private drawTower(
    g: Graphics,
    b: Building,
    look: Appearance,
    ground: number,
    alpha: number,
    wall: number,
    roof: number,
  ): void {
    const tower = look.tower!;
    const type = buildingType(b.typeId);
    const half = tower.width / 2;
    const offset = -type.width / 2 + half + 0.5;
    const topH = ground + tower.height;

    const corners = [
      this.local(b, offset - half, -half),
      this.local(b, offset + half, -half),
      this.local(b, offset + half, half),
      this.local(b, offset - half, half),
    ];
    const base = corners.map((c) => this.project(c.x, c.y, ground));
    const cap = corners.map((c) => this.project(c.x, c.y, topH));

    const faces = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return { i, j, depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2 };
      })
      .sort((a, c) => a.depth - c.depth);

    for (const f of faces) {
      const sideOn = Math.abs(corners[f.j].x - corners[f.i].x) > Math.abs(corners[f.j].y - corners[f.i].y);
      g.poly([
        cap[f.i].x, cap[f.i].y,
        cap[f.j].x, cap[f.j].y,
        base[f.j].x, base[f.j].y,
        base[f.i].x, base[f.i].y,
      ]).fill({ color: shade(wall, sideOn ? -0.16 : -0.3), alpha });
    }

    // A narrow stack is a chimney and stops here; a broad one gets its spire.
    if (tower.width < 3.5) {
      g.poly([
        cap[0].x, cap[0].y, cap[1].x, cap[1].y, cap[2].x, cap[2].y, cap[3].x, cap[3].y,
      ]).fill({ color: shade(wall, -0.4), alpha });
      return;
    }

    const apexPoint = this.local(b, offset, 0);
    const apex = this.project(apexPoint.x, apexPoint.y, topH + tower.width * 1.8);
    for (const f of faces) {
      g.poly([
        cap[f.i].x, cap[f.i].y, cap[f.j].x, cap[f.j].y, apex.x, apex.y,
      ]).fill({ color: shade(roof, f.depth > 0 ? -0.18 : 0.06), alpha });
    }
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
