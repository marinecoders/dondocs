/**
 * The link that opens a rendered letter in the web editor.
 *
 * The letter travels in the URL's fragment, which no browser sends to a
 * server, and the editor reads it with no password because it never left
 * the machine. What matters here: the payload is the session the app
 * loads, it survives the round trip byte for byte, and a letter that must
 * not sit in a browser's history does not get a link at all.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { editorOrigin, handoffUrl, HANDOFF_HASH_PREFIX } from '../../companion/handoff';
import type { LetterInput } from '../../companion/letterInput';

const ORIGIN = 'https://dondocs.marines.dev';
const LETTER = {
  docType: 'naval_letter',
  subject: 'REQUEST FOR CFT WAIVER',
  from: 'Corporal R. Chiofalo XXXXXXXXXX/0671, USMC',
  to: 'Commanding Officer, Marine Innovation Unit',
  via: ['Detachment Lead'],
  paragraphs: [{ text: 'Body.', level: 0 }, { text: 'A subparagraph.', level: 1 }],
  references: [{ letter: 'a', title: 'MCO 6100.13A' }],
  copyTo: ['Det Lead'],
} as unknown as LetterInput;

/** The session a URL carries, back out again. */
function payloadOf(url: string): Record<string, unknown> {
  const hash = new URL(url).hash;
  expect(hash.startsWith(`#${HANDOFF_HASH_PREFIX}`)).toBe(true);
  const bytes = Buffer.from(hash.slice(1 + HANDOFF_HASH_PREFIX.length), 'base64url');
  return JSON.parse(inflateSync(bytes).toString('utf-8'));
}

describe('the editor handoff link', () => {
  it('carries the session the app loads, at the configured origin', () => {
    const url = handoffUrl(LETTER, {}, ORIGIN)!;
    expect(url.startsWith(`${ORIGIN}/#${HANDOFF_HASH_PREFIX}`)).toBe(true);
    const session = payloadOf(url);
    // The four the app needs and toStore does not emit.
    expect(session).toMatchObject({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter' });
    expect(typeof session.timestamp).toBe('number');
    // And the letter itself, under the names the app's store uses.
    expect((session.formData as Record<string, unknown>).subject).toBe('REQUEST FOR CFT WAIVER');
    expect((session.formData as Record<string, unknown>).from).toBe(LETTER.from);
    expect(session.paragraphs).toEqual([
      expect.objectContaining({ text: 'Body.', level: 0 }),
      expect.objectContaining({ text: 'A subparagraph.', level: 1 }),
    ]);
    expect(session.references).toEqual([{ letter: 'a', title: 'MCO 6100.13A' }]);
    expect(session.copyTos).toEqual([{ text: 'Det Lead' }]);
  });

  it('takes the unit and signer from the machine defaults, as a render does', () => {
    const defaults = { unit: { name: 'MARINE INNOVATION UNIT', line2: 'MARFORRES' }, ssic: '1650' };
    const session = payloadOf(handoffUrl(LETTER, defaults, ORIGIN)!);
    expect(session.formData).toMatchObject({ unitName: 'MARINE INNOVATION UNIT', unitLine2: 'MARFORRES', ssic: '1650' });
  });

  it('trims a trailing slash on the origin rather than doubling it', () => {
    expect(handoffUrl(LETTER, {}, `${ORIGIN}/`)!.startsWith(`${ORIGIN}/#`)).toBe(true);
  });

  it('gives no link when there is no origin to give one for', () => {
    expect(handoffUrl(LETTER, {}, undefined)).toBeUndefined();
    expect(handoffUrl(LETTER, {}, '   ')).toBeUndefined();
  });

  it('takes the origin only when it is a web address', () => {
    expect(editorOrigin(ORIGIN)).toBe(ORIGIN);
    expect(editorOrigin(`${ORIGIN}/`)).toBe(ORIGIN);
    expect(editorOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    // A setting the host never filled in, and schemes the card must not open.
    expect(editorOrigin('${user_config.app_url}')).toBeUndefined();
    expect(editorOrigin('javascript:alert(1)')).toBeUndefined();
    expect(editorOrigin('file:///etc/passwd')).toBeUndefined();
    expect(editorOrigin('dondocs.marines.dev')).toBeUndefined();
    expect(editorOrigin(undefined)).toBeUndefined();
  });

  it('gives no link for a letter that must not sit in a browser history', () => {
    const at = (level: string) => handoffUrl({ ...LETTER, classification: { level } } as LetterInput, {}, ORIGIN);
    expect(at('unclassified')).toBeDefined();
    expect(at('cui')).toBeDefined();
    expect(at('confidential')).toBeUndefined();
    expect(at('secret')).toBeUndefined();
    expect(at('top_secret')).toBeUndefined();
    expect(at('top_secret_sci')).toBeUndefined();
    // A banner of the caller's own says nothing about how high it is.
    expect(handoffUrl({ ...LETTER, classification: { custom: 'NOFORN' } } as LetterInput, {}, ORIGIN)).toBeUndefined();
  });
});
