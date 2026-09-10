/**
 * Search the bundled unit directory for a letterhead block.
 *
 * Matching is AND across whitespace-separated terms over the recorded name,
 * abbreviation, MCC, address and parent unit. No alias expansion. `total` is the
 * count before `limit` is applied, so `truncated` tells a caller to narrow.
 */
import { formatLetterhead, loadUnitDirectory } from '../src/data/unitDirectory';

export async function lookupUnits(query: string, limit = 20) {
  const database = await loadUnitDirectory();
  const normalized = query.trim().toUpperCase();
  const terms = normalized.split(/\s+/);
  const matches = normalized ? database.ALL_UNITS.filter((unit) => {
    const searchable = [unit.name, unit.abbrev, unit.mcc, unit.address, unit.parentUnit]
      .join(' ').toUpperCase();
    return terms.every((term) => searchable.includes(term));
  }).sort((a, b) => Number(b.mcc === normalized) - Number(a.mcc === normalized)) : [];

  return {
    source: database.UNIT_DATABASE_INFO.source,
    lastUpdated: database.UNIT_DATABASE_INFO.lastUpdated,
    total: matches.length,
    truncated: matches.length > limit,
    matches: matches.slice(0, limit).map((record) => {
      const letterhead = formatLetterhead(record);
      const service = record.service?.toUpperCase();
      return {
        mcc: record.mcc ?? null,
        unit: {
          name: letterhead.line1,
          line2: letterhead.line2,
          address: letterhead.address,
          ...(service === 'USMC' ? { department: 'usmc' as const }
            : service === 'USN' || service === 'NAVY' ? { department: 'navy' as const } : {}),
        },
      };
    }),
  };
}
