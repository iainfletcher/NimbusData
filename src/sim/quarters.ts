import type { CharacterField } from './field';
import { COHERENCE_THRESHOLD } from './field';
import { quarterName } from './names';

import {
  CELL_SIZE,
  OWNER_PLAYER,
  WORLD_CELLS,
  type Building,
  type Character,
  type Vec2,
} from './types';

/**
 * Quarters: the parts of a town that have become **somewhere**, and know it.
 *
 * The character field has always been able to answer "what is this cell like",
 * and every system downstream reads it that way — one cell at a time, as a
 * number. Nothing ever looked at the field and said *there is a place here*.
 *
 * That gap is why a town could be well-built and still feel anonymous. A player
 * does not think in cells; they think in **places**, and a place is not a place
 * until it has a name. So:
 *
 * > **When enough contiguous ground agrees about what it is, it becomes a
 * > quarter, and it is given a name it keeps.**
 *
 * Nothing about this is a reward or a score. It is recognition: the town
 * noticing what you have already built and telling you what you made. Which is
 * `00`'s Pillar E — the city remembers — arriving through the system that was
 * already there rather than through anything built to produce it.
 *
 * ### Why names persist
 *
 * The naming is the whole point, so a quarter keeps its name as it grows, and
 * keeps it even when its character drifts. A district that was the tanneries
 * and is now genteel is *still called the Shambles*, because that is exactly
 * what real places do, and because a name that changed whenever the field
 * wobbled would be worth nothing.
 */

/**
 * A quarter has to be this big before it is a place rather than a few houses.
 *
 * Cells are 4m, so this is roughly a hundred metres across. The first attempt
 * used 34 and shredded one town into **nineteen** quarters, several of them
 * smaller than a farmyard — which is worse than having none, because a name
 * that is handed out to every patch of ground means nothing.
 */
const MIN_CELLS = 260;

/** And it has to hold this many buildings, so open ground never gets a name. */
const MIN_BUILDINGS = 6;

/**
 * Recounts a quarter may fail before it is written off.
 *
 * Without it a district that dips below the threshold for one recount dies and
 * is re-founded under a new name, and the chronicle fills with a place losing
 * and regaining its character every few seasons. Places do not do that.
 */
const GRACE = 3;

/** Ticks between recomputations. Quarters form over years. */
export const QUARTER_INTERVAL = 30;

export interface Quarter {
  id: number;
  name: string;
  /** What it is now. May differ from what it was called after. */
  character: Character;
  /** What it was when it was named — kept so drift can be noticed. */
  namedFor: Character;
  cells: number;
  centre: Vec2;
  buildings: number;
  owner: number;
  /** Year it was first named. */
  since: number;
  /** Consecutive recounts it has failed. Reset whenever it is found again. */
  missed: number;
}

/** Something worth telling the player about, produced by a recount. */
export type QuarterEvent =
  | { kind: 'named'; quarter: Quarter }
  | { kind: 'changed'; quarter: Quarter; from: Character; to: Character }
  | { kind: 'lost'; name: string };

export class Quarters {
  readonly list: Quarter[] = [];
  /** Bumped on every recount, so a renderer can tell when to redraw labels. */
  revision = 0;

  private width = WORLD_CELLS;
  private height = WORLD_CELLS;
  /** Which quarter owns each cell, +1 (0 means none). */
  private labels: Uint16Array;
  private scratch: Int32Array;
  private queue: Int32Array;
  private nextId = 1;
  private used = new Set<string>();

  constructor() {
    const n = this.width * this.height;
    this.labels = new Uint16Array(n);
    this.scratch = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  /**
   * Recompute quarters from the field, and report what changed.
   *
   * Components are matched to existing quarters by **which quarter most of
   * their cells belonged to last time**, which is what lets a quarter grow,
   * shift and absorb a neighbour while staying the same named place.
   */
  update(
    field: CharacterField,
    buildings: readonly Building[],
    year: number,
    rng: () => number,
    town: string,
  ): QuarterEvent[] {
    const events: QuarterEvent[] = [];
    const { width, height, scratch, queue } = this;
    scratch.fill(-1);

    const seen = new Set<number>();
    const fresh: Quarter[] = [];
    // Each component gets its own mark. Using a shared `1` meant every component
    // counted the buildings of every component before it — which is how a
    // sixty-nine-cell quarter came to report a hundred buildings.
    let component = 0;

    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        const start = cy * width + cx;
        if (scratch[start] >= 0) continue;

        const reading = field.readCell(cx, cy);
        if (!reading.dominant || reading.coherence < COHERENCE_THRESHOLD) continue;
        if (reading.intensity < 0.14) continue;

        // Flood the connected run of ground that agrees about what it is.
        const character = reading.dominant;
        let head = 0;
        let tail = 0;
        const mark = ++component;
        queue[tail++] = start;
        scratch[start] = mark;

        let count = 0;
        let sx = 0;
        let sy = 0;
        const votes = new Map<number, number>();

        while (head < tail) {
          const cell = queue[head++];
          const x = cell % width;
          const y = (cell / width) | 0;
          count++;
          sx += x;
          sy += y;

          const previous = this.labels[cell];
          if (previous > 0) votes.set(previous, (votes.get(previous) ?? 0) + 1);

          // Eight-connected: a district separated by one diagonal cell of muddle
          // is still one district, and four-connectivity split several in half.
          for (let d = 0; d < 8; d++) {
            const nx = x + NX[d];
            const ny = y + NY[d];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (scratch[ni] >= 0) continue;
            const r = field.readCell(nx, ny);
            if (r.dominant !== character) continue;
            if (r.coherence < COHERENCE_THRESHOLD || r.intensity < 0.14) continue;
            scratch[ni] = mark;
            queue[tail++] = ni;
          }
        }

        if (count < MIN_CELLS) continue;

        const centre = {
          x: ((sx / count) + 0.5) * CELL_SIZE,
          y: ((sy / count) + 0.5) * CELL_SIZE,
        };

        // Who lives here, and whose it is.
        let inside = 0;
        let playerOwned = 0;
        for (const b of buildings) {
          const bx = Math.floor(b.pos.x / CELL_SIZE);
          const by = Math.floor(b.pos.y / CELL_SIZE);
          if (bx < 0 || by < 0 || bx >= width || by >= height) continue;
          if (scratch[by * width + bx] !== mark) continue;
          inside++;
          if (b.owner === OWNER_PLAYER) playerOwned++;
        }
        if (inside < MIN_BUILDINGS) continue;

        // Inherit the identity of whichever quarter most of this ground was.
        let bestId = 0;
        let bestVotes = 0;
        for (const [id, n] of votes) {
          if (n > bestVotes) {
            bestVotes = n;
            bestId = id;
          }
        }

        const previous = bestId > 0 ? this.list.find((q) => q.id === bestId) : undefined;
        const owner = playerOwned * 2 >= inside ? OWNER_PLAYER : 1;

        if (previous && !seen.has(previous.id)) {
          seen.add(previous.id);
          const changed = previous.character !== character;
          previous.character = character;
          previous.cells = count;
          previous.centre = centre;
          previous.buildings = inside;
          previous.owner = owner;
          previous.missed = 0;
          if (changed) {
            events.push({ kind: 'changed', quarter: previous, from: previous.namedFor, to: character });
          }
          fresh.push(previous);
        } else {
          const quarter: Quarter = {
            id: this.nextId++,
            name: pickName(character, town, this.used, rng),
            character,
            namedFor: character,
            cells: count,
            centre,
            buildings: inside,
            owner,
            since: year,
            missed: 0,
          };
          fresh.push(quarter);
          events.push({ kind: 'named', quarter });
        }

        // Mark the component with its owning quarter for next time.
        const id = fresh[fresh.length - 1].id;
        for (let i = 0; i < tail; i++) this.labels[queue[i]] = id;
      }
    }

    // A quarter that failed this recount is given a few more before it is
    // written off, and keeps its ground marked meanwhile.
    for (const old of this.list) {
      if (fresh.includes(old)) continue;
      old.missed++;
      if (old.missed < GRACE) {
        fresh.push(old);
        continue;
      }
      events.push({ kind: 'lost', name: old.name });
    }

    // Anything not in a surviving component belongs to nobody now.
    const alive = new Set(fresh.map((q) => q.id));
    for (let i = 0; i < this.labels.length; i++) {
      if (this.labels[i] > 0 && !alive.has(this.labels[i])) this.labels[i] = 0;
    }

    this.list.length = 0;
    this.list.push(...fresh);
    this.list.sort((a, b) => b.cells - a.cells);
    this.revision++;
    return events;
  }

  /** The quarter a point falls in, if any. */
  at(wx: number, wy: number): Quarter | null {
    const cx = Math.floor(wx / CELL_SIZE);
    const cy = Math.floor(wy / CELL_SIZE);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return null;
    const id = this.labels[cy * this.width + cx];
    if (id === 0) return null;
    return this.list.find((q) => q.id === id) ?? null;
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Quarter names, and they matter more than anything else in this file.
 *
 * A generated name has to sound like somewhere people live rather than like a
 * label, so these are real English urban toponyms — the kind that survive on
 * street signs centuries after whatever they described has gone. "The Shambles"
 * was where butchers worked. "Bankside" was outside the city's jurisdiction and
 * therefore where the theatres and bear pits were.
 */
const QUARTER_NAMES: Record<Character, string[]> = {
  industrious: ['The Shambles', 'Smithfield', 'Coppergate', 'The Forges', 'Tanner Bank', 'Sootcroft'],
  mercantile: ['Cheapside', 'The Staple', 'Cornmarket', 'Silverside', 'The Pantiles', 'Woolgate'],
  devout: ['Minster Yard', 'The Close', 'Paternoster', 'Bedern', 'Chantry End', 'Priorsgate'],
  rustic: ['Oxpasture', 'The Hayfields', 'Millpond', 'Barleycroft', 'Cowgate', 'The Byres'],
  raucous: ['Bankside', 'The Bear Pit', 'Grape Lane', 'Tipplers End', 'Fiddlers Row', 'The Stews'],
  verdant: ['Spring Gardens', 'The Butts', 'Orchard End', 'Elmfield', 'Willowbank', 'The Grove'],
  martial: ['The Bailey', 'Castlegate', 'Barbican', 'Muster Green', 'The Postern', 'Bowyer End'],
};

function pickName(
  character: Character,
  town: string,
  used: Set<string>,
  rng: () => number,
): string {
  const pool = QUARTER_NAMES[character].filter((n) => !used.has(n));
  if (pool.length > 0) {
    const name = pool[Math.floor(rng() * pool.length)];
    used.add(name);
    return name;
  }

  // Everything characterful is taken; fall back to naming it after the town,
  // which is what a real place does with its second market square.
  let name = quarterName(character, town);
  let n = 2;
  while (used.has(name)) name = `${quarterName(character, town)} ${romanNumeral(n++)}`;
  used.add(name);
  return name;
}

function romanNumeral(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] ?? String(n);
}
