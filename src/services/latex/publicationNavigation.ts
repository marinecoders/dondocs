import { calculateLabels } from './paragraphLabels';
import type { Paragraph, PublicationTableRow } from '@/types/document';
import { escapeLatex } from './escaper';

export interface PublicationDestination {
  id: string;
  title: string;
  children: number;
  depth: number;
}

/** Use the same figure/table counters as the printed publication. */
export function publicationNavigation(paragraphs: Paragraph[], tables: Record<string, PublicationTableRow[]> = {}, headingCase = (title: string) => title): Map<string, PublicationDestination> {
  const entries: PublicationDestination[] = [];
  const labels = calculateLabels(paragraphs, true, false);
  let appendix = '';
  let appendixCount = 0;
  let figure = 0;
  let table = 0;
  let headingDepth = -1;
  const add = (id: string, title: string, depth: number) => entries.push({ id, title, depth, children: 0 });
  paragraphs.forEach((p, i) => {
    if (p.appendix) {
      appendix = String.fromCharCode(65 + appendixCount++);
      figure = 0;
      table = 0;
      headingDepth = 0;
      add(`itype.p.${i}`, `APPENDIX ${appendix}: ${(p.header ?? '').toUpperCase()}`, 0);
    } else if (p.figure) {
      add(`itype.figure.${i}`, `Figure ${appendix ? appendix + '-' : ''}${++figure}. ${p.text.trim().replace(/\.$/, '')}`, headingDepth + 1);
    } else if (!p.callout && p.header?.trim()) {
      headingDepth = p.level + (appendix ? 1 : 0);
      add(`itype.p.${i}`, `${labels[i]} ${headingCase(p.header.trim().replace(/\.$/, ''))}`, headingDepth);
    }
    if (p.tableKey && tables[p.tableKey]?.length) {
      add(`itype.table.${i}`, `Table ${appendix ? appendix + '-' : ''}${++table}. ${p.header?.trim().replace(/\.$/, '') ?? ''}`, headingDepth + 1);
    }
  });
  const parents: PublicationDestination[] = [];
  for (const entry of entries) {
    while (parents.length && parents[parents.length - 1].depth >= entry.depth) parents.pop();
    if (parents.length) parents[parents.length - 1].children++;
    parents.push(entry);
  }
  return new Map(entries.map((entry) => [entry.id, entry]));
}

export function navigationTex(entry: PublicationDestination | undefined): string {
  return entry ? `\\dondocsBookmark{${-entry.children}}{${escapeLatex(entry.title)}}{${entry.id}}\n` : '';
}
