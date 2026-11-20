import { describe, expect, it } from 'vitest';
import { assertEnclosureMarkingPolicy, enclosureClassification, enclosureMarkingSchema, inspectEnclosureMarkings } from '@/lib/enclosureMarkings';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { assertRetainedDocumentTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { parseSharedSession, createSharedPayload, draftEnvelope } from '@/lib/sharedSession';
import { parseSavedSession } from '@/lib/savedSession';
import { serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { createBlankSession } from '@/stores/documentStore';

describe('enclosure marking declarations', () => {
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
});
