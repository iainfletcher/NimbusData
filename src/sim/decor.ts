import { buildingType } from './buildings';
import { nearestRoad, type Road } from './roads';
import { makeRng, fbm } from './rng';
import { Terrain } from './terrain';
import type { Fabric } from './fabric';
import { WORLD_SIZE, type Building, type Vec2 } from './types';

/**
 * Everything below the player's brush (design/03 §1).
 *
 * Trees, hedges, walls, garden rows, woodpiles, gravestones — none of it is
 * placed by the player and none of it is a decision. It is generated, because
 * "parks and lakes yes, individual trees no" means trees are *not your job*, not
 * that there aren't any. This is where the charm has to come from: the player
 * supplies structure, the world supplies detail.
 *
 * All of it is deterministic from the world seed.
 */

export type DecorKind =
  | 'tree'
  | 'conifer'
  | 'bush'
  | 'hedge'
  | 'wall'
  | 'gardenRow'
  | 'woodpile'
  | 'barrel'
  | 'stone'
  | 'cart';

export interface DecorItem {
  kind: DecorKind;
  pos: Vec2;
  /** Radius for round things, half-length for linear ones. */
  size: number;
  /** Radians, for hedges, walls and rows. */
  angle: number;
  /** 0..1, for colour and shape variation. */
  variant: number;
  /** Height in metres, where it matters. */
  height: number;
}

export interface Decor {
  items: DecorItem[];
}

export function emptyDecor(): Decor {
  return { items: [] };
}

/**
 * Woodland thins out near the town — people cut it back for fuel, grazing and
 * fields. Without a generous clearing the wood swallows the town, which looks
 * charming for about ten seconds and then hides the entire game.
 */
const CLEARING_RADIUS = 95;
/** Trees return gradually over this distance beyond the clearing, not all at once. */
const CLEARING_FADE = 85;
const TREE_SPACING = 11;

export function generateDecor(
  terrain: Terrain,
  buildings: readonly Building[],
  roads: readonly Road[],
  fabric: Fabric,
  seed: number,
): Decor {
  const rng = makeRng(seed ^ 0xdec0);
  const items: DecorItem[] = [];

  const bounds = interestingBounds(buildings);

  scatterWoodland(items, terrain, buildings, roads, bounds, seed, rng);
  for (const b of buildings) plotFor(items, terrain, b, buildings, roads, fabric, rng);
  verges(items, terrain, fabric, buildings, rng);

  return { items };
}

/** Only decorate near the town; the rest of the map is empty country for now. */
function interestingBounds(buildings: readonly Building[]) {
  if (buildings.length === 0) {
    return { x0: 0, y0: 0, x1: WORLD_SIZE, y1: WORLD_SIZE };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of buildings) {
    x0 = Math.min(x0, b.pos.x);
    y0 = Math.min(y0, b.pos.y);
    x1 = Math.max(x1, b.pos.x);
    y1 = Math.max(y1, b.pos.y);
  }
  const pad = 260;
  return {
    x0: Math.max(0, x0 - pad),
    y0: Math.max(0, y0 - pad),
    x1: Math.min(WORLD_SIZE, x1 + pad),
    y1: Math.min(WORLD_SIZE, y1 + pad),
  };
}

function distanceToNearestBuilding(buildings: readonly Building[], p: Vec2): number {
  let best = Infinity;
  for (const b of buildings) {
    const d = Math.hypot(b.pos.x - p.x, b.pos.y - p.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Woodland follows a noise field, so it forms copses and shelter belts rather
 * than an even sprinkle — and stops where the town begins.
 */
function scatterWoodland(
  items: DecorItem[],
  terrain: Terrain,
  buildings: readonly Building[],
  roads: readonly Road[],
  bounds: { x0: number; y0: number; x1: number; y1: number },
  seed: number,
  rng: () => number,
): void {
  for (let y = bounds.y0; y < bounds.y1; y += TREE_SPACING) {
    for (let x = bounds.x0; x < bounds.x1; x += TREE_SPACING) {
      const jx = x + (rng() - 0.5) * TREE_SPACING * 0.9;
      const jy = y + (rng() - 0.5) * TREE_SPACING * 0.9;
      const p = { x: jx, y: jy };

      if (terrain.isWater(jx, jy)) continue;

      const density = fbm(jx / 190, jy / 190, seed ^ 0x77ee, 3);
      if (density < 0.58) continue;

      // Cleared ground around the town, and nothing growing in the road.
      const toTown = distanceToNearestBuilding(buildings, p);
      if (toTown < CLEARING_RADIUS) continue;
      if (nearestRoad(roads, p, 10)) continue;

      // Woodland returns gradually beyond the clearing rather than at a line.
      const returning = Math.min(1, (toTown - CLEARING_RADIUS) / CLEARING_FADE);

      // Thin the edge of a wood so it doesn't end in a straight line either.
      const edge = (density - 0.58) / 0.18;
      if (rng() > Math.min(1, 0.2 + edge) * returning) continue;

      const conifer = fbm(jx / 320, jy / 320, seed ^ 0x31, 2) > 0.56;
      items.push({
        kind: conifer ? 'conifer' : 'tree',
        pos: p,
        size: 2.4 + rng() * 2.2,
        angle: 0,
        variant: rng(),
        height: conifer ? 9 + rng() * 6 : 7 + rng() * 5,
      });
    }
  }
}

/**
 * Every building gets a plot behind it — the bit of ground it actually occupies.
 * What fills the plot is the strongest single signal of what kind of place this
 * is: vegetable rows behind a cottage, a woodpile and barrels behind a workshop,
 * gravestones round a church.
 */
function plotFor(
  items: DecorItem[],
  terrain: Terrain,
  b: Building,
  buildings: readonly Building[],
  roads: readonly Road[],
  fabric: Fabric,
  rng: () => number,
): void {
  const type = buildingType(b.typeId);
  if (type.id === 'green' || type.id === 'orchard') {
    plantOrchard(items, terrain, b, rng);
    return;
  }

  // The plot lies away from whatever the building faces.
  const back = backDirection(b, roads, fabric);
  const side = { x: -back.y, y: back.x };

  const halfWidth = type.width / 2;
  const depth = Math.min(24, 9 + type.depth * 0.8);
  const start = type.depth / 2 + 1.5;

  const cornerAt = (u: number, v: number): Vec2 => ({
    x: b.pos.x + side.x * u + back.x * v,
    y: b.pos.y + side.y * u + back.y * v,
  });

  // A boundary: hedge for homes and greenery, wall for industry and the church.
  const walled = type.family === 'economic' || type.id === 'church';
  const boundary: DecorKind = walled ? 'wall' : 'hedge';
  const boundaryHeight = walled ? 1.5 : 1.2;

  const far = start + depth;
  const runs: [Vec2, Vec2][] = [
    [cornerAt(-halfWidth, far), cornerAt(halfWidth, far)],
    [cornerAt(-halfWidth, start), cornerAt(-halfWidth, far)],
    [cornerAt(halfWidth, start), cornerAt(halfWidth, far)],
  ];

  for (const [from, to] of runs) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const sections = Math.max(1, Math.round(length / 3));
    for (let i = 0; i < sections; i++) {
      const t = (i + 0.5) / sections;
      const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (terrain.isWater(p.x, p.y)) continue;
      items.push({
        kind: boundary,
        pos: p,
        size: length / sections / 2,
        angle,
        variant: rng(),
        height: boundaryHeight * (0.85 + rng() * 0.3),
      });
    }
  }

  fillPlot(items, terrain, b, cornerAt, halfWidth, start, far, rng);

  // A tree or two in the garden, for anyone who has a garden.
  if (!walled && rng() < 0.55) {
    const p = cornerAt((rng() - 0.5) * halfWidth * 1.5, start + rng() * depth);
    if (!terrain.isWater(p.x, p.y) && distanceToNearestBuilding(buildings, p) > 5) {
      items.push({
        kind: 'tree',
        pos: p,
        size: 2 + rng() * 1.4,
        angle: 0,
        variant: rng(),
        height: 6 + rng() * 3,
      });
    }
  }
}

function fillPlot(
  items: DecorItem[],
  terrain: Terrain,
  b: Building,
  cornerAt: (u: number, v: number) => Vec2,
  halfWidth: number,
  start: number,
  far: number,
  rng: () => number,
): void {
  const type = buildingType(b.typeId);
  const push = (kind: DecorKind, p: Vec2, size: number, height: number, angle = 0) => {
    if (terrain.isWater(p.x, p.y)) return;
    items.push({ kind, pos: p, size, angle, variant: rng(), height });
  };

  const backAngle = Math.atan2(
    cornerAt(0, far).y - cornerAt(0, start).y,
    cornerAt(0, far).x - cornerAt(0, start).x,
  );

  if (type.family === 'residential' || type.id === 'farm') {
    // Vegetable rows, running across the plot.
    const rows = Math.max(2, Math.floor((far - start) / 3.2));
    for (let r = 0; r < rows; r++) {
      const v = start + 1.8 + ((far - start - 2.5) * r) / rows;
      push('gardenRow', cornerAt(0, v), halfWidth * 0.82, 0.5, backAngle + Math.PI / 2);
    }
    if (rng() < 0.4) push('woodpile', cornerAt(halfWidth * 0.6, start + 1.6), 1.5, 1.3);
    return;
  }

  if (type.family === 'economic') {
    // Working yards: stacked timber, barrels, the odd cart.
    const n = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const p = cornerAt((rng() - 0.5) * halfWidth * 1.7, start + rng() * (far - start));
      const roll = rng();
      if (roll < 0.42) push('woodpile', p, 1.4 + rng(), 1.4, rng() * Math.PI);
      else if (roll < 0.8) push('barrel', p, 0.55 + rng() * 0.25, 1.1);
      else push('cart', p, 1.9, 1.2, rng() * Math.PI);
    }
    return;
  }

  if (type.id === 'church' || type.id === 'chapel') {
    // A churchyard.
    const n = 8 + Math.floor(rng() * 10);
    for (let i = 0; i < n; i++) {
      const p = cornerAt((rng() - 0.5) * halfWidth * 1.8, start + rng() * (far - start));
      push('stone', p, 0.4 + rng() * 0.25, 0.9 + rng() * 0.5, backAngle);
    }
    return;
  }

  // Civic odds and ends.
  if (rng() < 0.5) {
    push('bush', cornerAt((rng() - 0.5) * halfWidth, start + rng() * (far - start)), 1.4, 1.6);
  }
}

/** Greens and orchards are planted rather than built. */
function plantOrchard(
  items: DecorItem[],
  terrain: Terrain,
  b: Building,
  rng: () => number,
): void {
  const type = buildingType(b.typeId);
  const isOrchard = type.id === 'orchard';
  const hw = type.width / 2;
  const hd = type.depth / 2;
  const cos = Math.cos(b.rotation);
  const sin = Math.sin(b.rotation);

  const at = (dx: number, dy: number): Vec2 => ({
    x: b.pos.x + dx * cos - dy * sin,
    y: b.pos.y + dx * sin + dy * cos,
  });

  if (isOrchard) {
    // Planted in rows, as an orchard is.
    const spacing = 6.5;
    for (let dy = -hd + 3; dy < hd - 2; dy += spacing) {
      for (let dx = -hw + 3; dx < hw - 2; dx += spacing) {
        const p = at(dx + (rng() - 0.5), dy + (rng() - 0.5));
        if (terrain.isWater(p.x, p.y)) continue;
        items.push({
          kind: 'tree',
          pos: p,
          size: 2 + rng() * 0.7,
          angle: 0,
          variant: 0.2 + rng() * 0.3,
          height: 5.5 + rng() * 1.5,
        });
      }
    }
    return;
  }

  // A green: open in the middle, trees round the edge, maybe a pond-side bush.
  const n = 7 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const edge = rng() < 0.5 ? -1 : 1;
    const alongEdge = rng() < 0.5;
    const p = alongEdge
      ? at((rng() - 0.5) * hw * 1.9, edge * hd * (0.82 + rng() * 0.14))
      : at(edge * hw * (0.82 + rng() * 0.14), (rng() - 0.5) * hd * 1.9);
    if (terrain.isWater(p.x, p.y)) continue;
    items.push({
      kind: rng() < 0.75 ? 'tree' : 'bush',
      pos: p,
      size: 2.2 + rng() * 1.6,
      angle: 0,
      variant: rng(),
      height: 7 + rng() * 4,
    });
  }
}

/** Which way is "behind" — away from the road or path the building faces. */
function backDirection(b: Building, roads: readonly Road[], fabric: Fabric): Vec2 {
  const hit = nearestRoad(roads, b.pos, 60);
  let toward: Vec2 | null = hit ? hit.point : null;

  if (!toward) {
    let bestD2 = Infinity;
    for (const path of fabric.paths) {
      for (const p of path) {
        const d2 = (p.x - b.pos.x) ** 2 + (p.y - b.pos.y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          toward = p;
        }
      }
    }
    if (bestD2 > 60 * 60) toward = null;
  }

  if (!toward) {
    // Nothing to face: use the building's own frame.
    return { x: -Math.sin(b.rotation), y: Math.cos(b.rotation) };
  }

  const dx = b.pos.x - toward.x;
  const dy = b.pos.y - toward.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** A few trees and bushes loose along the worn paths, where nobody tends them. */
function verges(
  items: DecorItem[],
  terrain: Terrain,
  fabric: Fabric,
  buildings: readonly Building[],
  rng: () => number,
): void {
  for (const path of fabric.paths) {
    for (let i = 0; i < path.length; i += 5) {
      if (rng() > 0.16) continue;
      const p = path[i];
      const nx = -Math.sin(rng() * Math.PI * 2);
      const ny = Math.cos(rng() * Math.PI * 2);
      const off = 4 + rng() * 4;
      const at = { x: p.x + nx * off, y: p.y + ny * off };
      if (terrain.isWater(at.x, at.y)) continue;
      if (distanceToNearestBuilding(buildings, at) < 11) continue;
      items.push({
        kind: rng() < 0.55 ? 'bush' : 'tree',
        pos: at,
        size: 1.4 + rng() * 1.6,
        angle: 0,
        variant: rng(),
        height: 4 + rng() * 4,
      });
    }
  }
}
