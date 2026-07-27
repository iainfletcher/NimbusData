import type { BuildingType } from './types';

/**
 * MVP catalogue (design/06 §3). Medieval era only, six characters, three families.
 *
 * The military family is deliberately absent: it would need a seventh character
 * (martial) that nothing else in the MVP reads, and territory is out of scope.
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
  },
  {
    id: 'tannery',
    name: 'Tannery',
    family: 'economic',
    width: 14,
    depth: 12,
    emissions: [{ character: 'industrious', strength: 1.2, radius: 90 }],
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
  },
  {
    id: 'workshop',
    name: 'Workshop',
    family: 'economic',
    width: 10,
    depth: 9,
    emissions: [{ character: 'industrious', strength: 0.5, radius: 45 }],
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
  },
  {
    id: 'warehouse',
    name: 'Warehouse',
    family: 'economic',
    width: 16,
    depth: 12,
    emissions: [{ character: 'mercantile', strength: 0.8, radius: 70 }],
  },
  {
    id: 'watermill',
    name: 'Watermill',
    family: 'economic',
    width: 12,
    depth: 10,
    emissions: [{ character: 'rustic', strength: 1.0, radius: 80 }],
  },
  {
    id: 'farm',
    name: 'Farmstead',
    family: 'economic',
    width: 18,
    depth: 14,
    emissions: [{ character: 'rustic', strength: 1.3, radius: 110 }],
  },

  // ---- Civic -------------------------------------------------------------
  {
    id: 'church',
    name: 'Church',
    family: 'civic',
    width: 16,
    depth: 26,
    emissions: [{ character: 'devout', strength: 1.7, radius: 130 }],
  },
  {
    id: 'chapel',
    name: 'Chapel',
    family: 'civic',
    width: 9,
    depth: 13,
    emissions: [{ character: 'devout', strength: 0.7, radius: 60 }],
  },
  {
    id: 'almshouse',
    name: 'Almshouse',
    family: 'civic',
    width: 14,
    depth: 9,
    emissions: [{ character: 'devout', strength: 0.5, radius: 55 }],
  },
  {
    id: 'tavern',
    name: 'Tavern',
    family: 'civic',
    width: 12,
    depth: 10,
    emissions: [{ character: 'raucous', strength: 1.4, radius: 95 }],
  },
  {
    id: 'alehouse',
    name: 'Alehouse',
    family: 'civic',
    width: 9,
    depth: 8,
    emissions: [{ character: 'raucous', strength: 0.7, radius: 60 }],
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
  },
  {
    id: 'green',
    name: 'Common Green',
    family: 'civic',
    width: 30,
    depth: 30,
    emissions: [{ character: 'verdant', strength: 1.4, radius: 120 }],
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
  },

  // ---- Residential -------------------------------------------------------
  {
    id: 'cottage',
    name: 'Cottage',
    family: 'residential',
    width: 8,
    depth: 7,
    emissions: [],
    evolvesTo: {
      industrious: 'terrace',
      mercantile: 'merchant_house',
      devout: 'close_cottage',
      rustic: 'farmhouse',
      raucous: 'lodging_house',
      verdant: 'garden_cottage',
    },
  },
  {
    id: 'terrace',
    name: "Workers' Terrace",
    family: 'residential',
    width: 20,
    depth: 8,
    isEvolved: true,
    emissions: [{ character: 'industrious', strength: 0.3, radius: 40 }],
  },
  {
    id: 'merchant_house',
    name: 'Merchant House',
    family: 'residential',
    width: 11,
    depth: 10,
    isEvolved: true,
    emissions: [{ character: 'mercantile', strength: 0.3, radius: 40 }],
  },
  {
    id: 'close_cottage',
    name: 'Close Cottage',
    family: 'residential',
    width: 9,
    depth: 8,
    isEvolved: true,
    emissions: [{ character: 'devout', strength: 0.2, radius: 35 }],
  },
  {
    id: 'farmhouse',
    name: 'Farmhouse',
    family: 'residential',
    width: 13,
    depth: 11,
    isEvolved: true,
    emissions: [{ character: 'rustic', strength: 0.3, radius: 45 }],
  },
  {
    id: 'lodging_house',
    name: 'Lodging House',
    family: 'residential',
    width: 11,
    depth: 9,
    isEvolved: true,
    emissions: [{ character: 'raucous', strength: 0.3, radius: 40 }],
  },
  {
    id: 'garden_cottage',
    name: 'Garden Cottage',
    family: 'residential',
    width: 10,
    depth: 9,
    isEvolved: true,
    emissions: [{ character: 'verdant', strength: 0.3, radius: 45 }],
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
