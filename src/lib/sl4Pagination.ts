import type { Sl4Row } from '@/data/techpub/sl4';
import { sl4HierarchyFindings } from './sl4Validation';

/**
 * Source instructions: at most eighteen body rows, including headings/blanks.
 * Keep a parent and the start of its c/o group on the same sheet. This is a
 * row-count plan; the PDF renderer must also measure actual text/figure height.
 */
export function paginateSl4Rows(rows: readonly Sl4Row[], capacity = 18): Sl4Row[][] {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 18)
    throw new Error('SL-4 sheets require a capacity between one and eighteen rows.');
  if (sl4HierarchyFindings(rows).length)
    throw new Error('Correct the SL-4 row hierarchy before planning sheets.');
  const parentIds = new Set(rows.flatMap((row) => row.kind === 'part' && row.parentId ? [row.parentId] : []));
  const pages: Sl4Row[][] = [];
  for (let start = 0; start < rows.length;) {
    let end = Math.min(start + capacity, rows.length);
    while (end < rows.length && end > start) {
      // Trailing headings/blanks must not hide a parent at the sheet boundary.
      let last = end - 1;
      while (last >= start && rows[last].kind === 'blank') last--;
      if (last < start) break;
      const row = rows[last];
      const next = rows.slice(end).find((candidate) => candidate.kind === 'part');
      if (row.kind === 'heading' || (row.kind === 'part' && parentIds.has(row.id) && next?.kind === 'part' && next.parentId === row.id))
        end = last;
      else break;
    }
    if (end === start)
      throw new Error('The heading/parent and first component cannot fit on one SL-4 sheet at this row capacity.');
    pages.push(rows.slice(start, end));
    start = end;
  }
  return pages;
}
