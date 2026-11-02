import { SL4_NSN_PATTERN, type Sl4Part, type Sl4Row } from '@/data/techpub/sl4';

interface Occurrence {
  rowId: string;
  itemNumber: number;
  combinationId: string;
  firstInCombinationId: string;
  firstInListId: string;
}

const key = (value: string) => value.trim().toUpperCase();
const identityKeys = (part: Sl4Part): string[] => [
  ...(part.partNumber.trim() && part.cage.trim() ? [JSON.stringify(['part', key(part.partNumber), key(part.cage)])] : []),
  ...(SL4_NSN_PATTERN.test(part.nsn.trim()) ? [JSON.stringify(['nsn', part.nsn.trim().replaceAll('-', '')])] : []),
];

/** Preface 11: S/A is scoped to a major combination; 14(b): totals to the list. */
export function sl4Occurrences(rows: readonly Sl4Row[]) {
  const result = new Map<string, Occurrence>();
  const inList = new Map<string, string>(), inCombination = new Map<string, string>();
  let combinationId = '', itemNumber = 0;
  const earliest = (candidates: (string | undefined)[], fallback: string) =>
    candidates.filter((candidate): candidate is string => !!candidate)
      .reduce((first, candidate) => (result.get(candidate)?.itemNumber ?? Infinity) < (result.get(first)?.itemNumber ?? Infinity) ? candidate : first, fallback);
  for (const row of rows) {
    if (row.kind === 'heading' && row.majorCombination) combinationId = row.id;
    if (row.kind !== 'part') continue;
    const keys = identityKeys(row);
    const scopedKeys = keys.map((identity) => JSON.stringify([combinationId, identity]));
    const sameAs = row.relationship?.kind === 'same_as' ? result.get(row.relationship.itemIds[0]) : undefined;
    const firstInListId = earliest([...keys.map((identity) => inList.get(identity)), sameAs?.firstInListId], row.id);
    const firstInCombinationId = earliest([
      ...scopedKeys.map((identity) => inCombination.get(identity)),
      sameAs?.combinationId === combinationId ? sameAs.firstInCombinationId : undefined,
    ], row.id);
    result.set(row.id, { rowId: row.id, itemNumber: ++itemNumber, combinationId, firstInCombinationId, firstInListId });
    keys.forEach((identity) => { if (!inList.has(identity)) inList.set(identity, firstInListId); });
    scopedKeys.forEach((identity) => { if (!inCombination.has(identity)) inCombination.set(identity, firstInCombinationId); });
  }
  return result;
}
