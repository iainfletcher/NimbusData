import { buildingType } from './buildings';
import { OWNER_PLAYER, type Building } from './types';

/**
 * Who works where (design/00, Axis 3).
 *
 * The economy used to run on buildings alone: put up a sawmill and timber
 * appeared. That is not a resource-management game, it is a shopping list —
 * there is one decision (build the thing) and it is always yes.
 *
 * Labour is what turns it into a game, because it puts a *second* constraint on
 * the same spatial decision:
 *
 * > **A works produces what its land holds × how well it is staffed. The land is
 * > out there, the people are in the town, and you cannot move either.**
 *
 * So a sawmill in the deepest wood on the map is worth nothing if nobody can
 * reach it, and a perfectly staffed quarry on bare rock is worth nothing too.
 * Siting stops being "find the resource" and becomes "find the resource *and*
 * house the people who will work it", which is a real trade with no correct
 * answer — exactly the kind `00` argues for and exactly the kind it argues
 * against having to compute.
 *
 * ### Why walking distance and not a road network
 *
 * Workers are matched to jobs by plain distance, nearest first. A proper
 * shortest-path assignment over the road graph would be more accurate and would
 * make the rule impossible to see: the player would have to trace routes to
 * understand why a mill was idle. A circle you can picture is worth more than an
 * optimum you cannot.
 */

/** How far somebody will walk to work, in metres. */
export const WALK_TO_WORK = 190;

/** Ticks between reassignments. People do not change jobs every tenth of a second. */
export const LABOUR_INTERVAL = 12;

export interface LabourReport {
  /** Jobs offered by workplaces that are standing. */
  jobs: number;
  /** Workers living in housing. */
  workers: number;
  /** Jobs actually filled. */
  filled: number;
  /** Workers who could not reach any job. */
  idle: number;
}

export class Labour {
  /** Staffing per workplace, 0..1, keyed by building id. */
  readonly staffing = new Map<number, number>();
  /** Where each staffed workplace draws its people from, for the map. */
  readonly commutes: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];

  readonly report: LabourReport = { jobs: 0, workers: 0, filled: 0, idle: 0 };

  /**
   * Match people to jobs, nearest pair first.
   *
   * Greedy on distance rather than optimal: it is simple, it is stable between
   * ticks, and it produces the behaviour a player would predict — the works
   * closest to housing gets staffed first, and the one out in the woods is the
   * one standing idle.
   */
  update(buildings: readonly Building[], occupancy = 1, owner = OWNER_PLAYER): void {
    this.staffing.clear();
    this.commutes.length = 0;

    const homes: { b: Building; free: number }[] = [];
    const works: { b: Building; open: number }[] = [];

    for (const b of buildings) {
      if (b.owner !== owner) continue;
      const type = buildingType(b.typeId);
      // Beds are a ceiling; the people actually living in them are what work.
      if (type.houses) homes.push({ b, free: type.houses * occupancy });
      if (type.jobs) works.push({ b, open: type.jobs });
    }

    const jobs = works.reduce((n, w) => n + w.open, 0);
    const workers = homes.reduce((n, h) => n + h.free, 0);

    // Every home/works pair within walking distance, cheapest first.
    const pairs: { home: number; work: number; d: number }[] = [];
    for (let h = 0; h < homes.length; h++) {
      for (let w = 0; w < works.length; w++) {
        const d = Math.hypot(
          homes[h].b.pos.x - works[w].b.pos.x,
          homes[h].b.pos.y - works[w].b.pos.y,
        );
        if (d > WALK_TO_WORK) continue;
        pairs.push({ home: h, work: w, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    let filled = 0;
    for (const pair of pairs) {
      const home = homes[pair.home];
      const work = works[pair.work];
      if (home.free <= 0 || work.open <= 0) continue;

      const took = Math.min(home.free, work.open);
      home.free -= took;
      work.open -= took;
      filled += took;

      // Kept for the map: a line from a house to the works it staffs is the
      // clearest possible statement of why a building is or is not working.
      if (this.commutes.length < 400) {
        this.commutes.push({
          from: { x: home.b.pos.x, y: home.b.pos.y },
          to: { x: work.b.pos.x, y: work.b.pos.y },
        });
      }
    }

    for (const w of works) {
      const type = buildingType(w.b.typeId);
      const total = type.jobs ?? 0;
      this.staffing.set(w.b.id, total > 0 ? (total - w.open) / total : 1);
    }

    this.report.jobs = jobs;
    this.report.workers = Math.round(workers);
    this.report.filled = Math.round(filled);
    this.report.idle = Math.max(0, workers - filled);
  }

  /** How well a workplace is staffed, 0..1. Buildings with no jobs are always 1. */
  staffingOf(b: Building): number {
    const type = buildingType(b.typeId);
    if (!type.jobs) return 1;
    return this.staffing.get(b.id) ?? 0;
  }
}
