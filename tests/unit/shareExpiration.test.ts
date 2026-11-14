import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBlankSession } from '@/stores/documentStore';
import { createSharedPayload, parseSharedSession, sessionSchema, validateShareExpiration } from '@/lib/sharedSession';
import { encryptSharePayload, decryptSharePayload } from '@/lib/shareCrypto';
import { parseDraftFile } from '@/lib/draftFile';
import { fixtureInstance } from '../_helpers/formFixture';

afterEach(() => vi.restoreAllMocks());
const NOW = Date.UTC(2026, 10, 13);
function payload() {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  return createSharedPayload(createBlankSession(), NOW + 1000);
}

it('authenticates the deadline inside the encrypted payload and rejects at the exact deadline', async () => {
  const original = payload();
  const encrypted = await encryptSharePayload(original, 'synthetic-password');
  const decrypted = await decryptSharePayload(encrypted, 'synthetic-password');
  expect(decrypted).toEqual(original);
  vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt - 1);
  expect(parseSharedSession(decrypted)).toEqual(parseSharedSession(original.session));
  vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt);
  expect(() => parseSharedSession(decrypted)).toThrow('expired');
  vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt + 1);
  expect(() => parseSharedSession(decrypted)).toThrow('expired');
  const bytes = atob(encrypted.replace(/-/g, '+').replace(/_/g, '/'));
  const tampered = Uint8Array.from(bytes, char => char.charCodeAt(0));
  tampered[30] ^= 1;
  const encoded = btoa(String.fromCharCode(...tampered)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await expect(decryptSharePayload(encoded, 'synthetic-password')).rejects.toThrow('Wrong password or invalid');
});

it.each([undefined, null, '2026-11-13', true, NaN, Infinity, -1, 0, 1.5, 8_640_000_000_000_001])('rejects malformed expiry %s rather than stripping it', expiresAt => {
  const original = payload();
  expect(() => parseSharedSession({ ...original, expiresAt })).toThrow();
});

it('rejects hidden, nested and unsupported restrictions and fails closed on an invalid clock', () => {
  const original = payload();
  for (const version of [1, 2, 4]) expect(() => parseSharedSession({ ...original, version })).toThrow();
  expect(() => parseSharedSession({ ...original.session, expiresAt: original.expiresAt })).toThrow('version 3');
  expect(() => parseSharedSession({ ...original, session: original })).toThrow('unsupported');
  expect(() => parseSharedSession({ ...original, minReader: 99 })).toThrow('unsupported');
  expect(() => parseSharedSession({ ...original, documentKind: 'builtin-form' })).toThrow('does not match');
  for (const clock of [NaN, Infinity, -1, 8_640_000_000_000_001]) expect(() => validateShareExpiration(original.expiresAt, clock)).toThrow('date and time');
  expect(() => createSharedPayload(original.session, NOW)).toThrow('expired');
});

it('makes expiry copies unreadable by the historical flat-session and v1/v2 envelope readers', () => {
  const original = payload();
  const historicalEnvelope = z.object({ kind: z.literal('dondocs-share'), version: z.union([z.literal(1), z.literal(2)]) });
  expect(historicalEnvelope.safeParse(original).success).toBe(false);
  expect(sessionSchema.safeParse(original).success).toBe(false);
  expect(() => parseDraftFile(original)).toThrow();
  expect(() => parseDraftFile({ ...original, genericForm: fixtureInstance() })).toThrow();
});

it.each(['navmc_10274', 'navmc_118_11', 'configured', 'correspondence'] as const)('preserves %s data and review model 2 in expiring copies', kind => {
  payload();
  const session = createBlankSession(kind === 'navmc_10274' || kind === 'navmc_118_11' ? kind : undefined);
  if (kind === 'configured') {
    session.documentCategory = 'forms'; session.genericForm = fixtureInstance(); session.formType = session.genericForm.definition.formId;
  }
  const paragraphId = crypto.randomUUID();
  session.paragraphs = [{ id: paragraphId, text: 'Synthetic body', level: 0 }];
  session.reviewComments = { version: 2, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'paragraph', paragraphId, context: 'Synthetic body', docType: session.docType }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Reviewer', text: 'Synthetic review', createdAt: new Date(NOW).toISOString() }] }] };
  const original = structuredClone(session);
  const expiring = createSharedPayload(session, NOW + 1000);
  expect(parseSharedSession(expiring)).toEqual(parseSharedSession(createSharedPayload(session)));
  expect(parseSharedSession(expiring).reviewComments).toEqual(session.reviewComments);
  expect(session).toEqual(original);
  expect(createSharedPayload(session).version).toBe(2);
  delete session.reviewComments;
  expect(createSharedPayload(session).version).toBe(1);
});
