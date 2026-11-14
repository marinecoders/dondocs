import { expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { createSharedPayload, parseSharedSession, sessionSchema } from '@/lib/sharedSession';
import { fixtureDefinition } from '../_helpers/formFixture';

it('writes an explicit envelope that remains readable by the established session reader', () => {
  const session = createBlankSession();session.formData.subject = 'Original';
  const payload = createSharedPayload(session);
  expect(payload).toMatchObject({ kind: 'dondocs-share', version: 1, documentKind: 'correspondence' });
  expect(sessionSchema.parse(payload).formData.subject).toBe('Original');
  session.formData.subject = 'Changed';
  expect(parseSharedSession(payload).formData.subject).toBe('Original');
  expect(parseSharedSession(session).formData.subject).toBe('Changed');
});
it.each(['navmc_10274', 'navmc_118_11'] as const)('round trips %s answers and signature statements', formType => {
  const session = createBlankSession(formType);
  const form = formType === 'navmc_10274' ? session.forms!.navmc10274! : session.forms!.navmc11811!;
  form.signatureBlocks = [{ name: 'Signer', statement: 'Reviewed', style: 'typed' }];
  const payload = createSharedPayload(session);
  expect(payload.documentKind).toBe('builtin-form');
  expect(parseSharedSession(payload).forms).toEqual(sessionSchema.parse(session).forms);
});
it('round trips configured form answers and repeated rows', () => {
  const session = createBlankSession();session.documentCategory = 'forms';session.formType = 'fixture';
  const definition = fixtureDefinition();session.formType = definition.formId;
  session.genericForm = { definition, answers: { name: 'Original' }, rows: { roster: [{ id: 'one', answers: { grade: 'e1', date: '2026-11-07' } }, { id: 'two', answers: { grade: 'e2', date: '2026-11-08' } }] }, answerRevision: 1 };
  const payload = createSharedPayload(session);
  expect(payload.documentKind).toBe('configured-form');
  expect(parseSharedSession(payload).genericForm).toEqual(session.genericForm);
});
it('rejects unsupported versions and document-kind mismatches', () => {
  const payload = createSharedPayload(createBlankSession());
  expect(() => parseSharedSession({ ...payload, version: 3 })).toThrow('unsupported');
  expect(() => parseSharedSession({ ...payload, documentKind: 'builtin-form' })).toThrow('does not match');
});
it('strips incoming and outgoing device handles and signature bytes without mutating the source', () => {
  const session = createBlankSession('navmc_118_11');
  const imageRef = { id: 'local', name: 'signature.png', size: 3, type: 'image/png' };
  session.forms!.navmc11811!.signatureBlocks = [{ name: 'Signer', statement: '', style: 'image', image: 'YWJj', imageRef }];
  const payload = createSharedPayload(session);
  expect(payload.forms!.navmc11811!.signatureBlocks[0]).toEqual({ name: 'Signer', statement: '', style: 'image' });
  expect(session.forms!.navmc11811!.signatureBlocks[0].imageRef).toEqual(imageRef);
});
