import { describe, expect, it } from 'vitest';
import { getSerializedSession } from '@/stores/documentStore';
import { type ReviewRound } from '@/lib/reviewRounds';
import { createReviewCheckpoint, compareReviewCheckpoint, parseReviewCheckpoint, checkpointDocumentFields } from '@/lib/reviewCheckpoints';
import { createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { prepareCheckpointExport } from '@/lib/reviewCheckpointActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

function fixture() {
  const session = getSerializedSession();
  session.docType = 'naval_letter';
  session.documentCategory = 'correspondence';
  session.formData.subject = 'FICTIONAL CHECKPOINT';
  session.formData.to = 'Original recipient';
  session.paragraphs = [{ id: 'checkpoint-alpha', level: 0, text: 'Alpha training paragraph.' },
    { id: 'checkpoint-bravo', level: 0, text: 'Bravo training paragraph.' }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: session.timestamp, label: 'Checkpoint round', sourceDocumentId: 'example-source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: session.timestamp, session: structuredClone(session) } };
  return { session, round, reviewer: { id: crypto.randomUUID(), label: 'Example chief' } };
}

describe('review comparison checkpoints', () => {
  it('records exact retained text without binary or opaque asset handles', async () => {
    const { session, round, reviewer } = fixture();
    session.formData.signatureImage = { name: 'signature.png', size: 10, data: 'UNIQUE_BASE64_BINARY' };
    session.enclosures = [{ title: 'Supporting record', fileRef: { id: 'att_private_reference', name: 'support.pdf', type: 'application/pdf', size: 10 } }];
    const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
    expect(JSON.stringify(checkpoint)).toContain('Alpha training paragraph.');
    expect(JSON.stringify(checkpoint)).toContain('support.pdf');
    expect(JSON.stringify(checkpoint)).not.toContain('UNIQUE_BASE64_BINARY');
    expect(JSON.stringify(checkpoint)).not.toContain('att_private_reference');
    expect(await parseReviewCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toEqual(checkpoint);
  });

  it('distinguishes stable paragraph position changes from independent wording edits', async () => {
    const { session, round, reviewer } = fixture();
    const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
    const current = structuredClone(session);
    current.paragraphs.reverse();
    current.paragraphs[1].text = 'Edited alpha paragraph.';
    const comparison = compareReviewCheckpoint(checkpoint, round, current, null);
    const text = comparison.document.filter(change => change.label.endsWith('Text'));
    expect(text).toEqual([expect.objectContaining({ before: 'Alpha training paragraph.', after: 'Edited alpha paragraph.' })]);
    expect(comparison.document.filter(change => change.label.endsWith('position'))).toHaveLength(2);
    expect(comparison.feedback).toEqual([]);
  });

  it('shows feedback acceptance and discussion resolution without changing current work', async () => {
    const { session, round, reviewer } = fixture();
    session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false, category: 'question',
      messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Which recipient?', createdAt: '2026-11-15T00:00:00Z' }] }] };
    const proposal = createReviewSuggestion(round, { author: reviewer.label, label: 'Recipient correction', category: 'required-correction',
      changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Reviewed recipient' }] });
    const state = emptyReviewSuggestionState(round);
    state.proposals.push(proposal);
    const checkpoint = await createReviewCheckpoint(round, session, state, reviewer);
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    accepted.session.reviewComments!.threads[0].resolved = true;
    const comparison = compareReviewCheckpoint(checkpoint, round, accepted.session, accepted.state);
    expect(comparison.feedback.length).toBeGreaterThanOrEqual(2);
    expect(comparison.feedback.find(change => change.label.startsWith('Suggestion'))?.after).toContain('Accepted');
    expect(comparison.feedback.find(change => change.label.startsWith('Discussion'))?.after).toContain('Resolved');
    expect(session.formData.to).toBe('Original recipient');
    expect(session.reviewComments.threads[0].resolved).toBe(false);
  });

  it('does not infer reviewer identity from equal names and rejects cross-round comparisons', async () => {
    const { session, round, reviewer } = fixture();
    const first = await createReviewCheckpoint(round, session, null, reviewer);
    const second = await createReviewCheckpoint(round, session, null, { ...reviewer, id: crypto.randomUUID() });
    expect(first.reviewerLabel).toBe(second.reviewerLabel);
    expect(first.reviewerId).not.toBe(second.reviewerId);
    expect(() => compareReviewCheckpoint(first, { ...round, baselineDigest: 'b'.repeat(64) }, session, null)).toThrow(/another review baseline/);
  });

  it('rejects modified text, duplicate field identities and overlarge snapshots', async () => {
    const { session, round, reviewer } = fixture();
    const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
    const modified = structuredClone(checkpoint);
    modified.document[0].value = 'Tampered';
    await expect(parseReviewCheckpoint(modified)).rejects.toThrow(/checksum/);
    await expect(parseReviewCheckpoint({ ...checkpoint, document: [...checkpoint.document, checkpoint.document[0]] })).rejects.toThrow(/unique/);
    session.paragraphs[0].text = 'X'.repeat(200_001);
    await expect(createReviewCheckpoint(round, session, null, reviewer)).rejects.toThrow();
  });

  it('keeps removed sensitive text under export privacy and marking review', async () => {
    const { session, round, reviewer } = fixture();
    session.formData.to = 'Fictional SSN 123-45-6789';
    const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
    session.formData.to = 'New recipient';
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
    expect((await prepareCheckpointExport(checkpoint, round, policy)).review.privacy.found).toBe(true);
    expect(checkpointDocumentFields(session).some(field => field.value.includes('123-45-6789'))).toBe(false);
  });
});

it('does not infer that missing proposal records were resolved or deleted in another copy', async () => {
  const { session, round, reviewer } = fixture();
  const proposal = createReviewSuggestion(round, { author: 'Example chief', label: 'Recipient', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Reviewed recipient' },
  ] });
  const state = emptyReviewSuggestionState(round);
  state.proposals.push(proposal);
  const checkpoint = await createReviewCheckpoint(round, session, state, reviewer);
  const unavailable = compareReviewCheckpoint(checkpoint, round, session, null);
  expect(unavailable.feedback[0].after).toContain('no removal or decision is inferred');
});

it('bounds independent reviewer count while allowing the selected marker to be updated', async () => {
  const { planReviewCheckpointUpdate } = await import('@/lib/reviewCheckpoints');
  const { session, round, reviewer } = fixture();
  let retained = round;
  for (let index = 0; index < 25; index++) {
    const checkpoint = await createReviewCheckpoint(round, session, null, { ...reviewer, id: crypto.randomUUID() });
    retained = planReviewCheckpointUpdate(retained, checkpoint);
  }
  const extra = await createReviewCheckpoint(round, session, null, { ...reviewer, id: crypto.randomUUID() });
  expect(() => planReviewCheckpointUpdate(retained, extra)).toThrow(/25 reviewer markers/);
  const existing = retained.checkpoints![0];
  const replacement = await createReviewCheckpoint(round, session, null, { id: existing.reviewerId, label: existing.reviewerLabel });
  expect(planReviewCheckpointUpdate(retained, replacement).checkpoints).toHaveLength(25);
});

it('bounds combined retained text independently of each valid checkpoint file', async () => {
  const { planReviewCheckpointUpdate } = await import('@/lib/reviewCheckpoints');
  const { session, round, reviewer } = fixture();
  session.paragraphs = Array.from({ length: 10 }, (_, index) => ({ id: `large-checkpoint-${index}`, text: 'X'.repeat(180_000), level: 0 }));
  const first = await createReviewCheckpoint(round, session, null, reviewer);
  const second = await createReviewCheckpoint(round, session, null, { ...reviewer, id: crypto.randomUUID() });
  const retained = planReviewCheckpointUpdate(round, first);
  expect(() => planReviewCheckpointUpdate(retained, second)).toThrow(/combined reviewer checkpoints exceed 2 MB/);
});

it('rejects a checkpoint captured above its baseline marking under an unclassified-only delivery policy', async () => {
  const { session, round, reviewer } = fixture();
  session.formData.classLevel = 'secret';
  const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  await expect(prepareCheckpointExport(checkpoint, round, policy)).rejects.toThrow(/configured levels/);
});

it('checks multiline retained portion markings without flattening them into escaped JSON', async () => {
  const { session, round, reviewer } = fixture();
  session.paragraphs[0].text = 'Earlier text.\n(S) Synthetic retained marking.';
  const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  await expect(prepareCheckpointExport(checkpoint, round, policy)).rejects.toThrow(/configured levels/);
});

it('checks raw pending proposal and comment text without hiding first-line portion markings behind labels', async () => {
  const { session, round, reviewer } = fixture();
  const state = emptyReviewSuggestionState(round);
  state.proposals.push(createReviewSuggestion(round, { author: 'Example chief', label: 'Recipient', changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: '(S) Synthetic proposed recipient' },
  ] }));
  const proposalCheckpoint = await createReviewCheckpoint(round, session, state, reviewer);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  await expect(prepareCheckpointExport(proposalCheckpoint, round, policy)).rejects.toThrow(/configured levels/);
  session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example chief', text: '(S) Synthetic comment', createdAt: '2026-11-15T00:00:00Z' }] }] };
  const commentCheckpoint = await createReviewCheckpoint(round, session, null, reviewer);
  await expect(prepareCheckpointExport(commentCheckpoint, round, policy)).rejects.toThrow(/configured levels/);
});

it('retains the marking floor of document fields even when separate marking metadata is removed', async () => {
  const { reviewPayloadDigest } = await import('@/lib/reviewRounds');
  const { session, round, reviewer } = fixture();
  session.formData.classLevel = 'secret';
  const checkpoint = await createReviewCheckpoint(round, session, null, reviewer);
  const { digest: _digest, ...content } = checkpoint;
  content.markings = [];
  const reencoded = { ...content, digest: await reviewPayloadDigest(content) };
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  await expect(prepareCheckpointExport(reencoded, round, policy)).rejects.toThrow(/configured levels/);
});
