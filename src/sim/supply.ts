import { buildingType } from './buildings';
import { nearestRoad, type Road } from './roads';
import { OWNER_PLAYER, type Building, type Resource, type Vec2 } from './types';

/**
 * Who feeds whom (design/00, Axis 2 — the half that was never built).
 *
 * `00` makes what it calls "probably the single most important call in the
 * document": goods are **adjacency-structural and carrier-decorative**.
 *
 * > **Structure = catchment.** Every building projects a visible radius.
 * > Overlapping catchments connect automatically. Goods flow along those
 * > connections by rule. Your logistics decision is **placement adjacency** —
 * > never route-building.
 *
 * Only the decorative half had been built. Every works was a *harvester* that
 * turned ground into a global stock, nothing consumed anything, and the foundry
 * — the one building in the catalogue whose entire job is to combine two things
 * — produced nothing at all. So there were no chains, and therefore no reason
 * for one building to be near another.
 *
 * This is the structural half:
 *
 * > **A works that combines inputs is fed by what stands near it, not by what is
 * > in the barn.**
 *
 * A foundry needs ore and timber *reaching* it. Ore sits in a few scarce seams
 * and wood grows somewhere else entirely, so siting a foundry means finding
 * ground where a mine's catchment and a sawmill's catchment overlap — or
 * building the street that makes them overlap. That is the best decision in the
 * game and it is one rule, with no ratios in it anywhere.
 *
 * ### Roads finally do something economic
 *
 * `00` promises "a road extends a building's catchment. Roads are reach, not
 * throughput", and until now roads were pure fabric. Here they pay:
 *
 * > **150 metres across country. 300 along a street.**
 *
 * Two buildings that both front a road can be twice as far apart and still
 * trade. So laying a lane to the ore seam is a real economic act with a real
 * price in stone, and it is spatial rather than arithmetical.
 *
 * ### Self-throttling, which falls out rather than being imposed
 *
 * A producer's output is shared equally among everybody drawing on it, and a
 * consumer runs at the *worst* of its inputs. So a second foundry on one mine
 * halves them both — wasteful, never broken, and visible as two half-idle
 * buildings rather than as a number in a panel. Nobody computes a correct ratio,
 * because there is nothing to compute: you look at the map.
 *
 * What a producer's neighbours draw never reaches the town's stock, which is the
 * other half of the throttle. Feed every sawmill you have into foundries and
 * your timber stops accumulating — and you can see exactly which mills it went
 * to, because the links are drawn.
 */

/** Metres a works reaches for an input across open country. */
export const SUPPLY_REACH = 150;

/** …and along a street. Roads are reach, not throughput (design/00, Axis 2). */
export const SUPPLY_REACH_ROAD = 300;

/** How near a road a building has to be to count as fronting it. */
const FRONTING = 26;

/** Ticks between recomputations. Supply changes when you build, not per tick. */
export const SUPPLY_INTERVAL = 10;

/** A producer feeding a consumer, and how much is actually moving. */
export interface Link {
  from: Vec2;
  to: Vec2;
  resource: Resource;
  /** Units per tick along this link, for the thickness it is drawn at. */
  flow: number;
}

interface Producer {
  b: Building;
  resource: Resource;
  /** Units per tick at full staffing and full ground. */
  output: number;
  /** How much of it neighbours are taking. */
  drawn: number;
  fronts: boolean;
}

interface Consumer {
  b: Building;
  needs: Partial<Record<Resource, number>>;
  fronts: boolean;
  /** Producers in range, per input. */
  sources: Map<Resource, Producer[]>;
}

export class Supply {
  /** How fully each converting works is fed, 0..1, keyed by building id. */
  private fed = new Map<number, number>();
  /** Which inputs a works cannot get enough of, for the map markers. */
  readonly starved = new Map<number, Resource[]>();
  /** Every feed in the town, for drawing. */
  readonly links: Link[] = [];
  /**
   * What was drawn off each producer, so the economy knows how much of its
   * output never reached the stock.
   */
  private taken = new Map<number, number>();

  /**
   * Work out who is feeding whom.
   *
   * `rawOutput` reports what a harvesting works yields per tick — the economy
   * already knows, because it is ground × staffing × season, and duplicating
   * that here would be two places to get it wrong.
   */
  update(
    buildings: readonly Building[],
    roads: readonly Road[],
    rawOutput: (b: Building) => number,
    owner = OWNER_PLAYER,
  ): void {
    this.fed.clear();

    // Solved twice, because the chain has two stages: a workshop is fed by a
    // foundry, whose own output is not known until the ore and timber reaching
    // *it* have been resolved. One pass would leave the second stage a tick
    // behind — which is survivable but wrong, and shows up as a workshop that
    // is briefly starved every time anything is built. Two passes is the depth
    // of the tree, and the tree is capped at three nodes by design (`00`,
    // Axis 3), so this is not the beginning of a fixed-point solver.
    this.solve(buildings, roads, rawOutput, owner);
    this.solve(buildings, roads, rawOutput, owner);
  }

  private solve(
    buildings: readonly Building[],
    roads: readonly Road[],
    rawOutput: (b: Building) => number,
    owner: number,
  ): void {
    this.starved.clear();
    this.taken.clear();
    this.links.length = 0;

    const producers: Producer[] = [];
    const consumers: Consumer[] = [];

    for (const b of buildings) {
      if (b.owner !== owner) continue;
      const type = buildingType(b.typeId);
      if (!type.produces && !type.consumes) continue;

      const fronts = nearestRoad(roads, b.pos, FRONTING) !== null;

      if (type.produces) {
        producers.push({
          b,
          resource: type.produces.resource,
          output: rawOutput(b),
          drawn: 0,
          fronts,
        });
      }
      if (type.consumes) {
        consumers.push({ b, needs: type.consumes, fronts, sources: new Map() });
      }
    }

    // A converter can also be a producer of its own good, and must not feed
    // itself; nothing in the catalogue does, but the rule is cheap to state.
    for (const c of consumers) {
      for (const resource of Object.keys(c.needs) as Resource[]) {
        const near = producers.filter(
          (p) =>
            p.resource === resource &&
            p.b.id !== c.b.id &&
            within(p.b.pos, c.b.pos, p.fronts && c.fronts),
        );
        c.sources.set(resource, near);
      }
    }

    // How many consumers each producer is supporting. Shared equally, because
    // any cleverer allocation is an optimisation nobody can see and nobody
    // asked for — and because equal shares are what "two mills share one wood"
    // already means everywhere else in this game.
    const claims = new Map<number, number>();
    for (const c of consumers) {
      for (const list of c.sources.values()) {
        for (const p of list) claims.set(p.b.id, (claims.get(p.b.id) ?? 0) + 1);
      }
    }

    for (const c of consumers) {
      let rate = 1;
      const short: Resource[] = [];

      for (const [resource, wanted] of Object.entries(c.needs) as [Resource, number][]) {
        if (!wanted) continue;
        let available = 0;
        for (const p of c.sources.get(resource) ?? []) {
          available += p.output / Math.max(1, claims.get(p.b.id) ?? 1);
        }
        const share = Math.min(1, available / wanted);
        if (share < 0.999) short.push(resource);
        rate = Math.min(rate, share);
      }

      this.fed.set(c.b.id, rate);
      if (short.length > 0) this.starved.set(c.b.id, short);

      // Book what actually moves, now the rate is known. A works running at a
      // third draws a third of its inputs — the rest stays where it was and
      // reaches the town's stock as usual.
      if (rate <= 0) continue;
      for (const [resource, wanted] of Object.entries(c.needs) as [Resource, number][]) {
        if (!wanted) continue;
        const list = c.sources.get(resource) ?? [];
        let left = wanted * rate;
        for (const p of list) {
          if (left <= 0) break;
          const share = p.output / Math.max(1, claims.get(p.b.id) ?? 1);
          const moved = Math.min(share, left);
          if (moved <= 0.0001) continue;
          left -= moved;
          p.drawn += moved;
          this.taken.set(p.b.id, (this.taken.get(p.b.id) ?? 0) + moved);
          this.links.push({
            from: { ...p.b.pos },
            to: { ...c.b.pos },
            resource,
            flow: moved,
          });
        }
      }
    }
  }

  /** How fully a converting works is fed, 0..1. Anything else is always 1. */
  feedOf(b: Building): number {
    const type = buildingType(b.typeId);
    if (!type.consumes) return 1;
    return this.fed.get(b.id) ?? 0;
  }

  /** What a producer's neighbours took, so it never reaches the town's stock. */
  takenFrom(b: Building): number {
    return this.taken.get(b.id) ?? 0;
  }
}

function within(a: Vec2, b: Vec2, onStreet: boolean): boolean {
  const reach = onStreet ? SUPPLY_REACH_ROAD : SUPPLY_REACH;
  return Math.hypot(a.x - b.x, a.y - b.y) <= reach;
}
