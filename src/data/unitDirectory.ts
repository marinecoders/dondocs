// Marine Corps and Navy Unit Directory — types + format helpers.
//
// This module is intentionally JSON-free so it doesn't pull the 852 KB
// units.json into the main bundle. The actual unit database lives in
// `unitDirectoryData.ts` and is fetched lazily via `loadUnitDirectory()`
// (only when the user opens the unit-lookup modal).
//
// Helpers in this file all operate on a `UnitInfo` argument supplied by
// the caller, so they don't need access to the database.

export interface UnitInfo {
  name: string;
  abbrev?: string;
  parentUnit?: string;  // Higher command for letterhead line 2 (e.g., "1ST MARINE DIVISION")
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

// Format full address for display
export function formatUnitAddress(unit: UnitInfo): string {
  if (unit.city && unit.state && unit.zip) {
    return `${unit.city}, ${unit.state} ${unit.zip}`;
  }
  // Fallback to raw address, replacing newlines
  return unit.address.replace(/\n/g, ', ');
}

// Expand abbreviated unit names to proper letterhead format (SECNAV M-5216.5)
const UNIT_NAME_EXPANSIONS: [RegExp, string][] = [
  // Multi-word patterns first (order matters)
  [/\bMAR REGT\b/gi, 'MARINE REGIMENT'],
  [/\bMAR REG\b/gi, 'MARINE REGIMENT'],
  // Single-word abbreviations
  [/\bMARDIV\b/gi, 'MARINE DIVISION'],
  [/\bMAW\b/gi, 'MARINE AIRCRAFT WING'],
  [/\bMLG\b/gi, 'MARINE LOGISTICS GROUP'],
  [/\bMEF\b/gi, 'MARINE EXPEDITIONARY FORCE'],
  [/\bMEU\b/gi, 'MARINE EXPEDITIONARY UNIT'],
  [/\bMLR\b/gi, 'MARINE LITTORAL REGIMENT'],
  [/\bLCT\b/gi, 'LITTORAL COMBAT TEAM'],
  [/\bLLB\b/gi, 'LITTORAL LOGISTICS BATTALION'],
  [/\bHQTRS\b/gi, 'HEADQUARTERS'],
  [/\bREGT\b/gi, 'REGIMENT'],
  [/\bBTRY\b/gi, 'BATTERY'],
  [/\bDET\b/gi, 'DETACHMENT'],
  [/\bSVC\b/gi, 'SERVICE'],
  [/\bMAINT\b/gi, 'MAINTENANCE'],
  [/\bCOMM\b/gi, 'COMMUNICATIONS'],
  [/\bINTEL\b/gi, 'INTELLIGENCE'],
  [/\bRECON\b/gi, 'RECONNAISSANCE'],
  [/\bENGR\b/gi, 'ENGINEER'],
  [/\bARTY\b/gi, 'ARTILLERY'],
  [/\bAMPH\b/gi, 'AMPHIBIOUS'],
  [/\bAVN\b/gi, 'AVIATION'],
  [/\bTRANS\b/gi, 'TRANSPORTATION'],
  [/\bMED\b/gi, 'MEDICAL'],
  [/\bSUP\b/gi, 'SUPPLY'],
  [/\bORD\b/gi, 'ORDNANCE'],
  [/\bMP\b/gi, 'MILITARY POLICE'],
];

// Expand unit name abbreviations for proper letterhead display
export function expandUnitName(name: string): string {
  let expanded = name;
  for (const [pattern, replacement] of UNIT_NAME_EXPANSIONS) {
    expanded = expanded.replace(pattern, replacement);
  }
  return expanded;
}

// Format for letterhead (SECNAV M-5216.5 compliant)
// Line 1: Unit name (full, expanded)
// Line 2: Parent/higher command (e.g., "1ST MARINE DIVISION")
// Line 3: Address (Street/Box/PSC, City, State ZIP)
export function formatLetterhead(unit: UnitInfo): { line1: string; line2: string; address: string } {
  return {
    line1: expandUnitName(unit.name),
    line2: unit.parentUnit ? expandUnitName(unit.parentUnit) : '',
    address: unit.address.replace(/\n/g, ', '),
  };
}

// Re-export the lazy loader so callers can import from one place.
export { loadUnitDirectory, type UnitDirectoryDatabase } from './unitDirectoryData';
