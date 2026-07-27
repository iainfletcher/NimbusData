import { Container, Graphics } from 'pixi.js';
import {
  CELL_SIZE,
  COHERENCE_THRESHOLD,
  CHARACTER_COUNT,
  buildingType,
  type Building,
  type World,
} from '../sim';
import { Camera } from './camera';
import { CHARACTER_COLOURS, shade, terrainColour } from './palette';
import { projectionFor, type Point, type Projection, type ViewMode } from './projection';

/** Terrain is drawn every Nth cell — 4m cells are finer than the eye needs here. */
const TERRAIN_STEP = 2;
const OVERLAY_STEP = 2;

const NEUTRAL_BUILDING = 0x9c8f7d;
const MUDDLE = 0x6a6a6a;

export class WorldView {
  readonly root = new Container();

  private terrain = new Graphics();
  private overlay = new Graphics();
  private buildings = new Graphics();
  private ghost = new Graphics();

  private projection: Projection;
  private terrainCacheMode: ViewMode | null = null;

  private buildingsDirty = true;
  private overlayDirty = true;

  showOverlay = false;

  constructor(
    private world: World,
    private camera: Camera,
    private mode: ViewMode = 'iso',
  ) {
    this.projection = projectionFor(mode);
    this.root.addChild(this.terrain, this.overlay, this.buildings, this.ghost);
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

  render(): void {
    if (this.terrainCacheMode !== this.mode) {
      this.drawTerrain();
      this.terrainCacheMode = this.mode;
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
        const clarity = Math.max(
          0,
          (reading.coherence - evenShare) / (1 - evenShare),
        );
        const colour = mixColour(MUDDLE, CHARACTER_COLOURS[reading.dominant], clarity);
        const alpha = Math.min(0.72, 0.16 + reading.intensity * 0.42);

        const h0 = t.heightAt(wx, wy);
        const h1 = t.heightAt(wx + s, wy);
        const h2 = t.heightAt(wx + s, wy + s);
        const h3 = t.heightAt(wx, wy + s);

        const p00 = this.project(wx, wy, h0);
        const p10 = this.project(wx + s, wy, h1);
        const p11 = this.project(wx + s, wy + s, h2);
        const p01 = this.project(wx, wy + s, h3);

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

  private drawBuilding(g: Graphics, b: Building, alpha: number, tint?: number): void {
    const type = buildingType(b.typeId);
    const colour = tint ?? buildingColour(b.typeId);
    const h = this.world.terrain.heightAt(b.pos.x, b.pos.y);

    const hw = type.width / 2;
    const hd = type.depth / 2;
    const x0 = b.pos.x - hw;
    const x1 = b.pos.x + hw;
    const y0 = b.pos.y - hd;
    const y1 = b.pos.y + hd;

    if (this.mode === 'plan') {
      const a = this.project(x0, y0, h);
      const c = this.project(x1, y1, h);
      g.rect(a.x, a.y, c.x - a.x, c.y - a.y).fill({ color: colour, alpha });
      return;
    }

    // Isometric: a simple extruded box. Height stands in for storeys.
    const storeys = type.family === 'civic' ? 9 : type.isEvolved ? 8 : 6;
    const top = h + storeys;

    const t00 = this.project(x0, y0, top);
    const t10 = this.project(x1, y0, top);
    const t11 = this.project(x1, y1, top);
    const t01 = this.project(x0, y1, top);

    const b10 = this.project(x1, y0, h);
    const b11 = this.project(x1, y1, h);
    const b01 = this.project(x0, y1, h);

    // Right face (towards +x), then front face (towards +y), then the roof.
    g.poly([t10.x, t10.y, t11.x, t11.y, b11.x, b11.y, b10.x, b10.y]).fill({
      color: shade(colour, -0.28),
      alpha,
    });
    g.poly([t01.x, t01.y, t11.x, t11.y, b11.x, b11.y, b01.x, b01.y]).fill({
      color: shade(colour, -0.14),
      alpha,
    });
    g.poly([t00.x, t00.y, t10.x, t10.y, t11.x, t11.y, t01.x, t01.y]).fill({
      color: shade(colour, 0.12),
      alpha,
    });
  }

  /** Placement preview. Pass null to clear. */
  setGhost(typeId: string | null, pos: Point | null, valid: boolean): void {
    const g = this.ghost;
    g.clear();
    if (!typeId || !pos) return;

    this.drawBuilding(
      g,
      { id: -1, typeId, pos, rotation: 0, age: 0 },
      0.55,
      valid ? 0x9ad6a0 : 0xd68a8a,
    );
  }
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
