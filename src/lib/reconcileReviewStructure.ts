import type { SerializedSession } from '@/stores/documentStore';
import { outlineParagraphs } from '@/services/latex/paragraphLabel';
import { canonicalReviewPayload } from './reviewRounds';
import { applyReviewStructure, assertReviewStructureOperation, captureReviewStructure, structureSuggestionText, type ReviewStructureTarget } from './reviewStructureSuggestions';

export type StructureReconciliationKind = 'unchanged' | 'independent' | 'delete-vs-edit' | 'split-join-overlap' | 'competing-move' | 'missing-target' | 'changed-parent-boundary';
export interface ReviewStructureReconciliation {
  kind: StructureReconciliationKind; baseline: string; current: string; proposed: string;
  target?: ReviewStructureTarget; canResolve: boolean;
}
const same = (a: unknown, b: unknown) => canonicalReviewPayload(a) === canonicalReviewPayload(b);
function parent(source: SerializedSession, id: string): string | null | undefined {
  const index = source.paragraphs.findIndex(p => p.id === id);
  if (index < 0) return undefined;
  const at = outlineParagraphs(source.paragraphs.map(p => p.level))[index].parentIndex;
  return at === null ? null : source.paragraphs[at].id;
}
/** Rebuild immutable intent from current identities. A supplied split boundary
 * is a human decision; no offset is inferred from changed text. */
export function captureReconciledReviewStructure(source: SerializedSession, original: ReviewStructureTarget, splitAt?: number): ReviewStructureTarget {
  const op = original.operation;
  let target: ReviewStructureTarget;
  if (op.kind === 'insert-paragraph') {
    const index = op.gap.before ? source.paragraphs.findIndex(p => p.id === op.gap.before!.id) + 1 : 0;
    const right = source.paragraphs[index];
    if (op.gap.before && index === 0 || (op.gap.after ? right?.id !== op.gap.after.id : !!right)) throw new Error('The insertion boundary changed. Keep current work and create a new proposal.');
    const node = op.after[0];
    target = captureReviewStructure(source, { kind: op.kind, index, text: node.text, level: node.level, paragraphId: node.id });
  } else if (op.kind === 'move-paragraph') target = captureReviewStructure(source, { kind: op.kind, paragraphId: op.paragraphId, destinationId: op.destinationId, placement: op.placement });
  else if (op.kind === 'split-paragraph') target = captureReviewStructure(source, { kind: op.kind, paragraphId: op.before[0].id, splitAt: splitAt ?? op.splitAt, newParagraphId: op.after[1].id });
  else if (op.kind === 'join-paragraphs') target = captureReviewStructure(source, { kind: op.kind, paragraphId: op.before[0].id, nextParagraphId: op.before[1].id, separator: op.separator });
  else target = captureReviewStructure(source, { kind: op.kind, paragraphId: op.before[0].id });
  if (target.docType !== original.docType || target.operation.parentId !== op.parentId) throw new Error('The captured parent changed. Keep current work and create a new proposal.');
  for (const node of op.before) if (parent(source, node.id) === undefined) throw new Error('An original paragraph is missing. It cannot be retargeted.');
  if (op.kind === 'move-paragraph') {
    const originalParents = outlineParagraphs(op.before.map(p => p.level));
    for (let i = 0; i < op.before.length; i++) {
      const node = op.before[i], current = source.paragraphs.find(p => p.id === node.id)!;
      const pi = originalParents[i].parentIndex;
      if (current.level !== node.level || parent(source, node.id) !== (pi === null ? op.parentId : op.before[pi].id)) throw new Error('A moved subtree parent or level changed.');
    }
  } else for (const node of op.before) if (parent(source, node.id) !== op.parentId || source.paragraphs.find(p => p.id === node.id)?.level !== node.level) throw new Error('The captured paragraph parent changed.');
  return target;
}
/** Exact node identity and full values decide independence. Readable text never
 * authorizes a write and a proposal after-array never replaces newer nodes. */
export function inspectReviewStructureReconciliation(source: SerializedSession, original: ReviewStructureTarget): ReviewStructureReconciliation {
  const op = original.operation;
  const affectedIds = new Set(op.before.map(p => p.id));
  const currentNodes = source.paragraphs.filter(p => p.id !== undefined && affectedIds.has(p.id));
  const result = (kind: StructureReconciliationKind, target?: ReviewStructureTarget, canResolve = !!target): ReviewStructureReconciliation => ({ kind,
    baseline: structureSuggestionText(op.before), current: structureSuggestionText(currentNodes), proposed: structureSuggestionText(target?.operation.after ?? op.after), ...(target ? { target } : {}), canResolve });
  if (source.docType !== original.docType || new Set(source.paragraphs.map(p => p.id)).size !== source.paragraphs.length) return result('changed-parent-boundary');
  if (op.before.some(p => !source.paragraphs.some(current => current.id === p.id))) return result('missing-target');
  try { applyReviewStructure(source, original); return result('unchanged', original); } catch { /* Inspect current intent below. */ }
  let target: ReviewStructureTarget;
  try { target = captureReconciledReviewStructure(source, original); }
  catch {
    if (op.kind === 'split-paragraph' && parent(source, op.before[0].id) === op.parentId
      && source.paragraphs.find(p => p.id === op.before[0].id)?.level === op.before[0].level) return result('split-join-overlap', undefined, true);
    return result('changed-parent-boundary');
  }
  if (op.kind === 'delete-paragraph' && !same(target.operation.before, op.before)) return result('delete-vs-edit', target);
  if ((op.kind === 'split-paragraph' || op.kind === 'join-paragraphs') && !same(target.operation.before, op.before)) return result('split-join-overlap', target);
  if (op.kind === 'move-paragraph') {
    const originalIds = new Set(op.before.map(p => p.id));
    const currentOrder = target.operation.before.filter(p => originalIds.has(p.id)).map(p => p.id);
    if (!same(currentOrder, op.before.map(p => p.id))) return result('competing-move', target);
  }
  return result('independent', target);
}
/** Recompute exact current scope; only an explicit current split point can
 * replace an original parameter. All other identities and intent are fixed. */
export function validateReconciledReviewStructure(source: SerializedSession, original: ReviewStructureTarget, resolved: ReviewStructureTarget): ReviewStructureTarget {
  const inspection = inspectReviewStructureReconciliation(source, original);
  if (!inspection.canResolve) throw new Error('This structural conflict requires a new proposal.');
  const splitAt = resolved.operation.kind === 'split-paragraph' ? resolved.operation.splitAt : undefined;
  const derived = captureReconciledReviewStructure(source, original, splitAt);
  if (!same(derived, resolved)) throw new Error('The resolution must retain the exact current nodes and original structural intent.');
  return derived;
}

/** Durable decisions must retain one proven native operation, never a hidden
 * edit or a different target disguised as the reviewed intent. */
export function assertStoredStructuralResolution(original: ReviewStructureTarget, resolved: ReviewStructureTarget): void {
  const a = original.operation, b = resolved.operation;
  if (original.docType !== resolved.docType || a.kind !== b.kind || a.parentId !== b.parentId) throw new Error('Structural resolution changed its intent.');
  assertReviewStructureOperation(resolved);
  if (a.kind === 'move-paragraph' && b.kind === 'move-paragraph') {
    if (a.paragraphId !== b.paragraphId || a.destinationId !== b.destinationId || a.placement !== b.placement
      || !b.before.some(p => p.id === a.paragraphId) || !b.before.some(p => p.id === a.destinationId)
      || b.before.some(p => a.before.some(q => q.id === p.id && q.level !== p.level))) throw new Error('Move resolution changed its identities.');
  } else if (!same(a.before.map(p => [p.id, p.level]), b.before.map(p => [p.id, p.level]))
    || !same(a.after.map(p => p.id), b.after.map(p => p.id))) throw new Error('Structural resolution changed its identities.');
  if (a.kind === 'insert-paragraph' && !same(a.after, b.after) || a.kind === 'join-paragraphs' && b.kind === 'join-paragraphs' && a.separator !== b.separator) throw new Error('Structural resolution changed its parameters.');
}
