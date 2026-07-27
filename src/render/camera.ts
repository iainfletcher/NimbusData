import type { Point, Projection } from './projection';

/**
 * Pan and zoom over view space. The camera knows nothing about the simulation and
 * nothing about what is being drawn.
 */
export class Camera {
  /** Centre of the view, in view-space units. */
  x = 0;
  y = 0;
  zoom = 1;

  minZoom = 0.25;
  maxZoom = 6;

  constructor(
    public viewportWidth: number,
    public viewportHeight: number,
  ) {}

  resize(w: number, h: number): void {
    this.viewportWidth = w;
    this.viewportHeight = h;
  }

  viewToScreen(vx: number, vy: number): Point {
    return {
      x: (vx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (vy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  screenToView(sx: number, sy: number): Point {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  }

  /** Screen pixel → world ground position, via the supplied projection. */
  screenToWorld(sx: number, sy: number, projection: Projection): Point {
    const v = this.screenToView(sx, sy);
    return projection.unproject(v.x, v.y);
  }

  panByScreen(dxPixels: number, dyPixels: number): void {
    this.x -= dxPixels / this.zoom;
    this.y -= dyPixels / this.zoom;
  }

  /** Zoom about a screen point so the world under the cursor stays put. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToView(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToView(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Re-centre on a world position under a given projection. */
  centreOnWorld(wx: number, wy: number, h: number, projection: Projection): void {
    const v = projection.project(wx, wy, h);
    this.x = v.x;
    this.y = v.y;
  }
}
