import type { PublicationTableRow } from '@/types/document';

/** "The items should be listed in numeric order by ID No." — the Major Items
 *  Affected table, per the MARCORSYSCOM template. Advisory. */
export function validateMajorItemsOrder(rows: PublicationTableRow[]): { severity: 'warning'; message: string }[] {
  const ids = rows.map((r) => (r.values.id ?? '').trim()).filter(Boolean);
  for (let i = 1; i < ids.length; i++) {
    if (ids[i - 1].localeCompare(ids[i], undefined, { numeric: true }) > 0) {
      return [{ severity: 'warning', message: 'Major Items Affected are listed in numeric order by I.D. No.; reorder the rows.' }];
    }
  }
  return [];
}
