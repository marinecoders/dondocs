import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SerializedSession } from '@/stores/documentStore';
import { canonicalReviewPayload } from '@/lib/reviewRounds';
import { captureReconciledReviewStructure, type ReviewStructureReconciliation } from '@/lib/reconcileReviewStructure';
import { structureSuggestionText, type ReviewStructureTarget } from '@/lib/reviewStructureSuggestions';
import type { ReviewSuggestionResolution } from '@/lib/reviewSuggestions';

export function StructureReconciliationControls({ source, target, inspection, changeId, disabled, onDecide }: {
  source: SerializedSession; target: ReviewStructureTarget; inspection: ReviewStructureReconciliation; changeId: string; disabled: boolean;
  onDecide: (action: 'accepted' | 'rejected', resolution?: ReviewSuggestionResolution) => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState<{ target: ReviewStructureTarget; source: string } | null>(null);
  const [splitAt, setSplitAt] = useState<number | null>(null), [error, setError] = useState('');
  const currentKey = canonicalReviewPayload(source.paragraphs);
  const stale = !!preview && preview.source !== currentKey;
  const split = target.operation.kind === 'split-paragraph';
  const paragraph = split ? source.paragraphs.find(p => p.id === target.operation.before[0].id) : null;
  const conflict = !['unchanged', 'independent'].includes(inspection.kind);
  return <fieldset disabled={disabled} className="space-y-2 rounded-md border p-3">
    <legend className="text-sm font-medium">Reconcile paragraph structure</legend>
    <p className="text-sm">{inspection.kind.replaceAll('-', ' ')}. {conflict ? 'Keep current work or deliberately review this operation against its exact current paragraphs.' : 'The operation retains current paragraph contents, formatting and identities.'}</p>
    {!inspection.canResolve && <p className="text-sm">The original identities or parent boundary are unavailable. Reject this proposal and create a new one from a fresh review.</p>}
    {inspection.canResolve && split && conflict && <>
      <Label htmlFor={`${id}-split`}>Choose the current split boundary</Label>
      <p className="text-xs">Place the caret in the current stored text. Formatting markers are shown; variable chips and complete characters must remain intact.</p>
      <Textarea id={`${id}-split`} readOnly value={paragraph?.text ?? ''} onSelect={event => {
        setSplitAt(event.currentTarget.selectionStart === event.currentTarget.selectionEnd ? event.currentTarget.selectionStart : null);setPreview(null);
      }} />
      <p className="text-xs">{splitAt === null ? 'No current boundary selected.' : `Selected current offset: ${splitAt}`}</p>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => onDecide('rejected')}>Keep current structure</Button>
      {inspection.canResolve && <Button size="sm" variant="outline" disabled={split && conflict && splitAt === null} onClick={() => {
        try {
          const resolved = captureReconciledReviewStructure(source, target, splitAt ?? undefined);
          setPreview({ target: resolved, source: currentKey });setError('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'This operation cannot preserve the current structure.'); }
      }}>Preview operation on current draft</Button>}
    </div>
    {preview && <div className="space-y-2 text-sm">
      <p className="font-medium">Exact current scope before this decision</p>
      <p className="whitespace-pre-wrap break-words">{structureSuggestionText(preview.target.operation.before) || '(Insertion point)'}</p>
      <p className="font-medium">Result with current work retained</p>
      <p className="whitespace-pre-wrap break-words">{structureSuggestionText(preview.target.operation.after) || '(Paragraph deleted)'}</p>
      <details><summary>Captured paragraph properties and boundaries</summary><div className="max-h-48 space-y-2 overflow-auto break-words text-xs">
        <p>Parent identity: {preview.target.operation.parentId ?? '(Top level)'}. Before identity: {preview.target.operation.gap.before?.id ?? '(Start)'}. After identity: {preview.target.operation.gap.after?.id ?? '(End)'}.</p>
        {preview.target.operation.before.map(node => <p key={node.id}>Paragraph identity: {node.id}; level: {node.level + 1}{node.header ? `; heading: ${node.header}` : ''}{node.portionMarking ? `; portion marking: ${node.portionMarking}` : ''}{node.referenceId ? `; linked reference: ${node.referenceId}` : ''}{node.figure ? `; figure: ${node.figure.name ?? node.figure.fileRef?.name ?? '(Retained figure)'}` : ''}.</p>)}
      </div></details>
      {stale && <p role="alert">The draft changed. Preview the current operation again.</p>}
      <Button size="sm" disabled={stale} onClick={() => onDecide('accepted', { changeId, structure: preview.target,
        expectedCurrent: structureSuggestionText(preview.target.operation.before), value: structureSuggestionText(preview.target.operation.after) })}>Confirm operation on current draft</Button>
      <Button size="sm" variant="outline" onClick={() => { setPreview(null);setSplitAt(null);setError(''); }}>Cancel structural reconciliation</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </fieldset>;
}
