/**
 * World → view space. View space is still in world-ish units; the camera applies
 * pan and zoom on top (see camera.ts). Adding a perspective means adding a
 * projection, not touching anything else.
 */

export type ViewMode = 'iso' | 'plan';

export interface Point {
  x: number;
  y: number;
}

/** Vertical exaggeration for terrain height in isometric view. */
const HEIGHT_SCALE = 1.4;

export interface Projection {
  readonly mode: ViewMode;
  /**
   * Roughly how many view-space units one world metre spans. Used to keep the
   * apparent scale constant when switching projections — without this, moving
   * between iso and plan silently doubles or halves how big everything looks.
   */
  readonly unitScale: number;
  /** @param h terrain height in metres */
  project(wx: number, wy: number, h: number): Point;
  /** Inverse at ground level. Height is ignored, which is correct for picking. */
  unproject(vx: number, vy: number): Point;
}

export const isoProjection: Projection = {
  mode: 'iso',
  unitScale: 0.5,
  project(wx, wy, h) {
    return {
      x: (wx - wy) * 0.5,
      y: (wx + wy) * 0.25 - h * HEIGHT_SCALE,
    };
  },
  unproject(vx, vy) {
    // Solve the ground-level (h = 0) system.
    const a = vx / 0.5; // wx - wy
    const b = vy / 0.25; // wx + wy
    return { x: (a + b) / 2, y: (b - a) / 2 };
  },
};

export const planProjection: Projection = {
  mode: 'plan',
  unitScale: 1,
  project(wx, wy) {
    return { x: wx, y: wy };
  },
  unproject(vx, vy) {
    return { x: vx, y: vy };
  },
};

export function projectionFor(mode: ViewMode): Projection {
  return mode === 'iso' ? isoProjection : planProjection;
}
