// Marine Corps and Navy Unit Directory Reference Data
// Merged from MCC/RUC List, SNDL, naval-letter-formatter, and competitor databases

import unitsData from './units.json';

export interface UnitInfo {
  name: string;
  abbrev?: string;
  mcc?: string;
  address: string;
  type?: string;
  service?: string;
  // Computed fields for display
  fullName?: string;
  city?: string;
  state?: string;
  zip?: string;
  region?: string;
}

export interface UnitCategory {
  name: string;
  units: UnitInfo[];
}

// Parse address to extract city, state, zip
function parseAddress(address: string): { street: string; city: string; state: string; zip: string } {
  const lines = address.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  const street = lines.slice(0, -1).join(', ') || lines[0] || '';

  // Try to parse "CITY, STATE ZIP" format
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

// Convert JSON units to UnitInfo format
const allUnits: UnitInfo[] = (unitsData.units as any[]).map((unit) => {
  const parsed = parseAddress(unit.address || '');
  return {
    name: unit.name,
    abbrev: unit.abbrev,
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

// Group units by type for accordion view
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

// Create categories from units
function createCategories(units: UnitInfo[]): UnitCategory[] {
  const categoryMap = new Map<string, UnitInfo[]>();

  units.forEach((unit) => {
    const type = unit.type || 'other';
    if (!categoryMap.has(type)) {
      categoryMap.set(type, []);
    }
    categoryMap.get(type)!.push(unit);
  });

  // Sort categories by predefined order
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

  // Add any remaining types not in our predefined list
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

export const UNIT_CATEGORIES: UnitCategory[] = createCategories(allUnits);

// Flatten all units for easy searching
export const ALL_UNITS: UnitInfo[] = allUnits;

// Format full address for display
export function formatUnitAddress(unit: UnitInfo): string {
  if (unit.city && unit.state && unit.zip) {
    return `${unit.city}, ${unit.state} ${unit.zip}`;
  }
  // Fallback to raw address, replacing newlines
  return unit.address.replace(/\n/g, ', ');
}

// Format for letterhead
export function formatLetterhead(unit: UnitInfo): { line1: string; line2: string; address: string } {
  const parsed = parseAddress(unit.address);
  return {
    line1: unit.name,
    line2: unit.abbrev || '',
    address: unit.address.replace(/\n/g, ', '),
  };
}

// Export metadata
export const UNIT_DATABASE_INFO = {
  source: unitsData.source,
  version: unitsData.version,
  lastUpdated: unitsData.lastUpdated,
  totalUnits: allUnits.length,
};
