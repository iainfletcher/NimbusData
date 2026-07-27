import { Container, Graphics } from 'pixi.js';
import {
  CELL_SIZE,
  fbm,
  type DecorItem,
  COHERENCE_THRESHOLD,
  CHARACTER_COUNT,
  buildingType,
  type Building,
  type Fabric,
  type Road,
  type StreetVertex,
  type Person,
  type Vec2,
  type World,
} from '../sim';
import { WORLD_SIZE } from '../sim';
import { ROAD_HALF_WIDTH, walkRoad } from '../sim';
import { Camera } from './camera';
import { appearanceOf, TIMBER_FRAME, type Appearance } from './appearance';
import { drawDecorItem, type DecorContext } from './decor';
import { CHARACTER_COLOURS, shade, terrainColour, waterColour } from './palette';
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
  /**
   * Buildings, decor and people all have to sort against each other, but the
   * first two are static and the third moves every frame. Redrawing thousands of
   * trees at 60fps to keep one pedestrian behind a house would be absurd, so the
   * world is sliced into depth bands: static content is cached per band, and a
   * people layer is interleaved between each pair. Sorting is then correct to
   * within one band, and only the people layers are rebuilt each frame.
   */
  private staticBands: Graphics[] = [];
  private peopleBands: Graphics[] = [];
  private ghost = new Graphics();
  private elapsed = 0;

  private projection: Projection;
  private terrainCacheMode: ViewMode | null = null;
  private terrainCacheShape = -1;

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
    this.root.addChild(this.terrain, this.streets, this.roads, this.overlay);

    for (let i = 0; i < DEPTH_BANDS; i++) {
      const statics = new Graphics();
      const people = new Graphics();
      this.staticBands.push(statics);
      this.peopleBands.push(people);
      this.root.addChild(statics, people);
    }

    this.root.addChild(this.ghost);
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

  render(dtSeconds = 0): void {
    this.elapsed += dtSeconds;

    if (
      this.terrainCacheMode !== this.mode ||
      this.terrainCacheShape !== this.world.terrain.shape
    ) {
      this.drawTerrain();
      this.terrainCacheMode = this.mode;
      this.terrainCacheShape = this.world.terrain.shape;
      // Everything else sits on the ground, so it moves when the ground does.
      this.streetsDirty = true;
      this.overlayDirty = true;
      this.buildingsDirty = true;
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

    this.drawPeople();

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

        // Break up the flat green: patchy grazing, drier ground, bare scrapes.
        const patch = (fbm(wx / 55, wy / 55, this.world.seed ^ 0xa17, 2) - 0.5) * 0.2;
        const colour = shade(terrainColour(avg), relief + patch);

        const p00 = this.project(wx, wy, h00);
        const p10 = this.project(wx + s, wy, h10);
        const p11 = this.project(wx + s, wy + s, h11);
        const p01 = this.project(wx, wy + s, h01);

        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill(colour);
      }
    }

    // Water is drawn at full grid resolution, not decimated like the ground: a
    // stream is one cell wide, so sampling every other cell skips half of it and
    // a continuous river renders as a dashed line.
    this.drawWater(g);
  }

  /**
   * Water is drawn from the derived surface rather than from "height below
   * zero": lakes sit at their fill level, rivers follow their channel, and both
   * move the instant the ground under them is reshaped.
   */
  private drawWater(g: Graphics): void {
    const t = this.world.terrain;
    const s = CELL_SIZE;

    for (let cy = 0; cy < t.height; cy++) {
      for (let cx = 0; cx < t.width; cx++) {
        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;

        const level = t.waterAt(wx + s / 2, wy + s / 2);
        if (Number.isNaN(level)) continue;

        const depth = level - t.heightAt(wx + s / 2, wy + s / 2);
        const colour = waterColour(depth);

        // A channel is drawn at least as wide as its catchment deserves, so a
        // trunk river reads as a river rather than as a line of single cells.
        const channel = t.channelWidthAt(wx + s / 2, wy + s / 2);
        const w = Math.max(s, channel);
        const pad = (w - s) / 2;
        const x0 = wx - pad;
        const y0 = wy - pad;
        const x1 = wx + s + pad;
        const y1 = wy + s + pad;

        // A water surface is level, so all four corners share one elevation.
        const p00 = this.project(x0, y0, level);
        const p10 = this.project(x1, y0, level);
        const p11 = this.project(x1, y1, level);
        const p01 = this.project(x0, y1, level);

        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill({
          color: colour,
          alpha: depth < 0.4 ? 0.72 : 1,
        });
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
   *
   * Every kerb is laid before any surface. Drawing each road complete in turn
   * paints the second road's kerb straight across the first road's surface, so
   * every junction ends up with a dark line ruled through it. Two passes make
   * junctions merge into one continuous piece of ground, which is what a
   * junction actually is.
   */
  private drawRoads(): void {
    const g = this.roads;
    g.clear();

    const laid = this.world.roads
      .map((road) => {
        const halfWidth = ROAD_HALF_WIDTH[road.cls];
        const centre: Vec2[] = [];
        walkRoad(road, 6, (p) => centre.push(p));
        return { road, halfWidth, verts: centre.map((p) => ({ ...p, halfWidth })) };
      })
      .filter((r) => r.verts.length >= 2);

    // Pass one: kerbs, and a rounded corner at every turn and terminus.
    for (const r of laid) {
      this.fillRibbon(g, r.verts, ROAD_EDGE, 1.5);
      for (const p of r.road.points) {
        this.groundDisc(g, p, r.halfWidth + 1.5, ROAD_EDGE);
      }
    }

    // Pass two: surfaces, which cover every kerb they cross.
    for (const r of laid) {
      this.fillRibbon(g, r.verts, ROAD, 0);
      for (const p of r.road.points) {
        this.groundDisc(g, p, r.halfWidth, ROAD);
      }
    }
  }

  /**
   * A disc lying flat on the ground. In isometric a ground circle projects to an
   * axis-aligned ellipse with semi-axes r/√2 and r/(2√2), so this is exact
   * rather than a fudge.
   */
  private groundDisc(g: Graphics, at: Vec2, radius: number, colour: number): void {
    const p = this.projectOnGround(at);
    if (this.mode === 'plan') {
      g.circle(p.x, p.y, radius).fill(colour);
      return;
    }
    g.ellipse(p.x, p.y, radius * 0.7071, radius * 0.3536).fill(colour);
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

  /** Highlight a worn path the player is about to pave. */
  setPaveHighlight(path: StreetVertex[] | null): void {
    const g = this.ghost;
    if (!path || path.length < 2) return;
    this.fillRibbon(
      g,
      path.map((v) => ({ ...v, halfWidth: v.halfWidth + 0.8 })),
      0xf0dfa6,
      0,
    );
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

  private decorContext(): DecorContext {
    return {
      project: (wx, wy, h) => this.project(wx, wy, h),
      groundAt: (wx, wy) => this.world.terrain.heightAt(wx, wy),
      isPlan: this.mode === 'plan',
    };
  }

  /**
   * Buildings and generated detail are drawn in one pass, sorted back to front
   * together — otherwise a tree in front of a house would be painted behind it.
   */
  private drawBuildings(): void {
    for (const band of this.staticBands) band.clear();

    type Entry = { depth: number; building?: Building; decor?: DecorItem };
    const entries: Entry[] = [];

    for (const b of this.world.buildings) {
      entries.push({ depth: b.pos.x + b.pos.y, building: b });
    }
    for (const d of this.world.decor.items) {
      entries.push({ depth: d.pos.x + d.pos.y, decor: d });
    }
    entries.sort((a, b) => a.depth - b.depth);

    const ctx = this.decorContext();
    for (const e of entries) {
      const g = this.staticBands[depthBand(e.depth)];
      if (e.building) this.drawBuilding(g, e.building, 1);
      else drawDecorItem(g, ctx, e.decor!);
    }
  }

  /**
   * People, redrawn every frame into their depth band so a figure walking behind
   * a house is painted behind it.
   */
  private drawPeople(): void {
    for (const band of this.peopleBands) band.clear();

    const people = this.world.crowd.people;
    if (people.length === 0) return;

    const plan = this.mode === 'plan';
    for (const person of people) {
      const g = this.peopleBands[depthBand(person.pos.x + person.pos.y)];
      this.drawPerson(g, person, plan);
    }
  }

  private drawPerson(g: Graphics, person: Person, plan: boolean): void {
    const ground = this.world.terrain.heightAt(person.pos.x, person.pos.y);
    const base = this.project(person.pos.x, person.pos.y, ground);
    const colour = CLOTHING[person.tint % CLOTHING.length];

    if (plan) {
      g.circle(base.x, base.y, 0.88).fill(colour);
      return;
    }

    // Deliberately out of scale. A correctly proportioned person is a two-pixel
    // sliver next to a house and reads as noise; toy cities want chunky figures,
    // as Theme Park and Settlers both understood.
    const bob = Math.sin(this.elapsed * person.speed * 5.5 + person.phase) * 0.1;
    const head = this.project(person.pos.x, person.pos.y, ground + 2.48 + bob);
    const shoulder = this.project(person.pos.x, person.pos.y, ground + 1.92 + bob);

    // A scrap of shadow, which is most of what roots a figure to the ground.
    g.ellipse(base.x, base.y, 0.64, 0.32).fill({ color: 0x2f3a2c, alpha: 0.3 });

    const halfW = 0.42;
    g.poly([
      base.x - halfW * 0.8, base.y,
      base.x + halfW * 0.8, base.y,
      shoulder.x + halfW, shoulder.y,
      shoulder.x - halfW, shoulder.y,
    ]).fill(colour);

    g.circle(head.x, head.y, 0.5).fill(SKIN);
  }

  /** Small deterministic per-building variation, so a terrace isn't clones. */
  private jitter(id: number, salt: number): number {
    const h = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return h - Math.floor(h);
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
    // Weathering: no two buildings in a row are quite the same shade or height.
    const vw = (this.jitter(b.id, 1) - 0.5) * 0.14;
    const vr = (this.jitter(b.id, 2) - 0.5) * 0.16;
    const vh = 0.93 + this.jitter(b.id, 3) * 0.14;
    const wall = tint ?? shade(look.wall, vw);
    const roof = tint ?? shade(look.roof, vr);
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

    const eavesHeight = look.form === 'flat' ? look.eaves : look.eaves * vh;
    const eaves = ground + eavesHeight;
    const base = corners.map((c) => this.project(c.x, c.y, ground));
    const top = corners.map((c) => this.project(c.x, c.y, eaves));

    // Walls, back to front. Any rotation is allowed, so sort rather than assume.
    const walls = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return { i, j, depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2 };
      })
      .sort((a, c) => a.depth - c.depth);

    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi];
      const sideOn =
        Math.abs(corners[w.j].x - corners[w.i].x) > Math.abs(corners[w.j].y - corners[w.i].y);
      const face = shade(wall, sideOn ? -0.12 : -0.26);

      g.poly([
        top[w.i].x, top[w.i].y,
        top[w.j].x, top[w.j].y,
        base[w.j].x, base[w.j].y,
        base[w.i].x, base[w.i].y,
      ]).fill({ color: face, alpha });

      // Openings only on the walls actually facing the camera, and a door only
      // on the nearest one — a building with four front doors looks wrong.
      if (!tint && look.form !== 'flat' && wi >= walls.length - 2) {
        const length = Math.hypot(
          corners[w.j].x - corners[w.i].x,
          corners[w.j].y - corners[w.i].y,
        );
        this.drawOpenings(
          g,
          [base[w.i], base[w.j], top[w.j], top[w.i]],
          length,
          eavesHeight,
          face,
          wi === walls.length - 1,
          look.framed === true,
        );
      }
    }

    if (look.form === 'flat') {
      g.poly([
        top[0].x, top[0].y, top[1].x, top[1].y, top[2].x, top[2].y, top[3].x, top[3].y,
      ]).fill({ color: shade(wall, 0.1), alpha });
    } else {
      this.drawRoof(g, b, look, eaves, alpha, wall, roof);
      if (!tint) this.drawChimney(g, b, look, eaves, roof);
    }

    if (look.tower) this.drawTower(g, b, look, ground, alpha, wall, roof);
  }

  /**
   * Windows and a door, placed on a wall face by interpolating its projected
   * corners. The projection is affine, so this is exact rather than approximate.
   *
   * Openings are what make a wall read as inhabited rather than as a slab, and
   * at this scale they cost four points each.
   */
  private drawOpenings(
    g: Graphics,
    face: [Point, Point, Point, Point],
    worldLength: number,
    worldHeight: number,
    wallColour: number,
    withDoor: boolean,
    framed: boolean,
  ): void {
    const [b0, b1, t1, t0] = face;

    // u runs along the wall, v up it.
    const at = (u: number, v: number): Point => ({
      x: b0.x + (b1.x - b0.x) * u + ((t0.x - b0.x) + ((t1.x - b1.x) - (t0.x - b0.x)) * u) * v,
      y: b0.y + (b1.y - b0.y) * u + ((t0.y - b0.y) + ((t1.y - b1.y) - (t0.y - b0.y)) * u) * v,
    });

    const quad = (u0: number, v0: number, u1: number, v1: number, colour: number) => {
      const p00 = at(u0, v0);
      const p10 = at(u1, v0);
      const p11 = at(u1, v1);
      const p01 = at(u0, v1);
      g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill(colour);
    };

    const glass = shade(wallColour, -0.52);
    const door = shade(wallColour, -0.62);

    const columns = Math.max(1, Math.min(6, Math.floor(worldLength / 3.4)));
    const rows = Math.max(1, Math.min(3, Math.floor(worldHeight / 3.1)));

    const winW = Math.min(0.16, (0.8 / columns) * 0.62);
    const winH = Math.min(0.2, (0.72 / rows) * 0.6);

    for (let r = 0; r < rows; r++) {
      const v = 0.24 + (r * 0.62) / rows;
      for (let c = 0; c < columns; c++) {
        const u = (c + 0.5) / columns;
        // Ground-floor centre is the doorway, so skip the window there.
        if (withDoor && r === 0 && Math.abs(u - 0.5) < 0.5 / columns) continue;
        quad(u - winW / 2, v, u + winW / 2, v + winH, glass);
      }
    }

    if (withDoor) {
      const w = Math.min(0.13, 0.6 / columns);
      quad(0.5 - w / 2, 0.02, 0.5 + w / 2, 0.02 + Math.min(0.34, 2.1 / worldHeight), door);
    }

    // Exposed frame: posts, a sill and a wall plate. Drawn last so the beams sit
    // over the render, which is how a timber-framed wall actually goes together.
    if (framed) {
      const beam = TIMBER_FRAME;
      const posts = Math.max(2, Math.min(7, Math.round(worldLength / 2.4)));
      const thickness = Math.min(0.035, 0.5 / posts);

      for (let i = 0; i <= posts; i++) {
        const u = i / posts;
        quad(
          Math.max(0, u - thickness),
          0,
          Math.min(1, u + thickness),
          1,
          beam,
        );
      }
      quad(0, 0.94, 1, 1, beam);
      if (worldHeight > 5) quad(0, 0.45, 1, 0.51, beam);
      quad(0, 0, 1, 0.05, beam);
    }
  }

  /** A stack at the gable end. Most of what says "somebody lives here". */
  private drawChimney(
    g: Graphics,
    b: Building,
    look: Appearance,
    eaves: number,
    roof: number,
  ): void {
    const type = buildingType(b.typeId);
    if (look.tower || type.family === 'economic') return;
    if (Math.min(type.width, type.depth) < 6) return;

    const halfU = (look.ridgeAlongWidth ? type.width : type.depth) / 2;
    const u = halfU - 1.2;
    const p = look.ridgeAlongWidth ? this.local(b, u, 0) : this.local(b, 0, u);

    const w = 0.7;
    const corners = [
      { x: p.x - w, y: p.y - w },
      { x: p.x + w, y: p.y - w },
      { x: p.x + w, y: p.y + w },
      { x: p.x - w, y: p.y + w },
    ];
    const bottom = corners.map((c) => this.project(c.x, c.y, eaves));
    const cap = corners.map((c) => this.project(c.x, c.y, eaves + look.rise + 1.6));

    for (const i of [0, 1, 2, 3]) {
      const j = (i + 1) % 4;
      g.poly([
        cap[i].x, cap[i].y, cap[j].x, cap[j].y, bottom[j].x, bottom[j].y, bottom[i].x, bottom[i].y,
      ]).fill(shade(roof, -0.3));
    }
    g.poly([
      cap[0].x, cap[0].y, cap[1].x, cap[1].y, cap[2].x, cap[2].y, cap[3].x, cap[3].y,
    ]).fill(shade(roof, -0.5));
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
    // The roof oversails the walls. A flush roof reads as a box; an overhang is
    // most of what makes a building look built rather than extruded.
    const over = look.overhang ?? 0.5;
    const halfU = (alongWidth ? hw : hd) + over;
    const halfV = (alongWidth ? hd : hw) + over;
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

    // A ridge cap, so the two slopes meet in a line rather than a seam.
    g.poly([
      ridgeA.x, ridgeA.y - 0.6, ridgeB.x, ridgeB.y - 0.6,
      ridgeB.x, ridgeB.y + 0.5, ridgeA.x, ridgeA.y + 0.5,
    ]).fill({ color: shade(roof, -0.3), alpha });

    if (look.dormers) this.drawDormers(g, look, at, halfU, halfV, eaves, ridgeH, alpha, wall, roof);

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
      // most strongly as a house. They stand on the wall line, inside the eaves.
      const wallU = halfU - over;
      const wallV = halfV - over;
      const gNegA = at(-wallU, -wallV, eaves);
      const gPosA = at(-wallU, wallV, eaves);
      const gNegB = at(wallU, -wallV, eaves);
      const gPosB = at(wallU, wallV, eaves);
      const apexA = at(-wallU, 0, ridgeH);
      const apexB = at(wallU, 0, ridgeH);

      g.poly([
        gNegA.x, gNegA.y, gPosA.x, gPosA.y, apexA.x, apexA.y,
      ]).fill({ color: shade(wall, -0.2), alpha });
      g.poly([
        gNegB.x, gNegB.y, gPosB.x, gPosB.y, apexB.x, apexB.y,
      ]).fill({ color: shade(wall, -0.2), alpha });
    }
  }

  /**
   * Dormers: little gabled windows pushed through the roof slope. Cheap, and
   * they do more for the character of a row of housing than anything else here.
   */
  private drawDormers(
    g: Graphics,
    look: Appearance,
    at: (u: number, v: number, h: number) => Point,
    halfU: number,
    halfV: number,
    eaves: number,
    ridgeH: number,
    alpha: number,
    wall: number,
    roof: number,
  ): void {
    const n = look.dormers ?? 0;
    if (n < 1) return;

    // Two thirds of the way up the slope, facing the near side.
    const t = 0.52;
    const v = halfV * (1 - t);
    const h = eaves + (ridgeH - eaves) * t;
    const halfSpan = halfU * 0.72;
    const width = Math.min(1.5, (halfSpan * 1.6) / (n * 2.2));

    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -halfSpan + (2 * halfSpan * i) / (n - 1);

      const faceL = at(u - width, v, h);
      const faceR = at(u + width, v, h);
      const topL = at(u - width, v, h + 1.5);
      const topR = at(u + width, v, h + 1.5);
      const apex = at(u, v, h + 2.4);
      const backL = at(u - width, v + 1.4, h + 1.5);
      const backR = at(u + width, v + 1.4, h + 1.5);

      // Cheek, face, gable and a little roof over it.
      g.poly([
        faceL.x, faceL.y, topL.x, topL.y, backL.x, backL.y,
      ]).fill({ color: shade(roof, -0.24), alpha });
      g.poly([
        faceL.x, faceL.y, faceR.x, faceR.y, topR.x, topR.y, topL.x, topL.y,
      ]).fill({ color: shade(wall, -0.06), alpha });
      g.poly([
        topL.x, topL.y, topR.x, topR.y, apex.x, apex.y,
      ]).fill({ color: shade(wall, -0.18), alpha });
      g.poly([
        topL.x, topL.y, topR.x, topR.y, backR.x, backR.y, backL.x, backL.y,
      ]).fill({ color: shade(roof, 0.12), alpha });

      // The window itself.
      const wl = at(u - width * 0.55, v, h + 0.35);
      const wr = at(u + width * 0.55, v, h + 0.35);
      const wtl = at(u - width * 0.55, v, h + 1.2);
      const wtr = at(u + width * 0.55, v, h + 1.2);
      g.poly([
        wl.x, wl.y, wr.x, wr.y, wtr.x, wtr.y, wtl.x, wtl.y,
      ]).fill({ color: shade(wall, -0.55), alpha });
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

/**
 * Depth bands used to interleave moving people with cached static content. More
 * bands means finer sorting; 64 puts the error under about 25m of world depth.
 */
const DEPTH_BANDS = 64;

function depthBand(depth: number): number {
  const t = depth / (WORLD_SIZE * 2);
  return Math.max(0, Math.min(DEPTH_BANDS - 1, Math.floor(t * DEPTH_BANDS)));
}

/** Muted working clothes: madder, woad, undyed wool, russet. */
const CLOTHING = [0x6b4a3a, 0x4a5568, 0x7a6a52, 0x8a4a42, 0x55613f, 0x6a5a6a];
const SKIN = 0xc9a887;

/**
 * Offset a centreline to both kerbs, mitring at each vertex.
 *
 * The mitre has to be limited. Averaging the two segment directions blows up as
 * the turn approaches 180° — the offset shoots off to infinity and the ribbon
 * folds through itself, which shows up as a large stray wedge across the map.
 * Clamping to a mitre limit turns that into a blunt corner instead.
 */
const MITRE_LIMIT = 2.2;

function offsetPath(path: StreetVertex[]): { left: Vec2[]; right: Vec2[] } {
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  const normalOf = (a: Vec2, b: Vec2): Vec2 | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    return { x: -dy / len, y: dx / len };
  };

  for (let i = 0; i < path.length; i++) {
    const inNormal = i > 0 ? normalOf(path[i - 1], path[i]) : null;
    const outNormal = i < path.length - 1 ? normalOf(path[i], path[i + 1]) : null;

    let nx: number;
    let ny: number;
    let scale = 1;

    if (inNormal && outNormal) {
      const mx = inNormal.x + outNormal.x;
      const my = inNormal.y + outNormal.y;
      const len = Math.hypot(mx, my);

      if (len < 1e-3) {
        // A hairpin: there is no sensible mitre, so square the end off.
        nx = outNormal.x;
        ny = outNormal.y;
      } else {
        nx = mx / len;
        ny = my / len;
        const cos = nx * outNormal.x + ny * outNormal.y;
        scale = Math.min(MITRE_LIMIT, cos > 1e-3 ? 1 / cos : MITRE_LIMIT);
      }
    } else {
      const n = inNormal ?? outNormal ?? { x: 0, y: 1 };
      nx = n.x;
      ny = n.y;
    }

    const w = path[i].halfWidth * scale;
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
