import { sl4Schema, type Sl4Data, type Sl4Row } from '@/data/techpub/sl4';
import { sl4HierarchyFindings } from './sl4Validation';
import { sl4Occurrences } from './sl4Occurrences';

function descendants(rows: Sl4Row[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (row.kind === 'part' && ids.has(row.parentId) && !ids.has(row.id)) { ids.add(row.id); changed = true; }
  }
  return ids;
}
function span(rows: Sl4Row[], id: string): [number, number] {
  const start = rows.findIndex((row) => row.id === id), row = rows[start];
  if (!row) return [-1, -1];
  if (row.kind === 'heading' && row.majorCombination) {
    const next = rows.findIndex((candidate, i) => i > start && candidate.kind === 'heading' && candidate.majorCombination);
    return [start, next < 0 ? rows.length : next];
  }
  const ids = descendants(rows, id);
  return [start, rows.reduce((end, candidate, i) => ids.has(candidate.id) ? i + 1 : end, start + 1)];
}
export function moveSl4Group(data: Sl4Data, id: string, direction: -1 | 1): Sl4Row[] {
  const rows = data.rows, selected = rows.find((row) => row.id === id);
  if (!selected) return rows;
  const contexts = sl4Occurrences(rows);
  const siblings = rows.filter((row) => selected.kind === 'part'
    ? row.kind === 'part' && row.parentId === selected.parentId && contexts.get(row.id)?.combinationId === contexts.get(id)?.combinationId
    : selected.kind === 'heading' && selected.majorCombination ? row.kind === 'heading' && row.majorCombination : true);
  const target = siblings[siblings.indexOf(selected) + direction];
  if (!target) return rows;
  const [start, end] = span(rows, id), [targetStart, targetEnd] = span(rows, target.id);
  if (targetStart >= start && targetStart < end || start >= targetStart && start < targetEnd) return rows;
  const moved = rows.slice(start, end), rest = rows.filter((_, i) => i < start || i >= end);
  const at = direction < 0 ? rest.findIndex((row) => row.id === target.id) : span(rest, target.id)[1];
  rest.splice(at, 0, ...moved);
  return sl4HierarchyFindings(rest).length ? rows : rest;
}
export function assignSl4Parent(data: Sl4Data, id: string, parentId: string): Sl4Row[] {
  const rows = data.rows, selected = rows.find((row) => row.id === id);
  if (selected?.kind !== 'part') return rows;
  const ids = descendants(rows, id), parent = rows.find((row) => row.id === parentId);
  const contexts = sl4Occurrences(rows);
  if (parentId && (parent?.kind !== 'part' || ids.has(parentId) || contexts.get(parentId)?.combinationId !== contexts.get(id)?.combinationId)) return rows;
  let root = selected;
  const seen = new Set<string>();
  while (root.parentId && !seen.has(root.id)) {
    seen.add(root.id);
    const next = rows.find((row) => row.id === root.parentId);
    if (next?.kind !== 'part') break;
    root = next;
  }
  const [start, end] = span(rows, id), moved = rows.slice(start, end).map((row) => row.id === id ? { ...row, parentId } : row);
  const rest = rows.filter((_, i) => i < start || i >= end);
  const anchor = parentId || (root.id !== id ? root.id : '');
  const at = anchor ? span(rest, anchor)[1] : start;
  rest.splice(Math.max(0, at), 0, ...moved);
  return sl4HierarchyFindings(rest).length ? rows : rest;
}
/** Caller confirms the subtree and referenced-item changes before applying. */
export function deleteSl4Group(data: Sl4Data, id: string): Sl4Row[] {
  const [start, end] = span(data.rows, id);
  if (start < 0) return data.rows;
  const removed = new Set(data.rows.slice(start, end).map((row) => row.id));
  return data.rows.filter((row) => !removed.has(row.id)).map((row) => {
    if (row.kind !== 'part' || !row.relationship) return row;
    const itemIds = row.relationship.itemIds.filter((itemId) => !removed.has(itemId));
    return { ...row, relationship: itemIds.length ? { ...row.relationship, itemIds } : undefined };
  });
}

/** Batch substitutions change authored content, never stable relationship/asset IDs. */
export function mapSl4Text(data: Sl4Data, replace: (value: string) => string): Sl4Data {
  const stable = new Set(['id', 'parentId', 'figureId', 'endItemFigureId', 'itemIds', 'kind', 'mode', 'portionMarking', 'contextPortion', 'lettering']);
  const visit = (value: unknown, key = ''): unknown => {
    if (stable.has(key)) return value;
    if (typeof value === 'string') return replace(value);
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([child, entry]) => [child, visit(entry, child)]));
    return value;
  };
  return sl4Schema.parse(visit(data));
}
