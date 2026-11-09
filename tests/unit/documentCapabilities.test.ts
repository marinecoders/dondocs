import { expect, it } from 'vitest';
import { capturedCapabilities, resolveCapabilities, type CapabilityRequest, type CapabilitySubject } from '@/lib/documentCapabilities';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { fixtureDefinition } from '../_helpers/formFixture';

const pdf: CapabilityRequest = { operation: 'export', target: 'pdf' };
const word: CapabilityRequest = { operation: 'export', target: 'docx' };
const letter = { kind: 'correspondence', docType: 'naval_letter', documentMode: 'compliant' } as const;
function loadedDefinition() {
  const definition = fixtureDefinition();
  definition.pages = definition.pages.map(page => ({ ...page, sha256: 'a'.repeat(64) }));
  return definition;
}
const configured = (definition = loadedDefinition()): CapabilitySubject => ({
  kind: 'configured-form', documentMode: 'compliant', formType: 'fixture', definition: { status: 'loaded', definition },
});

it.each(['compliant', 'custom'] as const)('supports correspondence PDF, DOCX, preview, and batch in %s mode', documentMode => {
  for (const request of [pdf, word, { operation: 'preview', target: 'pdf' }, { operation: 'batch', target: 'pdf' }] as const) {
    expect(resolveCapabilities({ ...letter, documentMode }, request)).toMatchObject(request.target === 'docx' ? { status: 'partial', reason: 'word-pdf-features' } : { status: 'supported' });
  }
});
it.each(['sl3', 'sl4', 'i_type', 'tm_ietm_front_matter'])('uses the existing PDF-only configuration for %s', docType => {
  expect(resolveCapabilities({ ...letter, docType }, pdf).status).toBe('supported');
  expect(resolveCapabilities({ ...letter, docType }, word)).toMatchObject({ status: 'unsupported', reason: 'pdf-only' });
});
it.each(['navmc_10274', 'navmc_118_11'])('limits built-in %s output to PDF while retaining batch support', formType => {
  const form = { kind: 'builtin-form', documentMode: 'compliant', formType } as const;
  expect(resolveCapabilities(form, pdf).status).toBe('supported');
  expect(resolveCapabilities(form, { operation: 'batch', target: 'pdf' }).status).toBe('supported');
  expect(resolveCapabilities(form, word)).toMatchObject({ status: 'unsupported', reason: 'pdf-only' });
  expect(resolveCapabilities(form, { operation: 'export', target: 'tex' }).status).toBe('unsupported');
});
it('describes TeX fragments and share omissions as partial capabilities', () => {
  expect(resolveCapabilities(letter, { operation: 'export', target: 'tex' })).toMatchObject({ status: 'partial', reason: 'tex-configuration-only' });
  for (const subject of [letter, configured(), { kind: 'builtin-form', documentMode: 'compliant', formType: 'navmc_10274' }] as const) {
    expect(resolveCapabilities(subject, { operation: 'share', target: 'link' })).toMatchObject({ status: 'partial', reason: 'share-separate-assets' });
  }
});
it.each(['not-loaded', 'loading', 'failed'] as const)('reports selected form definition state %s without assuming support', status => {
  expect(resolveCapabilities({ kind: 'configured-form', documentMode: 'compliant', formType: 'fixture', definition: { status } }, pdf)).toMatchObject({ status: 'not-ready' });
});
it('supports a loaded definition without mutating it and explicitly rejects configured-form batch', () => {
  const definition = loadedDefinition();
  const before = structuredClone(definition);
  expect(resolveCapabilities(configured(definition), pdf).status).toBe('supported');
  expect(definition).toEqual(before);
  expect(resolveCapabilities(configured(definition), { operation: 'batch', target: 'pdf' })).toMatchObject({ status: 'unsupported', reason: 'configured-form-batch' });
});
it('rejects mismatched, malformed, and unsupported definition versions', () => {
  const definition = fixtureDefinition();
  expect(resolveCapabilities({ kind: 'configured-form', documentMode: 'compliant', formType: 'another', definition: { status: 'loaded', definition } }, pdf)).toMatchObject({ status: 'invalid-data', reason: 'definition-mismatch' });
  for (const invalid of [{ ...definition, schemaVersion: 999 }, {}, null]) {
    expect(resolveCapabilities({ kind: 'configured-form', documentMode: 'compliant', formType: 'fixture', definition: { status: 'loaded', definition: invalid } }, pdf)).toMatchObject({ status: 'invalid-data', reason: 'invalid-definition' });
  }
});
it.each(['unknown', 'toString', '__proto__'])('rejects unrecognized correspondence %s instead of falling back to a naval letter', docType => {
  expect(resolveCapabilities({ ...letter, docType }, pdf)).toMatchObject({ status: 'invalid-data', reason: 'unknown-document-type' });
});
it('rejects invalid modes, operation/target pairs, and form kinds at runtime', () => {
  expect(resolveCapabilities({ ...letter, documentMode: 'invalid' } as unknown as CapabilitySubject, pdf)).toMatchObject({ status: 'invalid-data', reason: 'invalid-mode' });
  expect(resolveCapabilities(letter, { operation: 'share', target: 'pdf' } as unknown as CapabilityRequest)).toMatchObject({ status: 'invalid-data', reason: 'invalid-request' });
  expect(resolveCapabilities({ kind: 'builtin-form', documentMode: 'compliant', formType: 'fixture' }, pdf)).toMatchObject({ status: 'invalid-data', reason: 'unknown-form-type' });
  expect(resolveCapabilities({ kind: 'configured-form', documentMode: 'compliant', formType: 'navmc_10274', definition: { status: 'loading' } }, pdf)).toMatchObject({ status: 'invalid-data', reason: 'unknown-form-type' });
});
it('resolves an owned capture and makes the resulting decision immutable', () => {
  const captured = captureDocumentRevision({ documentId: 'capability', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', docType: 'business_letter', formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  const result = capturedCapabilities(captured, word);
  expect(result.status).toBe('partial');
  expect(() => Object.assign(result, { status: 'unsupported' })).toThrow();
  expect(() => capturedCapabilities({ ...captured }, pdf)).toThrow('not issued');
});

it.each([
  { operation: 'export', target: 'pdf' },
  { operation: 'preview', target: 'pdf' },
  { operation: 'share', target: 'link' },
] as const)('rejects a loaded definition without verified page identities for $operation', request => {
  expect(resolveCapabilities(configured(fixtureDefinition()), request)).toMatchObject({
    status: 'invalid-data', reason: 'invalid-definition',
  });
});
it('requires a checksum on every configured-form page', () => {
  const definition = loadedDefinition();
  definition.pages.push({ file: 'page2.pdf', width: 612, height: 792 });
  expect(resolveCapabilities(configured(definition), pdf)).toMatchObject({
    status: 'invalid-data', reason: 'invalid-definition',
  });
});
it('rejects captured form definitions that the default page loader cannot render', () => {
  const captured = captureDocumentRevision({ documentId: 'missing-checksum', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', documentCategory: 'forms', formType: 'fixture', docType: 'naval_letter',
    genericForm: { definition: fixtureDefinition(), answers: {}, rows: {}, answerRevision: 0 },
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  expect(capturedCapabilities(captured, pdf)).toMatchObject({ status: 'invalid-data', reason: 'invalid-definition' });
});

it('distinguishes configuration fragments from flat TeX and applies PDF-only limits to flat output', () => {
  expect(resolveCapabilities(letter, { operation: 'export', target: 'tex', texMode: 'flat' })).toEqual({ status: 'supported' });
  expect(resolveCapabilities({ ...letter, docType: 'sl3' }, { operation: 'export', target: 'tex', texMode: 'flat' })).toMatchObject({ status: 'unsupported', reason: 'pdf-only' });
  expect(resolveCapabilities({ ...letter, docType: 'sl3' }, { operation: 'export', target: 'tex', texMode: 'configuration' })).toMatchObject({ status: 'partial', reason: 'tex-configuration-only' });
});
