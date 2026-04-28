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
import { parseUnitAddress } from '@/lib/unitAddress';

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

// Extract structured city/state/zip from a unit-directory raw address
// for searching and display in the UnitLookupModal.
//
// Delegates to the canonical `parseUnitAddress` helper (single source of
// truth for the parse logic) after flattening the unit-directory's
// `\n`-separated form to the comma-separated form that the helper
// expects.
//
// The previous local `parseAddress` required a comma between city and
// state, which only matched 212/3140 units (6.7%) — the other 93% had
// space-separated city/state in `units.json` and ended up with empty
// city/state/zip in their UnitInfo, breaking search-by-city/state.
// `parseUnitAddress` accepts both separators, fixing this transparently.
function extractCityStateZip(rawAddress: string): { city: string; state: string; zip: string } {
  const flat = (rawAddress || '').replace(/\n/g, ', ');
  const parts = parseUnitAddress(flat);
  return { city: parts.city, state: parts.state, zip: parts.zip };
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
      const parsed = extractCityStateZip(unit.address || '');
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
