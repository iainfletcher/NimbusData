import type { BuildingType } from './types';

/**
 * MVP catalogue (design/06 §3). Medieval era only, seven characters, four
 * families.
 *
 * The military family was originally left out on the grounds that it would need
 * a seventh character nothing else read, and that territory was out of scope.
 * Both reasons have expired: territory is the lead pillar and now has a military
 * half, so garrisons are here, they emit `martial`, and a garrison quarter grows
 * its own housing like every other quarter does.
 *
 * Emission strengths are on an arbitrary shared scale — what matters is their
 * ratio to each other, since coherence is a share rather than a magnitude.
 */
const TYPES: BuildingType[] = [
  // ---- Economic ----------------------------------------------------------
  {
    id: 'foundry',
    name: 'Foundry',
    family: 'economic',
    width: 18,
    depth: 14,
    emissions: [{ character: 'industrious', strength: 1.6, radius: 110 }],
    cost: { timber: 30, stone: 45 },
    jobs: 12,
    // The one building whose entire job is to *combine* two things, and which
    // until now produced nothing at all. Ore sits in a few scarce seams and wood
    // grows somewhere else, so siting a foundry is the problem of finding ground
    // where two catchments overlap — or laying the street that makes them.
    consumes: { ore: 0.5, timber: 0.3 },
    produces: { resource: 'iron', rate: 0.26 },
  },
  {
    id: 'tannery',
    name: 'Tannery',
    family: 'economic',
    width: 14,
    depth: 12,
    emissions: [{ character: 'industrious', strength: 1.2, radius: 90 }],
    cost: { timber: 22, stone: 14 },
    jobs: 6,
  },
  {
    id: 'sawmill',
    name: 'Sawmill',
    family: 'economic',
    width: 16,
    depth: 10,
    emissions: [
      { character: 'industrious', strength: 0.9, radius: 70 },
      { character: 'rustic', strength: 0.3, radius: 50 },
    ],
    cost: { timber: 16, stone: 8 },
    jobs: 5,
    harvests: 'timber',
    produces: { resource: 'timber', rate: 0.0022 },
  },
  {
    id: 'quarry',
    name: 'Quarry',
    family: 'economic',
    width: 20,
    depth: 16,
    emissions: [{ character: 'industrious', strength: 1.1, radius: 85 }],
    cost: { timber: 14 },
    jobs: 8,
    harvests: 'stone',
    produces: { resource: 'stone', rate: 0.0026 },
  },
  {
    id: 'workshop',
    name: 'Workshop',
    family: 'economic',
    width: 10,
    depth: 9,
    emissions: [{ character: 'industrious', strength: 0.5, radius: 45 }],
    cost: { timber: 14, stone: 6 },
    jobs: 3,
    // Iron into tools — the end of the metal chain and the thing the landmarks
    // are built with. Deliberately small and cheap: you want several, spread
    // through the town, rather than one optimally placed one.
    consumes: { iron: 0.1, timber: 0.2 },
    produces: { resource: 'tools', rate: 0.085 },
  },
  {
    id: 'market',
    name: 'Market Cross',
    family: 'economic',
    width: 20,
    depth: 20,
    emissions: [
      { character: 'mercantile', strength: 1.5, radius: 120 },
      { character: 'raucous', strength: 0.3, radius: 60 },
    ],
    cost: { timber: 26, stone: 34, tools: 8 },
    jobs: 6,
    serves: ['market'],
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    family: 'economic',
    width: 16,
    depth: 12,
    emissions: [{ character: 'mercantile', strength: 0.8, radius: 70 }],
    cost: { timber: 28, stone: 12 },
    jobs: 4,
    serves: ['market'],
  },
  {
    id: 'watermill',
    name: 'Watermill',
    family: 'economic',
    width: 12,
    depth: 10,
    emissions: [{ character: 'rustic', strength: 1.0, radius: 80 }],
    cost: { timber: 24, stone: 20 },
    jobs: 4,
    produces: { resource: 'food', rate: 0.09 },
  },
  {
    id: 'farm',
    name: 'Farmstead',
    family: 'economic',
    width: 18,
    depth: 14,
    emissions: [{ character: 'rustic', strength: 1.3, radius: 110 }],
    cost: { timber: 20, stone: 6 },
    jobs: 9,
    harvests: 'arable',
    produces: { resource: 'food', rate: 0.0062 },
  },

  {
    id: 'mine',
    name: 'Ironstone Mine',
    family: 'economic',
    width: 16,
    depth: 14,
    emissions: [{ character: 'industrious', strength: 1.4, radius: 100 }],
    cost: { timber: 34, stone: 22 },
    jobs: 14,
    harvests: 'ore',
    // Ore, not iron. A mine digs rock out of the ground; turning it into metal
    // is somebody else's building, and making that somebody else exist is the
    // whole point of the chain.
    produces: { resource: 'ore', rate: 0.0075 },
  },

  // ---- Civic -------------------------------------------------------------
  {
    id: 'well',
    name: 'Well',
    family: 'civic',
    width: 4,
    depth: 4,
    emissions: [{ character: 'rustic', strength: 0.25, radius: 40 }],
    cost: { stone: 12 },
    serves: ['water'],
  },
  {
    id: 'church',
    name: 'Church',
    family: 'civic',
    width: 16,
    depth: 26,
    emissions: [{ character: 'devout', strength: 1.7, radius: 130 }],
    cost: { timber: 30, stone: 90, tools: 12 },
    serves: ['faith'],
  },
  {
    id: 'chapel',
    name: 'Chapel',
    family: 'civic',
    width: 9,
    depth: 13,
    emissions: [{ character: 'devout', strength: 0.7, radius: 60 }],
    cost: { timber: 16, stone: 34 },
    serves: ['faith'],
  },
  {
    id: 'almshouse',
    name: 'Almshouse',
    family: 'civic',
    width: 14,
    depth: 9,
    emissions: [{ character: 'devout', strength: 0.5, radius: 55 }],
    cost: { timber: 18, stone: 20 },
  },
  {
    id: 'tavern',
    name: 'Tavern',
    family: 'civic',
    width: 12,
    depth: 10,
    emissions: [{ character: 'raucous', strength: 1.4, radius: 95 }],
    cost: { timber: 20, stone: 12 },
    serves: ['ale'],
  },
  {
    id: 'alehouse',
    name: 'Alehouse',
    family: 'civic',
    width: 9,
    depth: 8,
    emissions: [{ character: 'raucous', strength: 0.7, radius: 60 }],
    cost: { timber: 12, stone: 7 },
    serves: ['ale'],
  },
  {
    id: 'guildhall',
    name: 'Guildhall',
    family: 'civic',
    width: 18,
    depth: 13,
    emissions: [
      { character: 'mercantile', strength: 1.1, radius: 100 },
      { character: 'devout', strength: 0.2, radius: 40 },
    ],
    cost: { timber: 30, stone: 40, tools: 10 },
  },
  {
    id: 'green',
    name: 'Common Green',
    family: 'civic',
    width: 30,
    depth: 30,
    emissions: [{ character: 'verdant', strength: 1.4, radius: 120 }],
    cost: { timber: 2 },
  },
  {
    id: 'orchard',
    name: 'Orchard',
    family: 'civic',
    width: 26,
    depth: 22,
    emissions: [
      { character: 'verdant', strength: 1.0, radius: 90 },
      { character: 'rustic', strength: 0.5, radius: 70 },
    ],
    cost: { timber: 4 },
  },

  // ---- Military ----------------------------------------------------------
  //
  // Two sources, deliberately not a ladder: a watchtower is a cheap way to hold
  // a specific piece of ground, a keep is expensive, holds far more, and is the
  // only place a warband can be raised. Both eat forever (design/01 §2).
  {
    id: 'watchtower',
    name: 'Watchtower',
    family: 'military',
    width: 8,
    depth: 8,
    emissions: [{ character: 'martial', strength: 0.9, radius: 75 }],
    cost: { timber: 18, stone: 40, iron: 15, tools: 6 },
    garrison: { strength: 0.85, reach: 130, upkeep: 0.05 },
  },
  {
    id: 'keep',
    name: 'Keep',
    family: 'military',
    width: 20,
    depth: 20,
    emissions: [{ character: 'martial', strength: 1.8, radius: 140 }],
    cost: { timber: 45, stone: 130, iron: 60, tools: 20 },
    garrison: { strength: 1.5, reach: 235, upkeep: 0.16, musters: true },
  },

  // ---- Residential -------------------------------------------------------
  {
    id: 'cottage',
    name: 'Cottage',
    family: 'residential',
    width: 8,
    depth: 7,
    emissions: [],
    cost: { timber: 10, stone: 4 },
    evolvesTo: {
      industrious: 'terrace',
      mercantile: 'merchant_house',
      devout: 'close_cottage',
      rustic: 'farmhouse',
      raucous: 'lodging_house',
      verdant: 'garden_cottage',
      martial: 'barrack_row',
    },
    houses: 3,
  },
  {
    id: 'barrack_row',
    name: 'Barrack Row',
    family: 'residential',
    width: 22,
    depth: 8,
    isEvolved: true,
    emissions: [{ character: 'martial', strength: 0.3, radius: 40 }],
    houses: 8,
  },
  {
    id: 'terrace',
    name: "Workers' Terrace",
    family: 'residential',
    width: 20,
    depth: 8,
    isEvolved: true,
    emissions: [{ character: 'industrious', strength: 0.3, radius: 40 }],
    houses: 8,
  },
  {
    id: 'merchant_house',
    name: 'Merchant House',
    family: 'residential',
    width: 11,
    depth: 10,
    isEvolved: true,
    emissions: [{ character: 'mercantile', strength: 0.3, radius: 40 }],
    houses: 4,
  },
  {
    id: 'close_cottage',
    name: 'Close Cottage',
    family: 'residential',
    width: 9,
    depth: 8,
    isEvolved: true,
    emissions: [{ character: 'devout', strength: 0.2, radius: 35 }],
    houses: 3,
  },
  {
    id: 'farmhouse',
    name: 'Farmhouse',
    family: 'residential',
    width: 13,
    depth: 11,
    isEvolved: true,
    emissions: [{ character: 'rustic', strength: 0.3, radius: 45 }],
    houses: 4,
  },
  {
    id: 'lodging_house',
    name: 'Lodging House',
    family: 'residential',
    width: 11,
    depth: 9,
    isEvolved: true,
    emissions: [{ character: 'raucous', strength: 0.3, radius: 40 }],
    houses: 7,
  },
  {
    id: 'garden_cottage',
    name: 'Garden Cottage',
    family: 'residential',
    width: 10,
    depth: 9,
    isEvolved: true,
    emissions: [{ character: 'verdant', strength: 0.3, radius: 45 }],
    houses: 3,
  },
];

const BY_ID = new Map(TYPES.map((t) => [t.id, t]));

export function buildingType(id: string): BuildingType {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown building type: ${id}`);
  return t;
}

export function allBuildingTypes(): readonly BuildingType[] {
  return TYPES;
}

/** Types the player can place directly. Evolved housing is grown, never placed. */
export function placeableTypes(): readonly BuildingType[] {
  return TYPES.filter((t) => !t.isEvolved);
}
