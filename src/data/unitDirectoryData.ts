/**
 * Lazy loader for the 852 KB units.json database.
 *
 * Eagerly importing units.json adds ~850 KB of JSON-parse work to every cold
 * start (the data was historically used only in `UnitLookupModal`, which most
 * users never open). This module hides the import behind a dynamic `import()`
 * so the chunk is fetched + parsed only when something actually calls
 * `loadUnitDirectory()`.
 *
 * The promise is cached, so repeated calls (e.g. user opens the modal,
 * closes it, opens it again) reuse the same Promise without refetching.
 *
 * Pure-format helpers that operate on a `UnitInfo` argument (e.g.
 * `formatLetterhead`, `expandUnitName`, `formatUnitAddress`) live in the
 * sync `unitDirectory.ts` module — they don't need the JSON.
 */

import type { UnitInfo, UnitCategory } from './unitDirectory';

interface UnitsJsonShape {
  units: Array<{
    name: string;
    abbrev?: string;
    parentUnit?: string;
    mcc?: string;
    address?: string;
    type?: string;
    service?: string;
  }>;
  source: string;
  version: string;
  lastUpdated: string;
}

export interface UnitDirectoryDatabase {
  ALL_UNITS: UnitInfo[];
  UNIT_CATEGORIES: UnitCategory[];
  UNIT_DATABASE_INFO: {
    source: string;
    version: string;
    lastUpdated: string;
    totalUnits: number;
  };
}

// Parse "STREET\nCITY, STATE ZIP" into structured fields.
function parseAddress(address: string): { street: string; city: string; state: string; zip: string } {
  const lines = address.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  const street = lines.slice(0, -1).join(', ') || lines[0] || '';

  const match = lastLine.match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (match) {
    return {
      street: street || lastLine,
      city: match[1].trim(),
      state: match[2],
      zip: match[3],
    };
  }

  return {
    street: address.replace(/\n/g, ', '),
    city: '',
    state: '',
    zip: '',
  };
}

// Display labels for unit-type buckets in the accordion view.
const typeLabels: Record<string, string> = {
  'headquarters': 'Headquarters & Staff',
  'mef': 'Marine Expeditionary Forces',
  'meu': 'Marine Expeditionary Units',
  'division': 'Marine Divisions',
  'wing': 'Marine Aircraft Wings',
  'mlg': 'Marine Logistics Groups',
  'regiment': 'Regiments',
  'battalion': 'Battalions',
  'company': 'Companies',
  'detachment': 'Detachments',
  'squadron': 'Squadrons',
  'group': 'Groups',
  'base': 'Installations & Bases',
  'depot': 'Depots',
  'school': 'Schools & Universities',
  'training': 'Training Commands',
  'special': 'Special Units',
  'unit': 'Other Units',
};

function createCategories(units: UnitInfo[]): UnitCategory[] {
  const categoryMap = new Map<string, UnitInfo[]>();

  units.forEach((unit) => {
    const type = unit.type || 'other';
    if (!categoryMap.has(type)) {
      categoryMap.set(type, []);
    }
    categoryMap.get(type)!.push(unit);
  });

  const orderedTypes = Object.keys(typeLabels);
  const categories: UnitCategory[] = [];

  orderedTypes.forEach((type) => {
    const typeUnits = categoryMap.get(type);
    if (typeUnits && typeUnits.length > 0) {
      categories.push({
        name: typeLabels[type] || type,
        units: typeUnits.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  });

  // Append any types not in the predefined order.
  categoryMap.forEach((typeUnits, type) => {
    if (!orderedTypes.includes(type) && typeUnits.length > 0) {
      categories.push({
        name: typeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1),
        units: typeUnits.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  });

  return categories;
}

let cachedDatabase: Promise<UnitDirectoryDatabase> | null = null;

/**
 * Fetch + parse the unit directory.
 *
 * Returns a memoized Promise — callers that race on app start (or that
 * open the modal multiple times) all see the same Promise and don't
 * trigger duplicate fetches/parses.
 */
export function loadUnitDirectory(): Promise<UnitDirectoryDatabase> {
  if (cachedDatabase) {
    return cachedDatabase;
  }

  cachedDatabase = import('./units.json').then((mod) => {
    const unitsData = (mod.default ?? mod) as UnitsJsonShape;

    const allUnits: UnitInfo[] = unitsData.units.map((unit) => {
      const parsed = parseAddress(unit.address || '');
      return {
        name: unit.name,
        abbrev: unit.abbrev,
        parentUnit: unit.parentUnit,
        mcc: unit.mcc,
        address: unit.address || '',
        type: unit.type,
        service: unit.service,
        fullName: unit.name,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
      };
    });

    return {
      ALL_UNITS: allUnits,
      UNIT_CATEGORIES: createCategories(allUnits),
      UNIT_DATABASE_INFO: {
        source: unitsData.source,
        version: unitsData.version,
        lastUpdated: unitsData.lastUpdated,
        totalUnits: allUnits.length,
      },
    };
  });

  // If the import or parse fails, clear the cache so a future call retries
  // instead of permanently returning a rejected Promise.
  cachedDatabase.catch(() => {
    cachedDatabase = null;
  });

  return cachedDatabase;
}
