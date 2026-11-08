import { expect, it } from 'vitest';
import { detectCapturedPII, detectPII, detectSharedSessionPII } from '@/services/pii/detector';
import { captureDocumentRevision, copyCapturedSession } from '@/lib/capturedDocument';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { emptySl4 } from '@/data/techpub/sl4';
import { fixtureInstance } from '../_helpers/formFixture';
import { projectSharedSession } from '@/lib/documentSerialization';

function session(patch: Partial<DocumentSnapshot> = {}) {
  return copyCapturedSession(captureDocumentRevision({ documentId: 'privacy', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formData: {},
    paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {}, ...patch,
  }));
}

it('inspects inactive party fields retained in the serialized draft', () => {
  expect(detectPII(session({ formData: { seniorCommandName: 'SSN 123-45-6789' } })).summary.ssn).toBeGreaterThan(0);
});
it('does not label an ordinary publication signing date as a date of birth', () => {
  const publication = session({ docType: 'tm_ietm_front_matter', formData: { publicationSigningDate: '2026-10-30' } });
  expect(detectPII(publication).found).toBe(false);
  expect(detectSharedSessionPII(publication).found).toBe(false);
});
it('keeps scanning free-text and configured-form dates for possible birth dates', () => {
  expect(detectPII(session({ paragraphs: [{ text: 'DOB: 2001-02-03', level: 0 }] })).summary.dob).toBe(1);
  const form = fixtureInstance();
  form.rows.roster = [{ id: 'person', answers: { date: '2001-02-03' } }];
  expect(detectSharedSessionPII(session({ documentCategory: 'forms', formType: 'fixture', genericForm: form })).summary.dob).toBe(1);
});
it('still scans annotations and other sensitive values in document-date fields', () => {
  const data = session({ formData: { date: 'DOB: 2001-02-03; SSN 123-45-6789' } });
  expect(detectPII(data).summary).toMatchObject({ dob: 1, ssn: 1 });
});
it('inspects paragraph footnotes and nested table cells', () => {
  expect(detectPII(session({ paragraphs: [{ text: '', level: 0, tableFootnotes: [{ id: 'footnote', text: 'SSN 123-45-6789' }] }] })).summary.ssn).toBeGreaterThan(0);
  expect(detectPII(session({ publicationTables: { parts: [{ values: { notes: 'SSN 123-45-6789' } }] } })).summary.ssn).toBeGreaterThan(0);
});
it('inspects structured publication text instead of only the paragraph body', () => {
  const sl4 = emptySl4();
  sl4.cages = [{ id: 'supplier', code: '', name: '', address: 'SSN 123-45-6789', portionMarking: 'U' }];
  expect(detectPII(session({ docType: 'sl4', formData: { sl4 } })).summary.ssn).toBeGreaterThan(0);
});

it('distinguishes output fields from inactive text carried in a share', () => {
  const captured = captureDocumentRevision({ documentId: 'projection', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', docType: 'naval_letter', formData: { seniorCommandName: 'SSN 123-45-6789' },
    paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  expect(detectCapturedPII(captured).found).toBe(false);
  expect(detectCapturedPII(captured, 'share').summary.ssn).toBeGreaterThan(0);
});
it('reports repeated configured answers at their individual row locations', () => {
  const form = fixtureInstance();
  form.rows.roster = [1, 2].map(index => ({ id: `row-${index}`, answers: { date: 'SSN 123-45-6789' } }));
  const shared = session({ documentCategory: 'forms', formType: 'fixture', genericForm: form });
  const findings = detectSharedSessionPII(shared).findings.filter(finding => finding.type === 'SSN');
  expect(findings).toHaveLength(2);
  expect(findings.map(finding => finding.field)).toEqual(['Roster row 1: Date', 'Roster row 2: Date']);
});
it('inspects only the portable payload and does not treat excluded image bytes as text', () => {
  const shared = projectSharedSession(session({
    formData: { signatureImage: { name: 'SSN 123-45-6789.png', size: 1, data: 'SSN 123-45-6789' } },
    enclosures: [{ title: 'PDF', fileRef: { id: 'SSN 123-45-6789', name: 'SSN 123-45-6789.pdf', size: 1, type: '' } }],
  }));
  expect(detectSharedSessionPII(shared).found).toBe(false);
});

it.each([', ', '; ', ' ', '\n'])('keeps ordinary office closure lists out of birth-date findings with separator %j', separator => {
  const publication = session({ docType: 'i_type', formData: { publicationClosedDates: ['2026-11-11', '2026-11-26'].join(separator) } });
  const captured = captureDocumentRevision({ documentId: 'closures', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    ...publication, endItems: publication.endItems ?? [], publicationTables: publication.publicationTables ?? {},
  });
  expect(detectPII(publication).found).toBe(false);
  expect(detectSharedSessionPII(publication).found).toBe(false);
  expect(detectCapturedPII(captured).found).toBe(false);
});
it('still inspects dates and identifiers when a closure list includes annotations', () => {
  const publication = session({ docType: 'i_type', formData: { publicationClosedDates: '2026-11-11; DOB: 2001-02-03; SSN 123-45-6789' } });
  expect(detectSharedSessionPII(publication).summary).toMatchObject({ dob: 2, ssn: 1 });
});
it('keeps full birth-date inspection for plain date lists in free text', () => {
  expect(detectPII(session({ paragraphs: [{ text: '2001-02-03, 2002-03-04', level: 0 }] })).summary.dob).toBe(2);
});
