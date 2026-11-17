import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { Paragraph } from '@/types/document';
import type { ReviewRound } from '@/lib/reviewRounds';
import { applyReviewStructure, captureReviewStructure, validateReviewStructureTarget } from '@/lib/reviewStructureSuggestions';
import {
  appendReviewSuggestions, createParagraphStructureSuggestion, createReviewSuggestion,
  emptyReviewSuggestionState, planReviewSuggestionDecision, planReviewSuggestionHistory,
  validateReviewSuggestion,
} from '@/lib/reviewSuggestions';

function fixture(block: Partial<Paragraph>) {
  const session = createBlankSession();
  session.paragraphs = [
    { id: 'rich', level: 0, text: 'Retained caption', ...structuredClone(block) },
    { id: 'other', level: 0, text: 'Other body' },
    { id: 'tail', level: 0, text: 'Final body' },
  ];
  const round: ReviewRound = {
    kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 1, label: 'Rich native review', sourceDocumentId: 'owner', ownerDocumentId: 'owner',
    baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session: structuredClone(session) },
  };
  const operation = { kind: 'move-paragraph' as const, paragraphId: 'rich', destinationId: 'other', placement: 'after' as const };
  return { session, round, operation };
}

const table: Partial<Paragraph> = { bodyTable: { rows: [['Name', 'Value'], ['Example', '**Retained**']], headerRows: 1 } };
const image: Partial<Paragraph> = { figure: {
  placement: 'body', altText: 'Meaningful source alternative', name: 'diagram.png', type: 'image/png',
  width: 10, height: 20, fileRef: { id: 'owned-image', name: 'diagram.png', type: 'image/png', size: 42 },
} };

describe('rich native blocks in existing review operations', () => {
  it.each([['table', table], ['image', image]] as const)('moves the %s exactly through validation, acceptance and Undo', (_name, block) => {
    const { session, round, operation } = fixture(block);
    const before = structuredClone(session);
    const proposal = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation });
    expect(validateReviewSuggestion(round, JSON.parse(JSON.stringify(proposal)))).toEqual(proposal);
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(accepted.status).toBe('ready');
    expect(accepted.session.paragraphs.map(paragraph => paragraph.id)).toEqual(['other', 'rich', 'tail']);
    expect(accepted.session.paragraphs[1]).toEqual(before.paragraphs[0]);
    const target = proposal.changes[0].target;
    if (target.kind !== 'structure') throw new Error('Expected structural move');
    const restored = applyReviewStructure(accepted.session, target, 'reverse');
    expect(restored).toEqual(before);
    const history = planReviewSuggestionHistory(round, accepted.session, restored, accepted.state, accepted.state.decisions[0].id, 'undo');
    expect(history.decisions.at(-1)?.action).toBe('reversed');
    expect(session).toEqual(before);
  });

  it.each([['table', table], ['image', image]] as const)('rejects forged %s payload changes while preserving independently newer content', (_name, block) => {
    const { session, round, operation } = fixture(block);
    const target = captureReviewStructure(session, operation);
    const moved = target.operation.after.find(paragraph => paragraph.id === 'rich')!;
    if (moved.bodyTable) moved.bodyTable.rows[1][1] = 'Forged cell';
    else moved.figure!.altText = 'Forged alternative';
    expect(() => validateReviewStructureTarget(session, target)).toThrow();
    const proposal = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation });
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    if (session.paragraphs[0].bodyTable) session.paragraphs[0].bodyTable.rows[1][1] = 'Newer cell';
    else session.paragraphs[0].figure!.fileRef!.id = 'newer-image';
    const newer = structuredClone(session);
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('ready');
    expect(plan.session.paragraphs.map(paragraph => paragraph.id)).toEqual(['other', 'rich', 'tail']);
    expect(plan.session.paragraphs[1]).toEqual(newer.paragraphs[0]);
    expect(session).toEqual(newer);
  });

  it('keeps resource-aware deletion and plain-text replacement boundaries explicit', () => {
    const { session, round } = fixture(table);
    expect(() => captureReviewStructure(session, { kind: 'delete-paragraph', paragraphId: 'rich' })).toThrow(/Structured paragraphs/);
    delete round.baseline.session.paragraphs[0].bodyTable;
    const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Body correction', changes: [{
      target: { kind: 'paragraph', paragraphId: 'rich', docType: session.docType }, proposed: 'Reviewed text',
    }] });
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    expect(planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted').status).toBe('stale');
  });

  it('keeps reviewer copies from moving local image resources', () => {
    const { round, operation } = fixture(image);
    delete round.ownerDocumentId;
    expect(() => createParagraphStructureSuggestion(round, { author: 'Reviewer', operation })).toThrow(/local resource handles/);
  });

  it.each([['table', table], ['image', image]] as const)('keeps the %s intact when splitting or joining is unsupported', (_name, block) => {
    const { session } = fixture(block);
    expect(() => captureReviewStructure(session, { kind: 'split-paragraph', paragraphId: 'rich', splitAt: 4 })).toThrow(/cannot be split or joined safely/);
    expect(() => captureReviewStructure(session, { kind: 'join-paragraphs', paragraphId: 'rich', nextParagraphId: 'other', separator: ' ' })).toThrow(/cannot be split or joined safely/);
  });
});
