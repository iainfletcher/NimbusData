import type { Season } from './calendar';

/**
 * The town's memory (design/00, Pillar E — *the city remembers*).
 *
 * Everything in this game already happens: quarters form, borders move, columns
 * break, harvests fail. None of it was ever *recorded*, so all of it happened
 * to a town with no past — and a town with no past is a diagram you are
 * operating rather than a place you have been looking after.
 *
 * > **A chronicle is the cheapest possible way to give a simulation a history,
 * > and history is most of what makes people care about a place.**
 *
 * Two rules keep it worth reading.
 *
 * **Only things that would be remembered.** Not every winter, not every
 * building, not every tick of a meter — a log that records everything is a log
 * nobody reads, and the events that matter get buried by the ones that do not.
 * A hard winter goes in; an ordinary one does not.
 *
 * **Written as a chronicle, not as telemetry.** "The Shambles took its name" is
 * a sentence about a town. "quarter_created id=3 char=industrious" is a sentence
 * about a program. They cost the same to produce.
 */

export type ChronicleKind =
  /** A place became somewhere, or stopped being it. */
  | 'place'
  /** Soldiers, borders, sieges. */
  | 'war'
  /** Hunger, hard winters, things going wrong. */
  | 'hardship'
  /** The player building something notable. */
  | 'works';

export interface Entry {
  tick: number;
  year: number;
  season: Season;
  kind: ChronicleKind;
  text: string;
}

/** Kept short. This is a memory, not a database. */
const MAX_ENTRIES = 240;

export class Chronicle {
  readonly entries: Entry[] = [];
  /** Bumped on every write, so a renderer can tell when to redraw. */
  version = 0;

  /**
   * Suppression: the same sentence twice running is noise, and several systems
   * can notice the same thing in the same season.
   */
  private recent = new Map<string, number>();

  record(
    kind: ChronicleKind,
    text: string,
    when: { tick: number; year: number; season: Season },
    /** Ticks before this exact sentence may be written again. */
    cooldown = 400,
  ): boolean {
    const last = this.recent.get(text);
    if (last !== undefined && when.tick - last < cooldown) return false;
    this.recent.set(text, when.tick);

    this.entries.push({ ...when, kind, text });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.version++;
    return true;
  }

  /** Most recent first, which is how anybody actually reads a log. */
  latest(n: number): Entry[] {
    return this.entries.slice(-n).reverse();
  }
}

/** "Autumn, year 4" — the dateline every entry is filed under. */
export function dateline(entry: Entry): string {
  return `${entry.season[0].toUpperCase()}${entry.season.slice(1)}, year ${entry.year}`;
}
