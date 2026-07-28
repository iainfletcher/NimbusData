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
  channelWidth,
  CATCHMENT,
  RESOURCES,
  WALK_TO_WORK,
  type Person,
  type Season,
  type Vec2,
  type Warband,
  type World,
} from '../sim';
import { WORLD_SIZE } from '../sim';
import { ROAD_HALF_WIDTH, walkRoad } from '../sim';
import { Camera } from './camera';
import { appearanceOf, TIMBER_FRAME } from './appearance';
import { deriveFacade, type Panel } from './grammar';
import { drawDecorItem, type DecorContext } from './decor';
import {
  BANNER_COLOURS,
  CHARACTER_COLOURS,
  CONTESTED_COLOUR,
  FLAT_LAMBERT,
  FRONTIER_COLOUR,
  RESOURCE_COLOURS,
  GROUND_SEASON,
  SUN,
  TERRITORY_COLOURS,
  lambertOf,
  lit,
  shade,
  terrainColour,
  toward,
  waterColour,
} from './palette';
import { massOf, type Block } from './massing';
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

/** Metres of shadow per metre of height. */
const SHADOW_LENGTH = 0.85;
const SHADOW_COLOUR = 0x1d2a1c;
const SHADOW_ALPHA = 0.3;

export class WorldView {
  readonly root = new Container();

  private terrain = new Graphics();
  private streets = new Graphics();
  private roads = new Graphics();
  private overlay = new Graphics();
  private border = new Graphics();
  /**
   * Buildings, decor and people all have to sort against each other, but the
   * first two are static and the third moves every frame. Redrawing thousands of
   * trees at 60fps to keep one pedestrian behind a house would be absurd, so the
   * world is sliced into depth bands: static content is cached per band, and a
   * people layer is interleaved between each pair. Sorting is then correct to
   * within one band, and only the people layers are rebuilt each frame.
   */
  private shadows = new Graphics();
  private staticBands: Graphics[] = [];
  private peopleBands: Graphics[] = [];
  private dirtyPeopleBands = new Set<number>();
  private ghost = new Graphics();
  private site = new Graphics();
  private siteKey = '';
  private elapsed = 0;

  private projection: Projection;
  private terrainCacheMode: ViewMode | null = null;
  private terrainCacheShape = -1;
  private terrainCacheSeason: Season | null = null;

  private buildingsDirty = true;
  private overlayDirty = true;
  private streetsDirty = true;
  private lastFabricVersion = -1;
  private lastSeason: Season | null = null;

  showOverlay = false;
  /**
   * Which overlay the diagnostic layer is showing.
   *
   * `character` answers "what kind of place is this"; `land` answers "what is
   * this ground *worth*". The second is what makes siting a works a decision
   * rather than a guess, and it had simply never been drawn.
   */
  overlayMode: 'character' | 'land' = 'character';
  showStreets = true;
  showBorders = false;
  private borderVersion = -1;
  private selectedBand: number | null = null;

  constructor(
    private world: World,
    private camera: Camera,
    private mode: ViewMode = 'iso',
  ) {
    this.projection = projectionFor(mode);
    // Worn paths first, then made roads over them: a road is the more definite
    // thing and should visibly cut across the tracks that predate it.
    // Shadows lie on the ground, over roads and paths, under everything upright.
    this.root.addChild(
      this.terrain,
      this.streets,
      this.roads,
      this.shadows,
      this.border,
      this.overlay,
    );

    for (let i = 0; i < DEPTH_BANDS; i++) {
      const statics = new Graphics();
      const people = new Graphics();
      this.staticBands.push(statics);
      this.peopleBands.push(people);
      this.root.addChild(statics, people);
    }

    this.root.addChild(this.site, this.ghost);
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

  /**
   * Show what a site is worth before it is paid for.
   *
   * Two rings: the **catchment** a producer would draw its material from, filled
   * with the resource it harvests so you can see whether there is anything
   * there, and the **walk to work**, so you can see whether anybody could staff
   * it. Those are the only two questions siting a works asks, and until now the
   * game answered neither.
   */
  setSitePreview(typeId: string | null, pos: Vec2 | null): void {
    const key = typeId && pos ? `${typeId}:${pos.x.toFixed(1)}:${pos.y.toFixed(1)}` : '';
    if (key === this.siteKey) return;
    this.siteKey = key;

    const g = this.site;
    g.clear();
    if (!typeId || !pos) return;

    const type = buildingType(typeId);
    if (!type.harvests && !type.jobs) return;

    const ring = (radius: number, colour: number, alpha: number, width: number) => {
      const pts: number[] = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const x = pos.x + Math.cos(a) * radius;
        const y = pos.y + Math.sin(a) * radius;
        const p = this.project(x, y, this.world.terrain.heightAt(x, y));
        pts.push(p.x, p.y);
      }
      g.poly(pts).stroke({ color: colour, width, alpha });
      return pts;
    };

    if (type.harvests) {
      const colour = RESOURCE_COLOURS[type.harvests];
      const land = this.world.land;
      const step = 2;
      const s = CELL_SIZE * step;
      const c0 = Math.max(0, Math.floor((pos.x - CATCHMENT) / CELL_SIZE));
      const c1 = Math.min(land.width - 1, Math.ceil((pos.x + CATCHMENT) / CELL_SIZE));
      const r0 = Math.max(0, Math.floor((pos.y - CATCHMENT) / CELL_SIZE));
      const r1 = Math.min(land.height - 1, Math.ceil((pos.y + CATCHMENT) / CELL_SIZE));

      for (let cy = r0; cy <= r1; cy += step) {
        for (let cx = c0; cx <= c1; cx += step) {
          const wx = (cx + 0.5) * CELL_SIZE;
          const wy = (cy + 0.5) * CELL_SIZE;
          if (Math.hypot(wx - pos.x, wy - pos.y) > CATCHMENT) continue;
          const v = land[type.harvests][cy * land.width + cx];
          if (v < 0.08) continue;

          const p00 = this.project(cx * CELL_SIZE, cy * CELL_SIZE, this.world.terrain.heightAtCell(cx, cy));
          const p10 = this.project(cx * CELL_SIZE + s, cy * CELL_SIZE, this.world.terrain.heightAtCell(cx + step, cy));
          const p11 = this.project(cx * CELL_SIZE + s, cy * CELL_SIZE + s, this.world.terrain.heightAtCell(cx + step, cy + step));
          const p01 = this.project(cx * CELL_SIZE, cy * CELL_SIZE + s, this.world.terrain.heightAtCell(cx, cy + step));
          g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill({
            color: colour,
            alpha: Math.min(0.7, 0.14 + v * 0.6),
          });
        }
      }
      ring(CATCHMENT, colour, 0.9, 0.7);
    }

    if (type.jobs) ring(WALK_TO_WORK, 0x7fa7c8, 0.6, 0.5);
  }

  /** Which warband the player has picked up, so it can be marked on the ground. */
  setSelectedBand(id: number | null): void {
    this.selectedBand = id;
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
      this.terrainCacheShape !== this.world.terrain.shape ||
      this.terrainCacheSeason !== this.world.calendar.season
    ) {
      this.drawTerrain();
      this.terrainCacheMode = this.mode;
      this.terrainCacheShape = this.world.terrain.shape;
      this.terrainCacheSeason = this.world.calendar.season;
      // Everything else sits on the ground, so it moves when the ground does.
      this.streetsDirty = true;
      this.overlayDirty = true;
      this.buildingsDirty = true;
    }

    // Foliage turns with the year, and the static bands are cached — so the
    // season has to invalidate them or the wood would stay green through winter.
    if (this.world.calendar.season !== this.lastSeason) {
      this.lastSeason = this.world.calendar.season;
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
      this.drawShadows();
      this.buildingsDirty = false;
    }

    // The claim drifts continuously, so the border is redrawn on a cadence
    // rather than only when something is built.
    const borderTick = this.world.ticks >> 3;
    if (this.showBorders && borderTick !== this.borderVersion) {
      this.borderVersion = borderTick;
      this.drawBorders();
    }

    this.drawPeople();

    this.shadows.visible = this.mode === 'iso';
    this.border.visible = this.showBorders;
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
    const ground = GROUND_SEASON[this.world.calendar.season];

    for (let cy = 0; cy < t.height; cy += step) {
      for (let cx = 0; cx < t.width; cx += step) {
        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;

        // Sampling exactly on cell corners, so read the grid rather than paying
        // for a bilinear filter 65,000 times.
        const h00 = t.heightAtCell(cx, cy);
        const h10 = t.heightAtCell(cx + step, cy);
        const h01 = t.heightAtCell(cx, cy + step);
        const h11 = t.heightAtCell(cx + step, cy + step);
        const avg = (h00 + h10 + h01 + h11) / 4;

        // Shading against the same sun everything else uses, which is what makes
        // the landform read as landform rather than as a colour ramp — and, now
        // that it goes through `lit`, puts the ground on the same warm key and
        // cool fill as the buildings standing on it. A hillside turning away
        // from the sun and a wall turning away from it agree, so the town sits
        // in the landscape instead of on top of it.
        const gx = ((h10 + h11) - (h00 + h01)) / (2 * s);
        const gy = ((h01 + h11) - (h00 + h10)) / (2 * s);

        // Measured *against level ground*, not against zero. Feeding the raw
        // lambert in tinted the entire map warm, because flat ground faces a sun
        // 38° up and therefore reads as strongly lit — technically true and
        // visually useless, since it left no headroom for an actual hillside.
        // Centring on the flat case keeps a meadow its own green and spends the
        // whole range on relief.
        const lambert = (lambertOf(-gx, -gy, 1) - FLAT_LAMBERT) * 2.4;

        // Break up the flat green: patchy grazing, drier ground, bare scrapes.
        const patch = (fbm(wx / 62, wy / 62, this.world.seed ^ 0xa17, 2) - 0.5) * 0.15;
        const turned = toward(terrainColour(avg), ground.tint, ground.mix);
        const colour = lit(shade(turned, patch), lambert);

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
    const hydro = t.hydrology;
    const s = CELL_SIZE;

    for (let cy = 0; cy < t.height; cy++) {
      let runStart = -1;
      let runLevel = 0;
      let runColour = 0;

      /** Emit the standing-water run ending before cx as a single quad. */
      const flush = (cx: number) => {
        if (runStart < 0) return;
        const x0 = runStart * CELL_SIZE;
        const x1 = cx * CELL_SIZE;
        const y0 = cy * CELL_SIZE;
        const y1 = y0 + s;

        const p00 = this.project(x0, y0, runLevel);
        const p10 = this.project(x1, y0, runLevel);
        const p11 = this.project(x1, y1, runLevel);
        const p01 = this.project(x0, y1, runLevel);
        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill(runColour);
        runStart = -1;
      };

      for (let cx = 0; cx < t.width; cx++) {
        const i = cy * t.width + cx;
        const level = hydro.surface[i];
        if (Number.isNaN(level)) {
          flush(cx);
          continue;
        }

        const depth = level - t.heightAtCell(cx, cy);
        const colour = waterColour(depth);

        // Standing water tiles cleanly as squares; a running channel does not.
        // A stream crossing the grid diagonally comes out as a staircase of
        // blue boxes, so channels are drawn as overlapping discs instead, which
        // merge into a continuous course whatever direction they run.
        if (depth < 1) {
          flush(cx);
          // Cell centres are s√2 apart on the diagonal, so a channel narrower
          // than that leaves gaps and the stream reads as a string of beads.
          const channel = Math.max(s * 1.62, channelWidth(hydro.accumulation[i]));
          const p = this.project(cx * CELL_SIZE + s / 2, cy * CELL_SIZE + s / 2, level);
          const r = channel / 2;
          if (this.mode === 'plan') g.circle(p.x, p.y, r).fill(colour);
          else g.ellipse(p.x, p.y, r * 1.414, r * 0.707).fill(colour);
          continue;
        }

        // A lake or the sea is a flat sheet, so a whole row of it is one quad
        // rather than eighty. On a coastal map that is thousands of polygons
        // saved for an identical picture.
        if (runStart >= 0 && Math.abs(level - runLevel) < 0.01 && colour === runColour) {
          continue;
        }
        flush(cx);
        runStart = cx;
        runLevel = level;
        runColour = colour;
      }

      flush(t.width);
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
    if (this.overlayMode === 'land') {
      this.drawLandOverlay();
      return;
    }
    this.drawCharacterOverlay();
  }

  /**
   * What the ground is worth: timber, stone, arable and ore, drawn where they
   * are.
   *
   * Each cell takes the colour of whichever resource is strongest there, at an
   * alpha that follows how much of it there is — so a wood reads as a solid
   * green mass, a thin scatter of stone reads as a wash, and an ore seam reads
   * as a small hard patch of rust you can go and build on. One glance answers
   * the only question siting a works asks.
   */
  private drawLandOverlay(): void {
    const g = this.overlay;
    g.clear();

    const land = this.world.land;
    const t = this.world.terrain;
    const step = OVERLAY_STEP;
    const s = CELL_SIZE * step;

    for (let cy = 0; cy < land.height; cy += step) {
      for (let cx = 0; cx < land.width; cx += step) {
        const i = cy * land.width + cx;

        // Normalised against each field's own peak, so a resource shows where
        // it is *good for that resource* rather than where its raw number
        // happens to be biggest. Without this the map is one sheet of arable.
        let best: string | null = null;
        let bestValue = 0.28;
        for (const r of RESOURCES) {
          const v = land[r][i] / land.peak[r];
          if (v > bestValue) {
            bestValue = v;
            best = r;
          }
        }
        if (!best) continue;

        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;
        const p00 = this.project(wx, wy, t.heightAtCell(cx, cy));
        const p10 = this.project(wx + s, wy, t.heightAtCell(cx + step, cy));
        const p11 = this.project(wx + s, wy + s, t.heightAtCell(cx + step, cy + step));
        const p01 = this.project(wx, wy + s, t.heightAtCell(cx, cy + step));

        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill({
          color: RESOURCE_COLOURS[best],
          alpha: Math.min(0.62, (bestValue - 0.28) * 0.85),
        });
      }
    }
  }

  private drawCharacterOverlay(): void {
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

  /**
   * Cast shadows and contact occlusion.
   *
   * Flat-shaded low-poly lives or dies on contact shadows: without them
   * everything looks pasted onto the ground rather than standing on it. Drawn
   * flat, in one layer under all upright geometry, so they need no depth
   * sorting against each other — they simply darken whatever they fall across.
   */
  private drawShadows(): void {
    const g = this.shadows;
    g.clear();
    if (this.mode === 'plan') return;

    const t = this.world.terrain;

    for (const b of this.world.buildings) {
      const look = appearanceOf(b.typeId);
      if (look.form === 'flat') continue;

      const ground = t.heightAt(b.pos.x, b.pos.y);
      const top = look.eaves + look.rise + (look.tower ? look.tower.height * 0.5 : 0);
      const reach = top * SHADOW_LENGTH;

      const base = this.footprint(b);
      const cast: Vec2[] = base.map((c) => ({
        x: c.x + SUN.x * reach,
        y: c.y + SUN.y * reach,
      }));

      // The shadow of a box is the box swept along the light — its convex hull.
      const hull = convexHull([...base, ...cast]);
      const pts: number[] = [];
      for (const p of hull) {
        const sp = this.project(p.x, p.y, t.heightAt(p.x, p.y));
        pts.push(sp.x, sp.y);
      }
      g.poly(pts).fill({ color: SHADOW_COLOUR, alpha: SHADOW_ALPHA });
      void ground;
    }

    // Trees get an offset blob rather than a hull; nobody reads a tree's outline.
    for (const item of this.world.decor.items) {
      if (item.kind !== 'tree' && item.kind !== 'conifer') continue;
      const reach = item.height * SHADOW_LENGTH;
      const x = item.pos.x + SUN.x * reach;
      const y = item.pos.y + SUN.y * reach;
      const p = this.project(x, y, t.heightAt(x, y));
      g.ellipse(p.x, p.y, item.size * 0.85, item.size * 0.45).fill({
        color: SHADOW_COLOUR,
        alpha: SHADOW_ALPHA * 0.8,
      });
    }

    // Contact occlusion: a tight smudge where each thing actually meets the
    // ground, which is what stops it looking like a sticker.
    for (const b of this.world.buildings) {
      const type = buildingType(b.typeId);
      const p = this.projectOnGround(b.pos);
      const r = Math.max(type.width, type.depth) * 0.62;
      g.ellipse(p.x, p.y, r, r * 0.5).fill({ color: SHADOW_COLOUR, alpha: 0.22 });
    }
  }

  /**
   * The border, drawn as the two unlike fields it actually is (design/01 §6).
   *
   * This is the strongest test of Pillar A — "the map is the dashboard" — because
   * two overlapping pressures at one frontier is precisely the case `01` §7 flags
   * as a genuine unknown and a real threat to the no-numbers experiment. Four
   * marks, each carrying one fact:
   *
   * - **Soft wash** — cultural claim. Fades out rather than stopping, so you read
   *   a town's *reach* and not only its edge.
   * - **Pale line** — where two cultures meet. A frontier you can watch move.
   * - **Hatch** — ground merely *held*: inside a military contour that the wash
   *   does not fill. The gap between the hard line and the haze is the gilded
   *   cage, and it is visible without being labelled.
   * - **Banner line** — the military contour. Near-white, one cell wide, hard.
   *
   * The two fields stay apart because they differ in *edge* rather than hue:
   * culture never draws a line, and the military never draws a gradient.
   */
  private drawBorders(): void {
    const g = this.border;
    g.clear();

    const territory = this.world.territory;
    const military = this.world.military;
    const armed = military.anyPresence;
    const t = this.world.terrain;
    const step = 2;
    const s = CELL_SIZE * step;

    for (let cy = 0; cy < territory.height; cy += step) {
      for (let cx = 0; cx < territory.width; cx += step) {
        const claim = territory.claim[cy * territory.width + cx];
        const strength = Math.abs(claim);
        const holder = armed ? military.holderAtCell(cx, cy) : null;
        const contested = armed && military.contestedAtCell(cx, cy);
        if (strength < 0.06 && holder === null && !contested) continue;

        const wx = cx * CELL_SIZE;
        const wy = cy * CELL_SIZE;

        const p00 = this.project(wx, wy, t.heightAtCell(cx, cy));
        const p10 = this.project(wx + s, wy, t.heightAtCell(cx + step, cy));
        const p11 = this.project(wx + s, wy + s, t.heightAtCell(cx + step, cy + step));
        const p01 = this.project(wx, wy + s, t.heightAtCell(cx, cy + step));
        const quad = [p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y];

        // 1. The cultural wash.
        if (strength >= 0.06) {
          g.poly(quad).fill({
            color: TERRITORY_COLOURS[claim > 0 ? 0 : 1],
            alpha: Math.min(0.42, 0.06 + strength * 0.4),
          });
        }

        // 2. Ground held but not converted, hatched on a coarse lattice so it
        //    reads as occupation rather than as another wash.
        const integrated = territory.integratedAtCell(cx, cy);
        if (holder !== null && integrated !== holder) {
          g.poly(quad).fill({ color: BANNER_COLOURS[holder], alpha: 0.07 });
          if (((cx + cy) / step) % 3 === 0) {
            g.moveTo(p01.x, p01.y)
              .lineTo(p10.x, p10.y)
              .stroke({ color: BANNER_COLOURS[holder], width: 0.7, alpha: 0.4 });
          }
        }

        // 3. Where neither side can hold: soldiers are actually fighting here.
        if (contested) {
          g.poly(quad).fill({ color: CONTESTED_COLOUR, alpha: 0.3 });
        }

        // 4. The cultural frontier: pale, soft-edged, drawn as an area because
        //    culture does not have a crisp edge and should not pretend to.
        const here = territory.integratedAtCell(cx, cy);
        if (here !== null) {
          const east = territory.integratedAtCell(cx + step, cy);
          const south = territory.integratedAtCell(cx, cy + step);
          if ((east !== null && east !== here) || (south !== null && south !== here)) {
            g.poly(quad).fill({ color: FRONTIER_COLOUR, alpha: 0.5 });
          }
        }

        // 5. The military contour, stroked along the actual boundary between
        //    cells rather than filled into them.
        //
        //    Filling was the first attempt and it was wrong: an 8m cell painted
        //    solid reads as a wide ribbon laid over the landscape, close enough
        //    to a road to be confusing, and it swamped the haze it is supposed
        //    to be distinguishable from. `01` §6 asks for **a drawn line**, and
        //    the difference between a line and a band turns out to be the whole
        //    reason the two fields stay legible on top of each other.
        if (holder !== null || armed) {
          const east = military.holderAtCell(cx + step, cy);
          const south = military.holderAtCell(cx, cy + step);

          if (east !== holder) {
            g.moveTo(p10.x, p10.y).lineTo(p11.x, p11.y).stroke({
              color: edgeColour(holder, east),
              width: 1.1,
              alpha: 0.95,
            });
          }
          if (south !== holder) {
            g.moveTo(p01.x, p01.y).lineTo(p11.x, p11.y).stroke({
              color: edgeColour(holder, south),
              width: 1.1,
              alpha: 0.95,
            });
          }
        }
      }
    }
  }

  private decorContext(): DecorContext {
    return {
      project: (wx, wy, h) => this.project(wx, wy, h),
      groundAt: (wx, wy) => this.world.terrain.heightAt(wx, wy),
      isPlan: this.mode === 'plan',
      season: this.world.calendar.season,
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

    const used = new Set<number>();
    const ctx = this.decorContext();
    for (const e of entries) {
      const band = depthBand(e.depth);
      used.add(band);
      const g = this.staticBands[band];
      if (e.building) this.drawBuilding(g, e.building, 1);
      else drawDecorItem(g, ctx, e.decor!);
    }

    // An empty Graphics still goes through the renderer every frame.
    for (let i = 0; i < this.staticBands.length; i++) {
      this.staticBands[i].visible = used.has(i);
    }
  }

  /**
   * People, redrawn every frame into their depth band so a figure walking behind
   * a house is painted behind it.
   */
  private drawPeople(): void {
    // Clearing all 64 bands every frame costs a geometry rebuild per band even
    // when the band is empty. Only the ones that had somebody in them last
    // frame need touching, and in a normal town that is a handful.
    for (const b of this.dirtyPeopleBands) this.peopleBands[b].clear();
    this.dirtyPeopleBands.clear();

    const plan = this.mode === 'plan';

    // The selection marks are drawn into the ghost layer, which no other tool is
    // touching while a column is picked up, so it is ours to clear each frame.
    if (this.selectedBand !== null) this.ghost.clear();

    // Warbands ride in the people layers because they move on the same cadence
    // and have to sort against buildings the same way — a column marching behind
    // a keep must go behind it.
    for (const w of this.world.military.warbands) {
      const band = depthBand(w.pos.x + w.pos.y);
      this.dirtyPeopleBands.add(band);
      this.drawWarband(this.peopleBands[band], w, plan);
    }

    const people = this.world.crowd.people;
    if (people.length === 0) return;

    for (const person of people) {
      const band = depthBand(person.pos.x + person.pos.y);
      this.dirtyPeopleBands.add(band);
      this.drawPerson(this.peopleBands[band], person, plan);
    }
  }

  /**
   * A warband: a knot of figures under a banner (design/01 §6, "warband banners
   * and bearing").
   *
   * Everything the player needs is in the silhouette, with no numbers anywhere:
   * **how many figures** is its strength, **which way the pennant points** is
   * where it is going, and **a pennant gone grey and drooping** is a column out
   * of supply and dying — which is the moment the supply rule of `01` §3 becomes
   * something you can see rather than something you were told.
   */
  private drawWarband(g: Graphics, w: Warband, plan: boolean): void {
    const colour = BANNER_COLOURS[w.owner] ?? BANNER_COLOURS[0];
    const ground = this.world.terrain.heightAt(w.pos.x, w.pos.y);
    const base = this.project(w.pos.x, w.pos.y, ground);

    // Selected, and where it has been told to go. The line to the target is the
    // only bit of interface a column gets, and it disappears when it arrives.
    if (w.id === this.selectedBand) {
      const ring: number[] = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const p = this.project(w.pos.x + Math.cos(a) * 9, w.pos.y + Math.sin(a) * 9, ground);
        ring.push(p.x, p.y);
      }
      this.ghost.poly(ring).stroke({ color: colour, width: 0.6, alpha: 0.85 });

      if (w.target) {
        const to = this.projectOnGround(w.target);
        this.ghost
          .moveTo(base.x, base.y)
          .lineTo(to.x, to.y)
          .stroke({ color: colour, width: 0.4, alpha: 0.4 });
        this.ghost.circle(to.x, to.y, 2).stroke({ color: colour, width: 0.5, alpha: 0.7 });
      }
    }

    if (plan) {
      // A chevron pointing the way it is marching; nothing else reads on a map.
      const c = Math.cos(w.bearing);
      const s = Math.sin(w.bearing);
      const nose = this.project(w.pos.x + c * 7, w.pos.y + s * 7, ground);
      const left = this.project(w.pos.x - c * 4 - s * 4, w.pos.y - s * 4 + c * 4, ground);
      const right = this.project(w.pos.x - c * 4 + s * 4, w.pos.y - s * 4 - c * 4, ground);
      g.poly([nose.x, nose.y, left.x, left.y, right.x, right.y]).fill({
        color: colour,
        alpha: 0.35 + w.strength * 0.6,
      });
      return;
    }

    // Strength is the size of the crowd, not a bar over its head.
    const figures = 2 + Math.round(w.strength * 5);
    g.ellipse(base.x, base.y, 6, 3).fill({ color: 0x2f3a2c, alpha: 0.26 });

    for (let i = 0; i < figures; i++) {
      // A fixed lattice offset by the band's id, so a column looks like a column
      // rather than a shuffling cloud, and two columns never look identical.
      const a = (i * 2.39996 + w.id) % (Math.PI * 2);
      const r = 1.5 + (i % 3) * 1.5;
      const fx = w.pos.x + Math.cos(a) * r;
      const fy = w.pos.y + Math.sin(a) * r;
      const fg = this.world.terrain.heightAt(fx, fy);
      const foot = this.project(fx, fy, fg);
      const head = this.project(fx, fy, fg + 3.3);
      const shoulder = this.project(fx, fy, fg + 2.55);

      g.poly([
        foot.x - 0.46, foot.y,
        foot.x + 0.46, foot.y,
        shoulder.x + 0.6, shoulder.y,
        shoulder.x - 0.6, shoulder.y,
      ]).fill(SOLDIER);
      g.circle(head.x, head.y, 0.66).fill(HELMET);
    }

    // The banner, and it is deliberately out of all scale — taller than the
    // houses it passes. A column you have to hunt for is a column you will lose,
    // and `01` §6 asks for the map itself to carry this, with no icon layer over
    // the top of it. Toy cities are allowed enormous flags.
    const poleFoot = this.project(w.pos.x, w.pos.y, ground);
    const poleTop = this.project(w.pos.x, w.pos.y, ground + 14);
    g.moveTo(poleFoot.x, poleFoot.y)
      .lineTo(poleTop.x, poleTop.y)
      .stroke({ color: 0x3b2f24, width: 0.75 });

    // Out of supply, the pennant loses its colour and its lift. That single
    // change is the whole supply system's user interface.
    const fly = w.supplied ? 9 : 5;
    const droop = w.supplied ? 0 : 3;
    const tip = this.project(
      w.pos.x + Math.cos(w.bearing) * fly,
      w.pos.y + Math.sin(w.bearing) * fly,
      ground + 12.4 - droop,
    );
    const heel = this.project(w.pos.x, w.pos.y, ground + 9.8);
    g.poly([poleTop.x, poleTop.y, tip.x, tip.y, heel.x, heel.y]).fill({
      color: w.supplied ? colour : 0x8a8579,
      alpha: 0.55 + w.strength * 0.45,
    });
    // A dark edge, so a pale banner still reads against a pale field.
    g.poly([poleTop.x, poleTop.y, tip.x, tip.y, heel.x, heel.y]).stroke({
      color: 0x2a2620,
      width: 0.3,
      alpha: 0.55,
    });
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
  /**
   * A building is drawn by **deriving it into volumes** and drawing each one
   * (`massing.ts`), rather than as one box with a hat.
   *
   * Everything below is generic: it knows about a block's rectangle, its base
   * height and its roof form, and nothing at all about what kind of building it
   * belongs to. A merchant's jetty, a farm's lean-to, a church's chancel and a
   * keep's turret are all the same code path with different numbers, which is
   * what makes adding a building type cost a catalogue entry and nothing here.
   */
  private drawBuilding(g: Graphics, b: Building, alpha: number, tint?: number): void {
    const look = appearanceOf(b.typeId);
    // Weathering: no two buildings in a row are quite the same shade.
    const vw = (this.jitter(b.id, 1) - 0.5) * 0.14;
    const vr = (this.jitter(b.id, 2) - 0.5) * 0.16;
    const wall = tint ?? shade(look.wall, vw);
    const roof = tint ?? shade(look.roof, vr);
    const ground = this.world.terrain.heightAt(b.pos.x, b.pos.y);
    const blocks = massOf(b.typeId, b.id);

    if (this.mode === 'plan') {
      // In plan the massing shows as an outline rather than a rectangle, which
      // is most of what makes a plan view read as a town and not a spreadsheet.
      for (const block of blocks) {
        if (block.stack) continue;
        const pts: number[] = [];
        for (const c of this.blockCorners(b, block, block.overhang)) {
          const s = this.project(c.x, c.y, ground);
          pts.push(s.x, s.y);
        }
        g.poly(pts).fill({ color: block.form === 'flat' ? wall : roof, alpha });
      }
      return;
    }

    // Painter's order: further back first, and within the same footprint the
    // lower storey before the one jettied over it.
    interface BlockOrder { block: Block; depth: number }
    const order: BlockOrder[] = blocks.map((block) => {
      const c = this.local(b, block.u, block.v);
      return { block, depth: c.x + c.y };
    })
      .sort((p: BlockOrder, q: BlockOrder) => p.depth - q.depth || p.block.base - q.block.base);

    for (const entry of order) {
      this.drawBlock(g, b, entry.block, ground, alpha, wall, roof, tint !== undefined);
    }

    if (!tint) this.drawChimney(g, b, blocks[0], ground, roof);
  }

  /**
   * An overshot waterwheel on the gable end of a mill.
   *
   * The mill was a barn beside a stream, and no amount of massing was going to
   * fix that, because a watermill is not a *shape* — it is a shed with a wheel
   * on it. The wheel is the whole identification, so it is drawn as real
   * geometry: a rim, a hub, eight spokes and the paddles between them, standing
   * upright against the end wall.
   */
  private drawWheel(
    g: Graphics,
    b: Building,
    block: Block,
    foot: number,
    alpha: number,
  ): void {
    const along = block.ridgeAlongWidth;
    const out = (along ? block.width : block.depth) / 2 + 1.1;
    const radius = Math.min(block.height * 0.68, (along ? block.depth : block.width) * 0.46);
    const hubH = foot + radius + 0.6;

    // On whichever gable faces the camera. A wheel on the far end is a wheel
    // behind a wall, which is worth exactly nothing — and is what the first
    // version drew, because it always picked the same end regardless of which
    // way the building had been turned to face its street.
    const endA = along
      ? this.local(b, block.u - out, block.v)
      : this.local(b, block.u, block.v - out);
    const endB = along
      ? this.local(b, block.u + out, block.v)
      : this.local(b, block.u, block.v + out);
    const centre = endA.x + endA.y > endB.x + endB.y ? endA : endB;

    // The wheel's plane is vertical and runs along the building's short axis.
    const axis = along
      ? { x: -Math.sin(b.rotation), y: Math.cos(b.rotation) }
      : { x: Math.cos(b.rotation), y: Math.sin(b.rotation) };

    const at = (angle: number, r: number): Point =>
      this.project(
        centre.x + axis.x * Math.cos(angle) * r,
        centre.y + axis.y * Math.cos(angle) * r,
        hubH + Math.sin(angle) * r,
      );

    const rim: number[] = [];
    for (let i = 0; i < 24; i++) {
      const p = at((i / 24) * Math.PI * 2, radius);
      rim.push(p.x, p.y);
    }
    g.poly(rim).fill({ color: WHEEL_DARK, alpha });

    const inner: number[] = [];
    for (let i = 0; i < 24; i++) {
      const p = at((i / 24) * Math.PI * 2, radius * 0.78);
      inner.push(p.x, p.y);
    }
    g.poly(inner).fill({ color: WHEEL_TIMBER, alpha });

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hub = at(a, radius * 0.1);
      const tip = at(a, radius * 0.92);
      g.moveTo(hub.x, hub.y).lineTo(tip.x, tip.y).stroke({
        color: WHEEL_DARK,
        width: 0.24,
        alpha,
      });
    }

    const hub = at(0, 0);
    g.circle(hub.x, hub.y, radius * 0.13).fill({ color: WHEEL_DARK, alpha });
  }

  /**
   * A horizontal band across one wall, between two heights given as fractions
   * of the wall. Used for eaves and contact occlusion.
   */
  private drawWallBand(
    g: Graphics,
    base: Point[],
    top: Point[],
    i: number,
    j: number,
    v0: number,
    v1: number,
    colour: number,
    darken: number,
    alpha: number,
  ): void {
    const lerp = (a: Point, b: Point, t: number): Point => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });

    const a0 = lerp(base[i], top[i], v0);
    const b0 = lerp(base[j], top[j], v0);
    const a1 = lerp(base[i], top[i], v1);
    const b1 = lerp(base[j], top[j], v1);

    g.poly([a0.x, a0.y, b0.x, b0.y, b1.x, b1.y, a1.x, a1.y]).fill({
      color: shade(colour, -darken),
      alpha: alpha * 0.55,
    });
  }

  /** The four ground corners of a block, in world space, optionally grown. */
  private blockCorners(b: Building, block: Block, grow = 0): Vec2[] {
    const hw = block.width / 2 + grow;
    const hd = block.depth / 2 + grow;
    return [
      this.local(b, block.u - hw, block.v - hd),
      this.local(b, block.u + hw, block.v - hd),
      this.local(b, block.u + hw, block.v + hd),
      this.local(b, block.u - hw, block.v + hd),
    ];
  }

  /**
   * One volume: walls to the eaves, then whatever roof it carries.
   *
   * Faces are lit by their true normal against the one sun (`palette.ts`), so a
   * wall turned away from the light goes *blue* rather than merely dark. That
   * single change is most of the difference between this and flat shading.
   */
  private drawBlock(
    g: Graphics,
    b: Building,
    block: Block,
    ground: number,
    alpha: number,
    wall: number,
    roof: number,
    flat: boolean,
  ): void {
    const corners = this.blockCorners(b, block);
    const foot0 = ground + block.base;
    const eaves = foot0 + block.height;

    const base = corners.map((c) => this.project(c.x, c.y, foot0));
    const top = corners.map((c) => this.project(c.x, c.y, eaves));

    const walls = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return { i, j, depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2 };
      })
      .sort((a, c) => a.depth - c.depth);

    // A roof on posts. Skipping the walls is what makes a market hall read as
    // somewhere you walk *through* rather than a barn with the doors shut.
    if (block.open) {
      const postColour = flat ? wall : lit(shade(wall, -0.3), -0.2, 0.05);
      for (let c = 0; c < 4; c++) {
        const inset = 0.35;
        const cx = corners[c].x + (corners[(c + 2) % 4].x - corners[c].x) * (inset / block.width);
        const cy = corners[c].y + (corners[(c + 2) % 4].y - corners[c].y) * (inset / block.depth);
        const half = Math.max(0.22, Math.min(block.width, block.depth) * 0.045);
        const foot = this.project(cx, cy, foot0);
        const head = this.project(cx, cy, eaves);
        g.poly([
          foot.x - half, foot.y,
          foot.x + half, foot.y,
          head.x + half, head.y,
          head.x - half, head.y,
        ]).fill({ color: postColour, alpha });
      }
      this.drawBlockRoof(g, b, block, eaves, alpha, wall, roof, flat);
      return;
    }

    for (let wi = 0; wi < walls.length; wi++) {
      const w = walls[wi];
      const ax = corners[w.j].x - corners[w.i].x;
      const ay = corners[w.j].y - corners[w.i].y;
      // Outward normal of a wall whose corners run anticlockwise in local space.
      const face = flat ? wall : lit(wall, lambertOf(ay, -ax, 0), 0.06);

      g.poly([
        top[w.i].x, top[w.i].y,
        top[w.j].x, top[w.j].y,
        base[w.j].x, base[w.j].y,
        base[w.i].x, base[w.i].y,
      ])
        .fill({ color: face, alpha })
        .stroke(edge(face, alpha));

      // Two bands of occlusion, and between them they do more work than any
      // other four lines here.
      //
      // **Under the eaves**, because an overhanging roof shades the wall it
      // oversails — this is what stops a roof looking pasted on. **At the
      // ground**, because light does not reach into the angle where a wall meets
      // the earth — this is what stops a building looking like a sticker.
      // Neither is expensive and neither needs a shadow pass.
      if (!flat && block.height > 1.6) {
        this.drawWallBand(g, base, top, w.i, w.j, 0.82, 1, face, 0.3, alpha);
        this.drawWallBand(g, base, top, w.i, w.j, 0, 0.11, face, 0.34, alpha);
      }

      // Openings only on walls actually facing the camera, and a door only on
      // the nearest one — a building with four front doors looks wrong.
      const wantsFacade = block.facade && !block.stack && !flat && block.height > 2.4;
      if (wantsFacade && wi >= walls.length - 2) {
        const length = Math.hypot(ax, ay);
        this.drawFacade(
          g,
          [base[w.i], base[w.j], top[w.j], top[w.i]],
          b.typeId,
          length,
          block.height,
          face,
          (block.door ?? false) && wi === walls.length - 1,
          block.framed === true,
          b.id * 7 + wi,
        );
      }

      // Masonry courses, drawn as geometry rather than implied by a flat fill.
      //
      // Towers need these more than anything else does. A tall plain shaft has
      // no windows, no eaves and no roof pitch to give it scale, so without
      // courses it could be four metres tall or forty — which is why the first
      // watchtower read as a factory chimney.
      if (!flat && (block.stack || block.crown === 'battlement')) {
        this.drawCourses(g, [base[w.i], base[w.j], top[w.j], top[w.i]], block.height, face);
      }
    }

    if (block.feature === 'wheel' && !flat) {
      this.drawWheel(g, b, block, foot0, alpha);
    }

    if (block.form === 'flat') {
      // A flat roof is a **deck you stand on** — lead, flags, a wall-walk — and
      // it faces the sky, so it should be among the brightest surfaces in the
      // scene. Drawing it in the building's dark slate roof colour made a keep's
      // top read as a hole cut out of the tower, which is exactly what it looked
      // like. Ground cover (greens, orchards) is the one exception: that really
      // is foliage all the way up.
      const deckBase = block.height < 2 ? roof : shade(wall, -0.14);
      const deck = flat ? deckBase : lit(deckBase, FLAT_LAMBERT, 0.16);
      g.poly([
        top[0].x, top[0].y, top[1].x, top[1].y, top[2].x, top[2].y, top[3].x, top[3].y,
      ])
        .fill({ color: deck, alpha })
        .stroke(edge(deck, alpha));
      if (block.crown) this.drawCrown(g, b, block, eaves, alpha, wall);
      return;
    }

    this.drawBlockRoof(g, b, block, eaves, alpha, wall, roof, flat);
  }
  private drawFacade(
    g: Graphics,
    face: [Point, Point, Point, Point],
    typeId: string,
    worldLength: number,
    worldHeight: number,
    wallColour: number,
    withDoor: boolean,
    framed: boolean,
    seed: number,
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

    const glass = shade(wallColour, -0.54);
    const deep = shade(wallColour, -0.66);
    const timber = TIMBER_FRAME;

    for (const p of deriveFacade(typeId, worldLength, worldHeight, seed, withDoor)) {
      drawPanel(quad, p.u0, p.v0, p.u1, p.v1, p.panel, glass, deep, timber);
    }

    // Exposed frame goes on last: the beams sit over the render, which is how a
    // timber-framed wall actually goes together.
    if (framed) {
      const posts = Math.max(2, Math.min(7, Math.round(worldLength / 2.4)));
      const thickness = Math.min(0.035, 0.5 / posts);

      for (let i = 0; i <= posts; i++) {
        const u = i / posts;
        quad(Math.max(0, u - thickness), 0, Math.min(1, u + thickness), 1, timber);
      }
      quad(0, 0.94, 1, 1, timber);
      if (worldHeight > 5) quad(0, 0.45, 1, 0.51, timber);
      quad(0, 0, 1, 0.05, timber);
    }
  }

  /** A stack at the gable end. Most of what says "somebody lives here". */
  /** A stack at the gable end. Most of what says "somebody lives here". */
  private drawChimney(
    g: Graphics,
    b: Building,
    block: Block,
    ground: number,
    roof: number,
  ): void {
    const type = buildingType(b.typeId);
    const look = appearanceOf(b.typeId);
    if (look.tower || type.family === 'economic' || block.form === 'flat') return;
    if (Math.min(block.width, block.depth) < 5) return;

    const eaves = ground + block.base + block.height;
    const halfU = (block.ridgeAlongWidth ? block.width : block.depth) / 2;
    const u = halfU - 1.2;
    const p = block.ridgeAlongWidth
      ? this.local(b, block.u + u, block.v)
      : this.local(b, block.u, block.v + u);

    const w = 0.7;
    const corners = [
      { x: p.x - w, y: p.y - w },
      { x: p.x + w, y: p.y - w },
      { x: p.x + w, y: p.y + w },
      { x: p.x - w, y: p.y + w },
    ];
    const bottom = corners.map((c) => this.project(c.x, c.y, eaves));
    const cap = corners.map((c) => this.project(c.x, c.y, eaves + block.rise + 1.6));

    for (const i of [0, 1, 2, 3]) {
      const j = (i + 1) % 4;
      const ax = corners[j].x - corners[i].x;
      const ay = corners[j].y - corners[i].y;
      g.poly([
        cap[i].x, cap[i].y, cap[j].x, cap[j].y, bottom[j].x, bottom[j].y, bottom[i].x, bottom[i].y,
      ]).fill(lit(roof, lambertOf(ay, -ax, 0), -0.12));
    }
    g.poly([
      cap[0].x, cap[0].y, cap[1].x, cap[1].y, cap[2].x, cap[2].y, cap[3].x, cap[3].y,
    ]).fill(shade(roof, -0.5));
  }

  /**
   * The roof of one block. Gable, hip and lean are the same construction with
   * different insets; only the ends differ.
   *
   * Slopes are lit by their true 3D normal, so the two sides of a pitched roof
   * separate into a warm plane and a cool one instead of two arbitrary tints.
   * On a scene of a hundred roofs that is the difference between a model village
   * and a chart.
   */
  private drawBlockRoof(
    g: Graphics,
    b: Building,
    block: Block,
    eaves: number,
    alpha: number,
    wall: number,
    roof: number,
    flat: boolean,
  ): void {
    const hw = block.width / 2;
    const hd = block.depth / 2;
    const ridgeH = eaves + block.rise;

    // Along the ridge is "u"; across it is "v". Working in the block's own frame
    // keeps gable, hip and lean identical apart from the inset.
    const alongWidth = block.ridgeAlongWidth;
    // The roof oversails the walls. A flush roof reads as a box; an overhang is
    // most of what makes a building look built rather than extruded.
    const over = block.overhang;
    const halfU = (alongWidth ? hw : hd) + over;
    const halfV = (alongWidth ? hd : hw) + over;
    const inset = block.form === 'hip' ? Math.min(halfU * 0.45, halfV) : 0;

    // A lean-to's ridge sits over one edge instead of down the middle.
    const lean = block.form === 'lean';
    const leanFrom = block.leanFrom ?? -1;
    const ridgeV = lean ? halfV * leanFrom : 0;

    const at = (u: number, v: number, h: number) => {
      const p = alongWidth
        ? this.local(b, block.u + u, block.v + v)
        : this.local(b, block.u + v, block.v + u);
      return this.project(p.x, p.y, h);
    };

    // Local axes in world space, needed for the slope normals.
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);
    const vAxis = alongWidth ? { x: -sin, y: cos } : { x: cos, y: sin };

    const ridgeA = at(-halfU + inset, ridgeV, ridgeH);
    const ridgeB = at(halfU - inset, ridgeV, ridgeH);

    const eaveNegA = at(-halfU, -halfV, eaves);
    const eaveNegB = at(halfU, -halfV, eaves);
    const eavePosA = at(-halfU, halfV, eaves);
    const eavePosB = at(halfU, halfV, eaves);

    // Slope normal: horizontal component points down-slope, vertical up.
    const run = lean ? halfV * 2 : halfV;
    const pitch = Math.atan2(block.rise, Math.max(0.3, run));
    const slopeNormal = (side: 1 | -1) => {
      const s = Math.sin(pitch);
      const c = Math.cos(pitch);
      return lambertOf(vAxis.x * s * side, vAxis.y * s * side, c);
    };

    const negColour = flat ? roof : lit(roof, slopeNormal(-1), 0.04);
    const posColour = flat ? roof : lit(roof, slopeNormal(1), 0.04);

    const centreNeg = alongWidth
      ? this.local(b, block.u, block.v - halfV)
      : this.local(b, block.u - halfV, block.v);
    const centrePos = alongWidth
      ? this.local(b, block.u, block.v + halfV)
      : this.local(b, block.u + halfV, block.v);
    const negFirst = centreNeg.x + centreNeg.y < centrePos.x + centrePos.y;

    const slopeNeg = () => {
      if (lean && leanFrom === -1) return; // the high edge: no slope this side
      g.poly([
        eaveNegA.x, eaveNegA.y, eaveNegB.x, eaveNegB.y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ])
        .fill({ color: negColour, alpha })
        .stroke(edge(negColour, alpha));
      if (!flat) {
        this.drawRoofCourses(g, eaveNegA, eaveNegB, ridgeB, ridgeA, negColour, block, b.id);
      }
    };

    const slopePos = () => {
      if (lean && leanFrom === 1) return;
      g.poly([
        eavePosA.x, eavePosA.y, eavePosB.x, eavePosB.y, ridgeB.x, ridgeB.y, ridgeA.x, ridgeA.y,
      ])
        .fill({ color: posColour, alpha })
        .stroke(edge(posColour, alpha));
      if (!flat) {
        this.drawRoofCourses(g, eavePosA, eavePosB, ridgeB, ridgeA, posColour, block, b.id);
      }
    };

    // ---- Draw order --------------------------------------------------------
    //
    // A roof is a tent, and the two triangles closing its ends are **not both
    // in front of it**. The far one is behind the slopes and the near one is in
    // front of them, so painting both after the slopes puts the far gable on
    // top of the roof — which reads, unmistakably, as a roof with a side
    // missing. That is the bug this ordering exists to prevent, and it was
    // visible on every gabled building in the game.
    //
    // So: far end, then both slopes back-to-front, then near end.

    const wallU = halfU - over;
    const wallV = halfV - over;
    const endAxis = alongWidth ? { x: cos, y: sin } : { x: -sin, y: cos };
    const gableColour = (side: 1 | -1) =>
      flat ? wall : lit(wall, lambertOf(endAxis.x * side, endAxis.y * side, 0), 0.02);

    const gNegA = at(-wallU, -wallV, eaves);
    const gPosA = at(-wallU, wallV, eaves);
    const gNegB = at(wallU, -wallV, eaves);
    const gPosB = at(wallU, wallV, eaves);
    const apexV = lean ? wallV * leanFrom : 0;
    const apexA = at(-wallU, apexV, ridgeH);
    const apexB = at(wallU, apexV, ridgeH);

    const centreA = alongWidth
      ? this.local(b, block.u - wallU, block.v)
      : this.local(b, block.u, block.v - wallU);
    const centreB = alongWidth
      ? this.local(b, block.u + wallU, block.v)
      : this.local(b, block.u, block.v + wallU);
    const aNearer = centreA.x + centreA.y > centreB.x + centreB.y;

    const gable = (
      n: Point,
      p: Point,
      apex: Point,
      colour: number,
      near: boolean,
    ) => {
      g.poly([n.x, n.y, p.x, p.y, apex.x, apex.y]).fill({ color: colour, alpha });
      if (flat || block.rise < 1.4) return;

      // A big gable is the largest unbroken shape on a building, and left as one
      // flat triangle it reads as sailcloth rather than a wall — worst of all on
      // a church, where it is sixteen metres of pale limestone. Two marks fix it:
      // courses across the triangle, so it is visibly the same masonry as the
      // wall below, and a **verge** down both rakes, which is the stone edging a
      // real gable carries where it meets the roof.
      const rows = Math.max(2, Math.min(5, Math.round(block.rise / 1.6)));
      for (let i = 1; i < rows; i++) {
        const t = i / rows;
        const a = { x: n.x + (apex.x - n.x) * t, y: n.y + (apex.y - n.y) * t };
        const c = { x: p.x + (apex.x - p.x) * t, y: p.y + (apex.y - p.y) * t };
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({
          color: shade(colour, -0.13),
          width: 0.13,
          alpha: 0.6,
        });
      }

      const verge = shade(colour, near ? -0.22 : -0.3);
      g.moveTo(n.x, n.y).lineTo(apex.x, apex.y).lineTo(p.x, p.y).stroke({
        color: verge,
        width: 0.34,
        alpha: 0.85,
      });
    };

    const hipColour = flat
      ? roof
      : lit(roof, slopeNormal(1) * 0.4 + slopeNormal(-1) * 0.4, 0.04);

    /** Close one end of the roof: a hipped slope, or a gable wall. */
    const endA = () => {
      if (block.form === 'hip') {
        g.poly([
          eaveNegA.x, eaveNegA.y, eavePosA.x, eavePosA.y, ridgeA.x, ridgeA.y,
        ]).fill({ color: hipColour, alpha }).stroke(edge(hipColour, alpha));
      } else {
        gable(gNegA, gPosA, apexA, gableColour(-1), aNearer);
      }
    };

    const endB = () => {
      if (block.form === 'hip') {
        g.poly([
          eaveNegB.x, eaveNegB.y, eavePosB.x, eavePosB.y, ridgeB.x, ridgeB.y,
        ]).fill({ color: hipColour, alpha }).stroke(edge(hipColour, alpha));
      } else {
        gable(gNegB, gPosB, apexB, gableColour(1), !aNearer);
      }
    };

    if (aNearer) endB();
    else endA();

    if (negFirst) {
      slopeNeg();
      slopePos();
    } else {
      slopePos();
      slopeNeg();
    }

    // A ridge cap, so the two slopes meet in a line rather than a seam.
    if (!lean) {
      g.poly([
        ridgeA.x, ridgeA.y - 0.6, ridgeB.x, ridgeB.y - 0.6,
        ridgeB.x, ridgeB.y + 0.5, ridgeA.x, ridgeA.y + 0.5,
      ]).fill({ color: shade(roof, -0.28), alpha });
    }

    if (block.dormers) {
      this.drawDormers(g, block, at, halfU, halfV, eaves, ridgeH, alpha, wall, roof, flat);
    }

    if (aNearer) endA();
    else endB();
  }

  /**
   * Courses across a roof slope: slate bands, tile rows, thatch combing.
   *
   * A roof is the largest single surface in the scene and a flat fill on it is
   * the loudest thing saying "polygon". These are drawn in the slope's own
   * parametric space, so they follow the pitch and the projection for free.
   */
  private drawRoofCourses(
    g: Graphics,
    eaveA: Point,
    eaveB: Point,
    ridgeB: Point,
    ridgeA: Point,
    colour: number,
    block: Block,
    seed: number,
  ): void {
    const rise = block.rise;
    if (rise < 0.5) return;

    // Along the eaves is u; up the slope is v.
    const at = (u: number, v: number): Point => ({
      x: eaveA.x + (eaveB.x - eaveA.x) * u
        + ((ridgeA.x - eaveA.x) + ((ridgeB.x - eaveB.x) - (ridgeA.x - eaveA.x)) * u) * v,
      y: eaveA.y + (eaveB.y - eaveA.y) * u
        + ((ridgeA.y - eaveA.y) + ((ridgeB.y - eaveB.y) - (ridgeA.y - eaveA.y)) * u) * v,
    });

    const rows = Math.max(2, Math.min(7, Math.round(rise * 1.5)));
    const line = shade(colour, -0.13);

    for (let i = 1; i < rows; i++) {
      const v = i / rows;
      const a = at(0, v);
      const c = at(1, v);
      g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: line, width: 0.16, alpha: 0.75 });
    }

    // A slightly deeper eaves course, which is what reads as a roof edge.
    const e0 = at(0, 0.06);
    const e1 = at(1, 0.06);
    g.moveTo(e0.x, e0.y).lineTo(e1.x, e1.y).stroke({
      color: shade(colour, -0.24),
      width: 0.24,
      alpha: 0.8,
    });
    void seed;
  }

  /** Masonry courses up a stack or a tower, for the same reason as the roof. */
  private drawCourses(
    g: Graphics,
    face: [Point, Point, Point, Point],
    height: number,
    colour: number,
  ): void {
    const [b0, b1, t1, t0] = face;
    const rows = Math.max(2, Math.min(9, Math.round(height / 2.2)));
    const line = shade(colour, -0.14);

    for (let i = 1; i < rows; i++) {
      const v = i / rows;
      const a = { x: b0.x + (t0.x - b0.x) * v, y: b0.y + (t0.y - b0.y) * v };
      const c = { x: b1.x + (t1.x - b1.x) * v, y: b1.y + (t1.y - b1.y) * v };
      g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: line, width: 0.14, alpha: 0.55 });
    }
  }

  /**
   * Dormers: little gabled windows pushed through the roof slope. Cheap, and
   * they do more for the character of a row of housing than anything else here.
   */
  private drawDormers(
    g: Graphics,
    block: Block,
    at: (u: number, v: number, h: number) => Point,
    halfU: number,
    halfV: number,
    eaves: number,
    ridgeH: number,
    alpha: number,
    wall: number,
    roof: number,
    flat: boolean,
  ): void {
    const n = block.dormers ?? 0;
    if (n < 1) return;

    // Two thirds of the way up the slope, facing the near side.
    const t = 0.52;
    const v = halfV * (1 - t);
    const h = eaves + (ridgeH - eaves) * t;
    const halfSpan = halfU * 0.72;
    const width = Math.min(1.5, (halfSpan * 1.6) / (n * 2.2));

    const cheek = flat ? roof : shade(roof, -0.24);
    const front = flat ? wall : shade(wall, -0.02);
    const gable = flat ? wall : shade(wall, -0.16);
    const cap = flat ? roof : shade(roof, 0.14);

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
      g.poly([faceL.x, faceL.y, topL.x, topL.y, backL.x, backL.y]).fill({ color: cheek, alpha });
      g.poly([
        faceL.x, faceL.y, faceR.x, faceR.y, topR.x, topR.y, topL.x, topL.y,
      ]).fill({ color: front, alpha });
      g.poly([topL.x, topL.y, topR.x, topR.y, apex.x, apex.y]).fill({ color: gable, alpha });
      g.poly([
        topL.x, topL.y, topR.x, topR.y, backR.x, backR.y, backL.x, backL.y,
      ]).fill({ color: cap, alpha });

      // The window itself.
      const wl = at(u - width * 0.55, v, h + 0.35);
      const wr = at(u + width * 0.55, v, h + 0.35);
      const wtl = at(u - width * 0.55, v, h + 1.2);
      const wtr = at(u + width * 0.55, v, h + 1.2);
      g.poly([wl.x, wl.y, wr.x, wr.y, wtr.x, wtr.y, wtl.x, wtl.y]).fill({
        color: shade(wall, -0.55),
        alpha,
      });
    }
  }

  /**
   * How a tower finishes: a spire, a flat cap, or battlements.
   *
   * The crown is the whole silhouette argument in miniature. A church and a keep
   * are the same box from fifty metres away; what tells them apart at a glance is
   * that one comes to a point and the other is notched. Nothing else in the game
   * has a notched top, so a fortification is legible from right across the map.
   */
  private drawCrown(
    g: Graphics,
    b: Building,
    block: Block,
    topH: number,
    alpha: number,
    wall: number,
  ): void {
    const corners = this.blockCorners(b, block);
    const cap = corners.map((c) => this.project(c.x, c.y, topH));

    const faces = [0, 1, 2, 3]
      .map((i) => {
        const j = (i + 1) % 4;
        return { i, j, depth: (corners[i].x + corners[i].y + corners[j].x + corners[j].y) / 2 };
      })
      .sort((a, c) => a.depth - c.depth);

    if (block.crown === 'battlement') {
      // **A merlon is chest-high on a person, whatever it is standing on.**
      // Scaling it with the tower's width gave a twenty-metre keep merlons four
      // metres tall and four metres wide — a crown of standing stones rather
      // than a parapet. Both the height and the *spacing* have to be absolute,
      // so a big keep gets many small merlons and a slim turret gets a few.
      const merlonH = Math.min(1.7, Math.max(1.05, block.width * 0.16));
      const pitch = 2.4;
      // Odd, so the run starts and finishes on a merlon rather than a gap.
      const segments = Math.max(3, Math.min(15, Math.round(block.width / pitch) * 2 + 1));

      // A corbel table: the parapet oversails the wall on brackets, so there is
      // a shadowed lip right round the tower just under the battlements. It is
      // one band of geometry and it is most of what separates "castle" from
      // "grey box with notches on top".
      const out = Math.max(0.28, block.width * 0.055);
      const corbel = this.blockCorners(b, block, out).map((c) =>
        this.project(c.x, c.y, topH),
      );
      const corbelFoot = this.blockCorners(b, block, 0).map((c) =>
        this.project(c.x, c.y, topH - Math.max(0.7, block.width * 0.11)),
      );

      for (const f of faces) {
        const a = corners[f.i];
        const c = corners[f.j];
        const ax = c.x - a.x;
        const ay = c.y - a.y;
        g.poly([
          corbel[f.i].x, corbel[f.i].y,
          corbel[f.j].x, corbel[f.j].y,
          corbelFoot[f.j].x, corbelFoot[f.j].y,
          corbelFoot[f.i].x, corbelFoot[f.i].y,
        ]).fill({ color: lit(shade(wall, -0.12), lambertOf(ay, -ax, 0), 0.02), alpha });
      }

      for (const f of faces) {
        const a = corners[f.i];
        const c = corners[f.j];
        const ax = c.x - a.x;
        const ay = c.y - a.y;
        const colour = lit(wall, lambertOf(ay, -ax, 0), 0.06);

        const wide = this.blockCorners(b, block, out);
        const wa = wide[f.i];
        const wc = wide[f.j];
        const wax = wc.x - wa.x;
        const way = wc.y - wa.y;

        for (let s = 0; s < segments; s += 2) {
          const t0 = s / segments;
          const t1 = (s + 1) / segments;
          const q0 = { x: wa.x + wax * t0, y: wa.y + way * t0 };
          const q1 = { x: wa.x + wax * t1, y: wa.y + way * t1 };
          const b0 = this.project(q0.x, q0.y, topH);
          const b1 = this.project(q1.x, q1.y, topH);
          const u0 = this.project(q0.x, q0.y, topH + merlonH);
          const u1 = this.project(q1.x, q1.y, topH + merlonH);
          g.poly([u0.x, u0.y, u1.x, u1.y, b1.x, b1.y, b0.x, b0.y])
            .fill({ color: colour, alpha })
            .stroke(edge(colour, alpha));
        }
      }
      return;
    }

    if (block.crown === 'spire') {
      const centre = this.local(b, block.u, block.v);
      const apex = this.project(centre.x, centre.y, topH + block.width * 1.8);
      const roofColour = appearanceOf(b.typeId).roof;
      for (const f of faces) {
        const ax = corners[f.j].x - corners[f.i].x;
        const ay = corners[f.j].y - corners[f.i].y;
        // A spire's faces are steep, so they are lit close to a vertical wall.
        g.poly([
          cap[f.i].x, cap[f.i].y, cap[f.j].x, cap[f.j].y, apex.x, apex.y,
        ]).fill({ color: lit(roofColour, lambertOf(ay * 0.9, -ax * 0.9, 0.42), 0.02), alpha });
      }
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
      { id: -1, typeId, owner: 0, pos, rotation, age: 0 },
      0.55,
      valid ? 0x9ad6a0 : 0xd68a8a,
    );
  }
}

/** How each terminal of the grammar is actually drawn. */
function drawPanel(
  quad: (u0: number, v0: number, u1: number, v1: number, colour: number) => void,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  panel: Panel,
  glass: number,
  deep: number,
  timber: number,
): void {
  const w = u1 - u0;
  const h = v1 - v0;

  switch (panel) {
    case 'window':
      quad(u0, v0, u1, v1, glass);
      // A single glazing bar is enough to read as a window rather than a hole.
      quad(u0 + w * 0.46, v0, u0 + w * 0.54, v1, timber);
      return;

    case 'tallWindow':
      quad(u0 + w * 0.18, v0, u1 - w * 0.18, v1, glass);
      quad(u0 + w * 0.46, v0, u0 + w * 0.54, v1, timber);
      return;

    case 'mullioned': {
      // Leaded lights: a grid of small panes, which is what says "old money".
      const cols = 3;
      const rows = 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          quad(
            u0 + (w * (c + 0.12)) / cols,
            v0 + (h * (r + 0.12)) / rows,
            u0 + (w * (c + 0.88)) / cols,
            v0 + (h * (r + 0.88)) / rows,
            glass,
          );
        }
      }
      return;
    }

    case 'arched':
      // Stepped head, standing in for an arch at this scale.
      quad(u0 + w * 0.2, v0, u1 - w * 0.2, v1 - h * 0.22, glass);
      quad(u0 + w * 0.3, v1 - h * 0.24, u1 - w * 0.3, v1 - h * 0.08, glass);
      return;

    case 'shopfront':
      quad(u0, v0, u1, v1, glass);
      quad(u0, v0, u1, v0 + h * 0.12, timber);
      quad(u0, v1 - h * 0.14, u1, v1, timber);
      return;

    case 'door':
      quad(u0 + w * 0.2, v0, u1 - w * 0.2, v1, deep);
      return;

    case 'vent':
      for (let i = 0; i < 3; i++) {
        quad(u0, v0 + h * (0.18 + i * 0.28), u1, v0 + h * (0.3 + i * 0.28), deep);
      }
      return;

    case 'loft':
      quad(u0 + w * 0.28, v0 + h * 0.2, u1 - w * 0.28, v1 - h * 0.1, deep);
      return;

    case 'blank':
      return;
  }
}

/** Andrew's monotone chain. Eight points at most here, so simplicity wins. */
function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;

  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (source: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...build(pts), ...build([...pts].reverse())];
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
/**
 * The edge of a face, drawn as a darker line of the face's own colour.
 *
 * Not a cartoon outline: a black keyline round every polygon flattens a scene
 * and fights the lighting. Stroking each face with a darkened version of
 * *itself* separates the planes without introducing a colour that is not already
 * in the picture, so a wall reads as meeting a roof rather than as overlapping
 * it. This is the cheapest thing in the whole renderer and close to the most
 * valuable — it is what makes the geometry look intentional rather than
 * approximate.
 */
function edge(colour: number, alpha: number): { color: number; width: number; alpha: number } {
  return { color: shade(colour, -0.22), width: 0.11, alpha: alpha * 0.75 };
}

/**
 * The colour of a military boundary between two cells. Two sides pressing
 * against each other is not a border at all — it is a battle line, and it gets
 * the alarm colour rather than either banner.
 */
function edgeColour(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return CONTESTED_COLOUR;
  return BANNER_COLOURS[(a ?? b) as number];
}

const CLOTHING = [0x6b4a3a, 0x4a5568, 0x7a6a52, 0x8a4a42, 0x55613f, 0x6a5a6a];
const SKIN = 0xc9a887;
/** Wet oak and iron banding, for a mill wheel. */
const WHEEL_TIMBER = 0x6b5741;
const WHEEL_DARK = 0x3e3327;

/** Soldiers are drab and identical; the banner is what carries the colour. */
const SOLDIER = 0x4c4a44;
const HELMET = 0x9aa0a6;

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
