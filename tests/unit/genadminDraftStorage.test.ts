import { beforeEach, expect, it } from 'vitest';
import { EMPTY_GENADMIN_DRAFT, GENADMIN_LIMITS } from '@/services/messages/genadmin';
import { readGenadminDraft, writeGenadminDraft } from '@/services/messages/genadminDraftStorage';

const key = 'dondocs.genadminDraft';

beforeEach(() => localStorage.removeItem(key));

it.each([
  ['pat@example.invalid', { contactDetails: '', contactEmail: 'pat@example.invalid' }],
  ['TEL: DSN 555-0101', { contactDetails: '', contactDsn: 'DSN 555-0101' }],
  ['COMM: (202) 555-0100', { contactDetails: 'COMM: (202) 555-0100' }],
])('opens a previously saved draft with legacy contact %s', (contactDetails, migrated) => {
  const old = { ...EMPTY_GENADMIN_DRAFT, contactDetails };
  const { contactDsn: dsn, contactEmail: email, ...legacy } = old;
  expect([dsn, email]).toEqual(['', '']);
  localStorage.setItem(key, JSON.stringify({ version: 1, draft: legacy }));
  expect(readGenadminDraft().draft).toEqual({ ...EMPTY_GENADMIN_DRAFT, ...migrated });
});

it('round trips an incomplete message and removes it upon deliberate discard', async () => {
  const draft = { ...EMPTY_GENADMIN_DRAFT, subject: 'Training message', contactDsn: '555-0100', contactEmail: 'pat@example.invalid', remarks: 'First line\nSecond line' };
  const saved = await writeGenadminDraft(readGenadminDraft(), draft);
  expect(readGenadminDraft().draft).toEqual(draft);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 2, draft });
  await writeGenadminDraft(saved, null);
  expect(readGenadminDraft()).toEqual({ raw: null, draft: EMPTY_GENADMIN_DRAFT });
});

it.each([
  'not JSON',
  JSON.stringify({ version: 3, draft: EMPTY_GENADMIN_DRAFT }),
  JSON.stringify({ version: 2, draft: { ...EMPTY_GENADMIN_DRAFT, contactEmail: undefined } }),
  JSON.stringify({ version: 1, draft: { ...EMPTY_GENADMIN_DRAFT, subject: [] } }),
  JSON.stringify({ version: 1, draft: { ...EMPTY_GENADMIN_DRAFT, remarks: 'x'.repeat(GENADMIN_LIMITS.remarks + 1) } }),
])('protects unreadable local draft data until the user discards it', async raw => {
  localStorage.setItem(key, raw);
  const saved = readGenadminDraft();
  expect(saved).toEqual({ raw, draft: EMPTY_GENADMIN_DRAFT });
  const replacement = { ...EMPTY_GENADMIN_DRAFT, subject: 'Replacement draft' };
  await expect(writeGenadminDraft(saved, replacement)).rejects.toThrow('saved draft could not be read');
  expect(localStorage.getItem(key)).toBe(raw);
  const discarded = await writeGenadminDraft(saved, null);
  await writeGenadminDraft(discarded, replacement);
  expect(readGenadminDraft().draft).toEqual(replacement);
});

it('preserves a saved draft changed by a different tab', async () => {
  const first = readGenadminDraft();
  const next = await writeGenadminDraft(first, { ...EMPTY_GENADMIN_DRAFT, subject: 'Latest saved draft' });
  await expect(writeGenadminDraft(first, null)).rejects.toThrow('changed in another tab');
  await expect(writeGenadminDraft(first, { ...EMPTY_GENADMIN_DRAFT, subject: 'Stale draft' })).rejects.toThrow('changed in another tab');
  expect(readGenadminDraft()).toEqual(next);
});
