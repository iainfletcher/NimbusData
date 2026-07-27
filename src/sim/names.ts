import { makeRng } from './rng';
import type { Character } from './types';

/**
 * Names (design/07 §7).
 *
 * A character-level Markov model over real English toponymy for settlements, and
 * a rule-driven generator for streets.
 *
 * The street half is the part that earns its place. British towns name their
 * streets after **what happened on them** — and the character field already
 * knows what happens where. So a street called Tanner's Row is called that
 * because there is genuinely a tannery on it, which makes the name a legibility
 * feature rather than decoration.
 *
 * And when the tannery goes and the quarter turns genteel, the name stays. That
 * is the town remembering (design/00, Pillar E), at no cost.
 */

/**
 * Training corpus. Real English place names, chosen for spread across the usual
 * elements — Old English -tun/-ham/-ford/-leigh, Norse -by/-thorpe/-thwaite,
 * Celtic and Roman survivals.
 */
const CORPUS = [
  'Abbotsbury', 'Alderton', 'Ashcombe', 'Astonbury', 'Barrowden', 'Bexley',
  'Bramfield', 'Bredon', 'Brigsley', 'Burnham', 'Caldbeck', 'Chalgrove',
  'Chedworth', 'Claverdon', 'Corfe', 'Cranborne', 'Dalby', 'Denholme',
  'Duxford', 'Eastleigh', 'Elmswell', 'Fairthorpe', 'Farndon', 'Felsted',
  'Fenwick', 'Garsdale', 'Glemsford', 'Grimsthorpe', 'Hadleigh', 'Halewood',
  'Hartfield', 'Haverbrook', 'Hawksworth', 'Helmsley', 'Hensingham',
  'Holbeck', 'Hornby', 'Ickleton', 'Ingleby', 'Kelmscott', 'Kirkbride',
  'Langdale', 'Lavenham', 'Linthwaite', 'Marlow', 'Melbury', 'Mereworth',
  'Middlethorpe', 'Nettleham', 'Newbold', 'Northwold', 'Oakworth', 'Osmotherley',
  'Padstow', 'Pickering', 'Quenington', 'Rawcliffe', 'Redmarley', 'Ringstead',
  'Rothwell', 'Salcombe', 'Sandringham', 'Scarcliffe', 'Sedgeford', 'Shipton',
  'Skelwith', 'Southwold', 'Stanbridge', 'Stogumber', 'Swaffham', 'Tarrant',
  'Thirlmere', 'Thornbury', 'Thwaite', 'Tilbrook', 'Ufford', 'Upwood',
  'Wadhurst', 'Walberswick', 'Wetherby', 'Wharfedale', 'Whitwell', 'Wickham',
  'Willerby', 'Winsford', 'Wivenhoe', 'Woolacombe', 'Wrenbury', 'Yarnton',
  'Amberley', 'Appleton', 'Bardswell', 'Beckthorpe', 'Bilsdale', 'Blackmoor',
  'Bramshaw', 'Brindleford', 'Cadbury', 'Carlton', 'Charnwood', 'Chilcombe',
  'Clayworth', 'Coldstream', 'Cottesmore', 'Cranleigh', 'Darnford',
  'Deepdale', 'Downham', 'Easterwick', 'Edgworth', 'Elmdon', 'Fernhurst',
  'Fladbury', 'Foxholme', 'Frithville', 'Gaddesby', 'Girsby', 'Goosnargh',
  'Grangeworth', 'Greenhalgh', 'Hallowfield', 'Harbury', 'Hazelmere',
  'Heathfield', 'Hollowdale', 'Ivybridge', 'Kettlewell', 'Knaresby',
  'Lambourne', 'Longstock', 'Ludworth', 'Marchwood', 'Meldreth', 'Mickleton',
  'Morborne', 'Nafferton', 'Netherby', 'Oakhampton', 'Owlsbury', 'Penhurst',
  'Ravensthorpe', 'Rushmere', 'Saxmundham', 'Shelfanger', 'Silverdale',
  'Stapleford', 'Stonegrave', 'Tewkesford', 'Thornleigh', 'Turnditch',
  'Wentworth', 'Westmancote', 'Whaddon', 'Windrush', 'Wrangbrook',
];

const ORDER = 3;
const START = '^';
const END = '$';

type Model = Map<string, string[]>;

let model: Model | null = null;

/**
 * The terminal clusters the corpus actually ends in.
 *
 * Without this the sampler stops wherever END happens to come up and produces
 * names cut off mid-element — Thirlme, Stogumbe, Hensing. Requiring a real
 * ending is a cheap filter that removes almost all of them, because English
 * place names end in a fairly small set of things.
 */
let endings: Set<string> | null = null;

const ENDING_LENGTH = 3;

function train(): Model {
  const m: Map<string, string[]> = new Map();
  const ends = new Set<string>();

  for (const raw of CORPUS) {
    const lower = raw.toLowerCase();
    ends.add(lower.slice(-ENDING_LENGTH));

    const word = START.repeat(ORDER) + lower + END;
    for (let i = ORDER; i < word.length; i++) {
      const context = word.slice(i - ORDER, i);
      const next = word[i];
      const bucket = m.get(context);
      if (bucket) bucket.push(next);
      else m.set(context, [next]);
    }
  }

  endings = ends;
  return m;
}

/** A plausible English settlement name. */
export function settlementName(rng: () => number): string {
  model ??= train();

  for (let attempt = 0; attempt < 40; attempt++) {
    let context = START.repeat(ORDER);
    let out = '';

    while (out.length < 14) {
      const bucket = model.get(context);
      if (!bucket) break;
      const next = bucket[Math.floor(rng() * bucket.length)];
      if (next === END) break;
      out += next;
      context = (context + next).slice(-ORDER);
    }

    // Reject the too-short, the truncated, and anything handed back verbatim.
    if (out.length < 6) continue;
    if (!endings?.has(out.slice(-ENDING_LENGTH))) continue;
    const capitalised = out[0].toUpperCase() + out.slice(1);
    if (CORPUS.includes(capitalised)) continue;
    return capitalised;
  }

  return 'Netherby';
}

/** Occasional prefixes and suffixes, for a bit of range. */
export function townName(rng: () => number): string {
  const base = settlementName(rng);
  const roll = rng();
  if (roll < 0.08) return `${base} Magna`;
  if (roll < 0.14) return `Kings ${base}`;
  if (roll < 0.2) return `${base} St Mary`;
  if (roll < 0.26) return `Little ${base}`;
  if (roll < 0.3) return `${base}-on-the-Water`;
  return base;
}

/**
 * Street names by district character. These are the real vocabularies — gate
 * from Norse *gata*, and Grape Lane is the polite Victorian rewriting of
 * something considerably ruder.
 */
const STREET_NAMES: Record<Character, string[]> = {
  industrious: [
    "Tanner's Row", 'The Shambles', 'Skinnergate', 'Smithy Lane', 'Forge Row',
    'Dyehouse Lane', 'Bellfounder Street', 'Coppergate', 'Wheelwright Row',
  ],
  mercantile: [
    'Cornmarket', 'Cheapside', 'Silver Street', 'Mercer Row', 'The Pantiles',
    'Woolpack Lane', 'Saltergate', 'Spicer Street', 'Exchange Row',
  ],
  devout: [
    'Priory Lane', 'Paternoster Row', 'Kirkgate', 'Almshouse Walk',
    'Bedern Lane', 'Chantry Close', 'Minster Yard', 'St Cuthbert Street',
  ],
  rustic: [
    'Sheep Street', 'Millpond Lane', 'Barley Row', 'The Green', 'Ox Pasture',
    'Haymarket', 'Drovers Way', 'Cowgate',
  ],
  raucous: [
    'Grape Lane', 'Fiddler Row', 'The Bear Pit', 'Tipplers Yard',
    'Malt Shovel Lane', 'Piper Street', 'Bacchus Walk',
  ],
  verdant: [
    'Orchard Walk', 'Elm Row', 'Garden Lane', 'The Butts', 'Willow Bank',
    'Spring Gardens', 'Lime Walk',
  ],
};

/** Fallback for streets running through nowhere in particular. */
const OPEN_ROAD = [
  'Back Lane', 'The Causeway', 'Old Road', 'Marsh Way', 'Ford Lane',
  'Hollow Way', 'Green Lane', 'Bridge Road',
];

export interface NamedPlace {
  name: string;
  character: Character | null;
}

/**
 * Name a street from the character it runs through, avoiding names already used.
 * Falls back to a generic country road when nothing dominates.
 */
export function streetName(
  character: Character | null,
  used: Set<string>,
  rng: () => number,
): string {
  const pool = character ? STREET_NAMES[character] : OPEN_ROAD;
  const free = pool.filter((n) => !used.has(n));
  const source = free.length > 0 ? free : OPEN_ROAD.filter((n) => !used.has(n));

  if (source.length === 0) {
    // Everything is taken; number it, as a real town eventually does.
    let n = 2;
    while (used.has(`${pool[0]} (${n})`)) n++;
    const name = `${pool[0]} (${n})`;
    used.add(name);
    return name;
  }

  const name = source[Math.floor(rng() * source.length)];
  used.add(name);
  return name;
}

/** Quarter names, which read better as "the X quarter" than as a street would. */
const QUARTER_LABEL: Record<Character, string> = {
  industrious: 'Works',
  mercantile: 'Market',
  devout: 'Minster',
  rustic: 'Fields',
  raucous: 'Bankside',
  verdant: 'Gardens',
};

export function quarterName(character: Character, town: string): string {
  return `${town} ${QUARTER_LABEL[character]}`;
}

export function makeNameRng(seed: number): () => number {
  return makeRng(seed ^ 0x4e41);
}
