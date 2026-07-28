import { type Fabric, routeOver } from './fabric';
import type { Need } from './needs';
import { makeRng } from './rng';
import { walkRoad, type Road } from './roads';
import type { Vec2 } from './types';

/**
 * The people in the streets, and what they are doing.
 *
 * They used to be pure decoration — "no needs, no errands and no intelligence",
 * as the comment at the top of this file cheerfully admitted. They walked
 * whichever road segment they happened to be nearest, turned round at the end,
 * and picked another. It made the town look inhabited and told you nothing.
 *
 * They still change nothing: delete every one of them and the simulation runs
 * identically, exactly as the decorative-logistics rule in `design/00` requires.
 * What has changed is that **their errands are no longer invented**:
 *
 * > **Every journey on the street is one the simulation has already decided on.
 * > Nobody is going anywhere the town was not already sending them.**
 *
 * A figure walking to the sawmill is a worker `labour.ts` matched to that
 * sawmill. A figure at the well is a household `needs.ts` says draws its water
 * there. So the crowd stops being wallpaper and becomes a **readout you can
 * watch instead of a panel you have to open** — which is the thing `00` keeps
 * asking for and the one place it had been settled for with a still picture:
 *
 * - An unstaffed works has nobody walking to it. Not a warning — an absence.
 * - A quarter with no well sends nobody down to the river.
 * - An empty town has empty streets, because the crowd is sized by *population*
 *   rather than by how many buildings you have put up.
 *
 * ### Where the smarts stop, deliberately
 *
 * They do not queue, avoid each other, pick between two markets by how busy it
 * is, or carry anything that exists. All of that is simulation nobody can see
 * the output of, and it fails the same test everything else in this design is
 * held to. What they do is: leave home, go to the one place they were sent,
 * stop there a while, and come back.
 */

/** What somebody is out doing. Drawn, so it has to be worth telling apart. */
export type ErrandKind = 'work' | Need | 'wander';

export interface Journey {
  from: Vec2;
  to: Vec2;
  kind: ErrandKind;
}

export interface Person {
  pos: Vec2;
  /** Direction of travel, for facing. */
  heading: number;
  /** Which route they're on and how far along it. */
  route: Vec2[];
  leg: number;
  along: number;
  speed: number;
  /** Palette index for clothing. */
  tint: number;
  /** Phase offset so a crowd doesn't bob in unison. */
  phase: number;
  /** What they are out doing, for the figure that gets drawn. */
  errand: ErrandKind;
  /** True on the way there, false on the way back. */
  outbound: boolean;
  /** Seconds left standing still. Nobody turns straight round at the door. */
  dwell: number;
  /** Which journey they are making; -1 for a wanderer. */
  journey: number;
  /** The journey they actually set out on, which a rebuild may have changed. */
  walking: number;
  /**
   * Still to be scattered along their route.
   *
   * Without it, everybody assigned to the same journey sets off from the same
   * doorstep at the same moment and the street shows a conga line. Cleared the
   * first time they set out, because after that they are walking a real leg and
   * jumping them along it would be a teleport.
   */
  spread: boolean;
}

/** Walking pace, metres per second. */
const SLOW = 0.9;
const FAST = 1.6;

/**
 * How much of the population is out of doors at any moment.
 *
 * Not everybody, obviously, and the number is chosen for the picture rather
 * than for realism: high enough that a working quarter looks busy, low enough
 * that a street is a street rather than a crowd scene.
 */
const OUT_OF_DOORS = 0.55;
const MAX_PEOPLE = 150;

/** How long somebody stands at a well, a market or a workplace. */
const DWELL_MIN = 4;
const DWELL_MAX = 14;

/**
 * Routes computed per update, at most.
 *
 * A* across the town costs real time and there can be a hundred and fifty
 * people wanting a fresh one the instant the street network changes. Spreading
 * the work over a few frames costs nothing anybody can see — somebody stands at
 * their door for an extra half second — and turns a visible hitch on every
 * rebuild into no hitch at all.
 */
const ROUTES_PER_UPDATE = 3;

export class Crowd {
  people: Person[] = [];
  /** Ambient fallback: the raw street network, for anyone with no errand. */
  private routes: Vec2[][] = [];
  /** Every errand the town is making. Public because it is the claim: nothing
   * here was invented by the crowd, so it must be checkable against the
   * simulation that produced it. */
  journeys: Journey[] = [];
  /** Cached route per journey. Many people share one; it is computed once. */
  private planned: (Vec2[] | null)[] = [];
  private fabric: Fabric | null = null;
  private rng: () => number = makeRng(1);
  private seeded = false;
  /** How many of the crowd are this town's own people running its errands. */
  private residents = 0;

  /**
   * Rebuild for a new street network and a new set of errands.
   *
   * Called when the fabric changes, which is also when everybody's route
   * becomes stale, so this is the natural place to re-plan the whole town.
   */
  reset(
    roads: readonly Road[],
    fabric: Fabric,
    journeys: readonly Journey[],
    plan: CrowdPlan,
    seed: number,
  ): void {
    this.routes = [];
    this.fabric = fabric;
    this.journeys = journeys.slice(0, MAX_PEOPLE * 2);
    this.planned = this.journeys.map(() => null);
    this.residents = plan.residents;

    for (const road of roads) {
      const pts: Vec2[] = [];
      walkRoad(road, 5, (p) => pts.push(p));
      if (pts.length >= 2) this.routes.push(pts);
    }
    for (const path of fabric.paths) {
      if (path.length >= 2) this.routes.push(path.map((p) => ({ x: p.x, y: p.y })));
    }

    if (!this.seeded) {
      this.rng = makeRng(seed ^ 0x9a1c);
      this.seeded = true;
    }

    // Everybody already out stays out, on the road they are already on.
    //
    // The street network is rebuilt every time a building goes up or a cottage
    // grows, which in a living town is every few seconds. Re-seeding the crowd
    // each time — which is what this used to do — gave every one of them a fresh
    // random pause and no route, so **nobody ever finished a journey**: a town of
    // ninety people had one of them moving. They keep their walk and take up
    // their new errand when they next arrive somewhere.
    for (let i = 0; i < this.people.length; i++) this.assign(this.people[i], i);

    this.resize(plan);
  }

  /** Which errand the i-th person runs, or -1 for one of the ambient walkers. */
  private journeyFor(i: number): number {
    if (i >= this.residents || this.journeys.length === 0) return -1;
    return i % this.journeys.length;
  }

  /**
   * Hand somebody the errand their place in the crowd says they run.
   *
   * The label moves with the assignment rather than waiting until they next set
   * out, because the figure is drawn from it: a worker who has been re-tasked
   * but is still standing at a door would otherwise be drawn carrying the wrong
   * thing, which is exactly the kind of lie this whole change exists to remove.
   */
  private assign(person: Person, i: number): void {
    const was = person.journey;
    person.journey = this.journeyFor(i);
    const errand = person.journey >= 0 ? this.journeys[person.journey] : null;
    person.errand = errand ? errand.kind : 'wander';

    // Changing which errand somebody runs can wait until they get home; changing
    // whether they have one at all cannot. A town starts empty, so its whole
    // crowd is ambient at first, and every one of them is holding a wander route
    // hundreds of metres long. Without this they finish that walk before taking
    // up an errand — which in practice meant an entire seeded town of ninety
    // people walking the same stretch of lane in single file, having never once
    // gone anywhere the simulation sent them.
    if (was < 0 !== person.journey < 0) {
      person.route = [];
      person.leg = 0;
      person.along = 0;
      person.dwell = 0;
      person.spread = true;
    }
  }

  /**
   * Grow or shrink the crowd without disturbing anybody already walking.
   *
   * Population moves continuously and the street network does not, so the two
   * cannot share a rebuild: re-running `reset` every time somebody moved in
   * would re-seed all hundred and fifty figures and the whole town would jump.
   * Adding and removing at the tail is invisible — a few more people come out,
   * or a few fewer, which is exactly what a town growing looks like.
   */
  resize(plan: CrowdPlan): void {
    this.residents = plan.residents;
    const wanted = Math.min(MAX_PEOPLE, Math.max(0, Math.round(plan.residents + plan.ambient)));

    // Shrinking takes from the ambient end first, so the errands the town is
    // actually running are the last thing to go.
    if (wanted < this.people.length) {
      this.people.length = wanted;
      for (let i = 0; i < this.people.length; i++) this.assign(this.people[i], i);
      return;
    }
    if (wanted === this.people.length) return;
    if (this.journeys.length === 0 && this.routes.length === 0) return;

    while (this.people.length < wanted) {
      const i = this.people.length;
      const journey = this.journeyFor(i);
      const errand = journey >= 0 ? this.journeys[journey] : null;
      const person: Person = {
        pos: errand ? { ...errand.from } : { x: 0, y: 0 },
        heading: 0,
        route: [],
        leg: 0,
        along: 0,
        speed: SLOW + this.rng() * (FAST - SLOW),
        tint: Math.floor(this.rng() * 6),
        phase: this.rng() * Math.PI * 2,
        errand: errand ? errand.kind : 'wander',
        outbound: true,
        // No pause before the *first* departure. Somebody who has just come out
        // has to get on the road at once and be scattered along it, or a town
        // opened for the first time shows a dozen seconds of nobody moving —
        // which is exactly what a still picture of it looked like.
        dwell: 0,
        journey,
        walking: journey,
        spread: true,
      };
      this.people.push(person);
      if (journey < 0) this.scatter(person);
    }
  }

  /**
   * Drop a wanderer somewhere at random on the network.
   *
   * They used to be created at the origin and then sent to the nearest route,
   * which for every one of them was the same route — so the ambient half of the
   * crowd formed a single file walking one lane in the corner of the map.
   */
  private scatter(person: Person): void {
    if (this.routes.length === 0) return;
    const route = this.routes[Math.floor(this.rng() * this.routes.length)];
    person.route = route;
    person.leg = Math.floor(this.rng() * Math.max(1, route.length - 1));
    person.along = 0;
    person.pos = { ...route[person.leg] };
    person.errand = 'wander';
  }

  /**
   * Advance everyone. Driven by real elapsed time rather than the sim tick,
   * because walking at 10Hz looks like stop-motion — and since none of this
   * feeds back into the simulation, it costs nothing to let it run free.
   */
  update(dt: number): void {
    const step = Math.min(dt, 0.1);
    let budget = ROUTES_PER_UPDATE;

    for (const person of this.people) {
      if (person.dwell > 0) {
        person.dwell -= step;
        continue;
      }

      if (person.route.length < 2) {
        if (person.journey < 0) {
          if (!this.wander(person)) this.scatter(person);
          if (person.route.length < 2) continue;
        } else {
          // Only pathing costs budget. A journey somebody else has already
          // walked is a lookup, and making the nine workers of one sawmill queue
          // up over nine frames to read the same cached array would be the
          // throttle protecting nothing.
          const cached = this.planned[person.journey] != null;
          if (!cached) {
            if (budget <= 0) continue;
            budget--;
          }
          if (!this.setOut(person)) continue;
        }
      }

      let remaining = person.speed * step;

      while (remaining > 0) {
        const from = person.route[person.leg];
        const to = person.route[person.leg + 1];
        if (!to) {
          this.arrive(person);
          break;
        }

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-4) {
          person.leg++;
          person.along = 0;
          continue;
        }

        person.heading = Math.atan2(dy, dx);

        const travelled = person.along * length;
        const left = length - travelled;

        if (remaining < left) {
          person.along += remaining / length;
          remaining = 0;
        } else {
          remaining -= left;
          person.leg++;
          person.along = 0;
          if (person.leg >= person.route.length - 1) {
            this.arrive(person);
            break;
          }
        }
      }

      if (person.route.length < 2) continue;
      const from = person.route[person.leg];
      const to = person.route[Math.min(person.leg + 1, person.route.length - 1)];
      person.pos = {
        x: from.x + (to.x - from.x) * person.along,
        y: from.y + (to.y - from.y) * person.along,
      };
    }
  }

  /**
   * Put somebody on the road for their errand.
   *
   * The route is cached on the journey rather than on the person, because a
   * works with nine jobs has nine people walking the same line and pathing it
   * nine times would be nine times the work for exactly the same picture.
   */
  private setOut(person: Person): boolean {
    const journey = this.journeys[person.journey];
    if (!journey || !this.fabric) return false;

    let route = this.planned[person.journey];
    if (!route) {
      route = routeOver(this.fabric, journey.from, journey.to);
      // A journey with nowhere to walk is remembered as such: a straight line
      // between the two ends, so somebody who genuinely cannot get there by
      // street still shows the errand rather than standing at the door forever.
      this.planned[person.journey] = route ?? [{ ...journey.from }, { ...journey.to }];
      route = this.planned[person.journey]!;
    }

    // The errand is the same in both directions: somebody walking home from the
    // well is still fetching water, and is still carrying the pail.
    person.route = person.outbound ? route : [...route].reverse();
    person.errand = journey.kind;
    person.walking = person.journey;
    person.leg = 0;
    person.along = 0;

    if (person.spread) {
      person.spread = false;
      person.leg = Math.floor(this.rng() * Math.max(1, person.route.length - 1));
    }
    return true;
  }

  /** Arrived. Stand about a while, then head back the other way. */
  private arrive(person: Person): void {
    const end = person.route[person.route.length - 1];
    if (end) person.pos = { ...end };
    person.route = [];
    person.leg = 0;
    person.along = 0;
    person.dwell = DWELL_MIN + this.rng() * (DWELL_MAX - DWELL_MIN);

    if (person.journey < 0) {
      // A wanderer who has walked to the end of a lane and has nowhere obvious
      // to go next is dropped somewhere else on the network rather than pacing
      // the same two segments forever.
      if (!this.wander(person)) this.scatter(person);
      return;
    }

    // A rebuild may have handed them a different errand while they were out. If
    // so they start it from its beginning rather than walking the return half of
    // a journey they never made.
    if (person.journey !== person.walking) {
      person.outbound = true;
      return;
    }
    person.outbound = !person.outbound;
  }

  /**
   * The old behaviour, kept for anyone with no errand to run.
   *
   * Needs and labour are computed for the player alone — the rival is a pressure
   * source, not a second economy — so without this its town would go completely
   * still the moment errands arrived, which would read as a bug rather than as a
   * simplification. A wanderer walks the network the way everybody used to.
   */
  private wander(person: Person): boolean {
    if (this.routes.length === 0) return false;
    person.errand = 'wander';

    let best: Vec2[] | null = null;
    let bestFromStart = true;
    let bestD2 = Infinity;

    for (const route of this.routes) {
      if (route === person.route) continue;

      const start = route[0];
      const end = route[route.length - 1];
      const dStart = (start.x - person.pos.x) ** 2 + (start.y - person.pos.y) ** 2;
      const dEnd = (end.x - person.pos.x) ** 2 + (end.y - person.pos.y) ** 2;

      if (dStart < bestD2) {
        bestD2 = dStart;
        best = route;
        bestFromStart = true;
      }
      if (dEnd < bestD2) {
        bestD2 = dEnd;
        best = route;
        bestFromStart = false;
      }
    }

    if (!best) return false;

    person.route = bestFromStart ? best : [...best].reverse();
    person.leg = 0;
    person.along = 0;
    return true;
  }
}

/** How the crowd is made up: your people on errands, and everyone else. */
export interface CrowdPlan {
  /** This town's own people, each running a journey the simulation decided on. */
  residents: number;
  /** Walkers with no errand, for ground nothing simulates households on. */
  ambient: number;
}

/**
 * How many people should be out, given who actually lives here.
 *
 * The old rule was three per building, which meant a town of empty houses had
 * exactly as many people in its streets as a full one — the single most
 * misleading thing the view did, because population is otherwise only a number
 * in the corner.
 *
 * The two halves are separate because they mean different things. Residents are
 * a *readout*: each one is a journey `labour.ts` or `needs.ts` decided on, and
 * an empty town has none. The ambient share exists because needs and labour are
 * computed for the player alone — the rival is a pressure source, not a second
 * economy — and a dead-still enemy town would read as a bug rather than as the
 * simplification it is.
 */
export function crowdPlan(population: number, rivalBuildings: number): CrowdPlan {
  const residents = Math.min(MAX_PEOPLE, Math.round(population * OUT_OF_DOORS));
  const ambient = Math.min(MAX_PEOPLE - residents, Math.round(rivalBuildings * 0.7));
  return { residents, ambient };
}
