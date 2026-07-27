import type { Vec2 } from './types';

/**
 * Bridson's Poisson-disk sampling (2007).
 *
 * A jittered grid — which is what the woodland used — leaves faint rows visible
 * at distance, because every point is still tied to a lattice cell. Poisson-disk
 * gives blue noise: points as evenly spaced as randomness allows, with no
 * structure at any scale, in O(n).
 *
 * The algorithm: keep an active list of accepted points. Take one, throw `tries`
 * candidates into the annulus between r and 2r around it, and accept the first
 * that is at least r from every existing point. If none stick, retire the point.
 * A background grid of cell size r/√2 makes the neighbour test constant time,
 * since at most one sample can occupy a cell.
 */
export function poissonDisk(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  rng: () => number,
  tries = 24,
): Vec2[] {
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return [];

  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: Vec2[] = [];
  const active: number[] = [];

  const gridIndex = (p: Vec2) => {
    const gx = Math.min(cols - 1, Math.max(0, Math.floor((p.x - x0) / cell)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor((p.y - y0) / cell)));
    return gy * cols + gx;
  };

  const farEnough = (p: Vec2): boolean => {
    const gx = Math.floor((p.x - x0) / cell);
    const gy = Math.floor((p.y - y0) / cell);

    for (let dy = -2; dy <= 2; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= rows) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        if (nx < 0 || nx >= cols) continue;
        const other = grid[ny * cols + nx];
        if (other < 0) continue;
        const q = points[other];
        if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < radius * radius) return false;
      }
    }
    return true;
  };

  const accept = (p: Vec2) => {
    grid[gridIndex(p)] = points.length;
    active.push(points.length);
    points.push(p);
  };

  accept({ x: x0 + rng() * width, y: y0 + rng() * height });

  while (active.length > 0) {
    const pick = Math.floor(rng() * active.length);
    const from = points[active[pick]];
    let placed = false;

    for (let t = 0; t < tries; t++) {
      const angle = rng() * Math.PI * 2;
      // Uniform over the annulus, not over the radius — otherwise candidates
      // bunch toward the inner edge.
      const d = Math.sqrt(rng() * 3 + 1) * radius;
      const p = { x: from.x + Math.cos(angle) * d, y: from.y + Math.sin(angle) * d };

      if (p.x < x0 || p.y < y0 || p.x >= x1 || p.y >= y1) continue;
      if (!farEnough(p)) continue;

      accept(p);
      placed = true;
      break;
    }

    if (!placed) {
      active[pick] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}
