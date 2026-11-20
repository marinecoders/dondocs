import { describe, expect, it } from 'vitest';
import { assertEnclosureMarkingPolicy, CUI_TRANSMITTAL_NOTE, cuiTransmittalIssue, cuiTransmittalNote, enclosureClassification, enclosureMarkingSchema, inspectEnclosureMarkings } from '@/lib/enclosureMarkings';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { assertRetainedDocumentTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { captureDocumentRevision, copyCapturedDocument } from '@/lib/capturedDocument';
import { collectProofreadFindings } from '@/lib/proofread';
import { letterSchema } from '../../companion/letterSchema';
import { toStore } from '../../companion/letterInput';
import { validateLetter } from '../../companion/validateLetter';
import { handoffUrl } from '../../companion/handoff';
import { copyExportReview, prepareExport } from '@/lib/preparedExport';
import { parseSharedSession, createSharedPayload, draftEnvelope } from '@/lib/sharedSession';
import { parseSavedSession } from '@/lib/savedSession';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { createBlankSession } from '@/stores/documentStore';

describe('enclosure marking declarations', () => {
  it('blocks disallowed enclosure exports and requires an explicit review of insufficient covers', () => {
    const session = createBlankSession();
    session.enclosures = [{ title: 'Synthetic controlled appendix', marking: { classLevel: 'cui' } }];
    const captured = captureDocumentRevision({ documentId: 'synthetic', epoch: 1, editSequence: 0, capturedAt: 42 }, { ...session, endItems: [], publicationTables: {} });
    const request = { captured, id: 'synthetic-export', target: 'pdf' as const, filename: 'synthetic.pdf' };
    const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
    expect(prepareExport({ ...request, policy: restricted })).toMatchObject({ status: 'error', issues: [expect.stringContaining('outside this deployment')] });
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] }, runtime: { status: 'absent' } });
    const result = prepareExport({ ...request, policy });
    expect(result.status).toBe('needs-review');
    if (result.status !== 'needs-review') throw new Error('Expected captured marking review');
    expect(copyExportReview(result.job)).toMatchObject({ markingReview: true, notices: [expect.stringContaining('above the cover')] });
  });
  it('keeps companion requests explicit and rejects incomplete covers and lossy legacy handoffs', () => {
    const request = letterSchema.parse({ docType: 'naval_letter', subject: 'SYNTHETIC',
      classification: { level: 'cui', cui: { category: 'Privacy' } },
      enclosures: [{ title: 'Synthetic appendix', marking: { classLevel: 'cui', cuiCategory: 'Privacy' } }],
    });
    expect(validateLetter(request)).toEqual([]);
    expect(toStore(request).enclosures[0].marking).toEqual(request.enclosures![0].marking);
    expect(handoffUrl(request, {}, 'https://example.test')).toBeUndefined();
    request.classification!.level = 'unclassified';
    expect(validateLetter(request).join(' ')).toMatch(/above the cover/);
  });
  it('requires an explicit cover-only confirmation and rejects known controlled body content', () => {
    const enclosures = [{ marking: { classLevel: 'cui' as const } }];
    expect(cuiTransmittalNote({ classLevel: 'cui' }, [], enclosures)).toBeUndefined();
    expect(cuiTransmittalNote({ classLevel: 'cui', cuiTransmittalNote: true }, [], enclosures)).toBe(CUI_TRANSMITTAL_NOTE);
    expect(cuiTransmittalIssue({ classLevel: 'cui', cuiTransmittalNote: true }, [{ text: 'Synthetic controlled body', level: 0, portionMarking: 'CUI' }], enclosures)).toMatch(/conflicts/);
    expect(cuiTransmittalNote({ classLevel: 'cui', cuiTransmittalNote: true }, [{ text: 'Synthetic controlled body', level: 0, portionMarking: 'CUI' }], enclosures)).toBeUndefined();
    expect(cuiTransmittalIssue({ classLevel: 'cui', cuiTransmittalNote: true }, [], [])).toMatch(/without a declared CUI enclosure/);
  });
  it('enforces nested declarations in output and retained-transfer handling', () => {
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
    const session = createBlankSession();
    session.enclosures = [{ title: 'Synthetic', marking: { classLevel: 'secret' } }];
    expect(() => assertEnclosureMarkingPolicy(session, policy)).toThrow(/outside this deployment/);
    expect(() => assertRetainedDocumentTextPolicy(session, policy)).toThrow(/outside this deployment/);
    session.enclosures[0].marking = { classLevel: 'custom', customClassification: 'LOCAL HANDLING' };
    expect(() => assertEnclosureMarkingPolicy(session, policy)).toThrow(/unrecognized custom/);
  });
  it('distinguishes inherited from explicitly unclassified pages', () => {
    const cover = { level: 'cui', marking: 'CUI' };
    expect(enclosureClassification(undefined, cover)).toBe(cover);
    expect(enclosureClassification({ classLevel: 'unclassified' }, cover)).toEqual({ level: 'unclassified', marking: 'UNCLASSIFIED' });
  });
  it('rejects unknown levels, oversized text and empty custom output', () => {
    expect(enclosureMarkingSchema.safeParse({ classLevel: 'unknown' }).success).toBe(false);
    expect(enclosureMarkingSchema.safeParse({ classLevel: 'custom', customClassification: 'x'.repeat(241) }).success).toBe(false);
    expect(() => enclosureClassification({ classLevel: 'custom' })).toThrow(/marking text/);
  });
  it('checks cover level and CUI controls without treating categories as a ranking', () => {
    expect(inspectEnclosureMarkings({ classLevel: 'unclassified' }, [{ marking: { classLevel: 'cui' } }])).toMatchObject([{ index: 0, kind: 'level' }]);
    expect(inspectEnclosureMarkings({ classLevel: 'cui', cuiCategory: 'Privacy', cuiDissemination: 'FED ONLY' }, [
      { marking: { classLevel: 'cui', cuiCategory: 'Privacy; Legal', cuiDissemination: 'FED ONLY' } },
    ])).toMatchObject([{ kind: 'controls' }]);
    expect(inspectEnclosureMarkings({ classLevel: 'cui', cuiCategory: 'Privacy; Legal', cuiDissemination: 'FED ONLY' }, [
      { marking: { classLevel: 'cui', cuiCategory: 'Privacy', cuiDissemination: 'FED ONLY' } },
    ])).toEqual([]);
    expect(inspectEnclosureMarkings({ classLevel: 'custom', customClassification: 'LOCAL HANDLING' }, [
      { marking: { classLevel: 'cui' } },
    ])).toMatchObject([{ kind: 'custom' }]);
  });
  it('retains declarations in saved, history, draft and versioned shared copies', () => {
    const session = createBlankSession();
    session.enclosures = [{ title: 'Synthetic appendix', marking: { classLevel: 'cui', cuiCategory: 'Privacy', cuiDissemination: 'FED ONLY' } }];
    const saved = serializeDocumentSnapshot({ ...session, endItems: [], publicationTables: {} }, 42);
    expect(parseSavedSession(saved).enclosures[0].marking).toEqual(session.enclosures[0].marking);
    const payload = createSharedPayload(saved);
    expect(payload).toMatchObject({ version: 7, kind: 'dondocs-share' });
    expect(parseSharedSession(payload).enclosures[0].marking).toEqual(session.enclosures[0].marking);
    expect(draftEnvelope(saved)).toMatchObject({ version: 5, kind: 'dondocs-draft' });
    session.enclosures[0].marking!.cuiCategory = 'Changed later';
    expect(parseSharedSession(payload).enclosures[0].marking?.cuiCategory).toBe('Privacy');
  });
  it('round trips a retained reviewer/package snapshot without following later source changes', async () => {
    const session = createBlankSession();
    session.enclosures = [{ title: 'Controlled source', marking: { classLevel: 'cui', cuiCategory: 'Privacy' } }];
    const snapshot = { ...session, endItems: [], publicationTables: {} };
    const captured = captureDocumentRevision({ documentId: 'synthetic', epoch: 1, editSequence: 0, capturedAt: 42 }, snapshot);
    session.enclosures[0].marking!.classLevel = 'unclassified';
    const retained = copyCapturedDocument(captured).document;
    const transfer = await buildDraftFileFromSnapshot(retained, 42);
    expect(transfer).toMatchObject({ kind: 'dondocs-draft', version: 5 });
    expect(parseDraftFile(JSON.parse(JSON.stringify(transfer))).session.enclosures[0].marking).toEqual({ classLevel: 'cui', cuiCategory: 'Privacy' });
  });
  it('routes enclosure cover findings to the existing Proofread panel and clears resolved declarations', () => {
    const session = createBlankSession();
    session.enclosures = [{ title: 'Controlled source', marking: { classLevel: 'cui', cuiCategory: 'Privacy' } }];
    const findings = () => collectProofreadFindings(session).filter(finding => finding.id.startsWith('enclosure-marking:'));
    expect(findings()).toMatchObject([{ group: 'markings', target: { sectionId: 'enclosures', field: 'enclosure-marking-0' } }]);
    session.formData.classLevel = 'cui';
    session.formData.cuiCategory = 'Privacy';
    expect(findings()).toEqual([]);
    session.enclosures = [];
    expect(findings()).toEqual([]);
  });
});
