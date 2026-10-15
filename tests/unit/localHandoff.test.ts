/**
 * Reading a letter handed over from the companion in the URL fragment.
 *
 * The fixture below was produced by the companion's own encoder
 * (`companion/handoff.ts`), so both sides are checked against one byte
 * string rather than against each other's idea of the format.
 */
import { describe, it, expect } from 'vitest';
import { decodeHandoff, parseHandoffUrl, HANDOFF_HASH_PREFIX } from '@/lib/localHandoff';

const PAYLOAD = 'eJw9jsFKxEAMhl-l5FyW9SCF3rTuggcRa9WDiGTbdHdkZjJk0sVS-u5O12pO883__SETdNwOjrw-cEdQQssuWINeIf-PKlQ6soyXWIRiYN-Rbyk5PYtrxpCqfrD20vlF8HhG-2lJlWQV71ARygnicPiiVpNU755eds9Ntn-ss2rfZG8396-7etGFXcqrYLN6k1Unwz1ahjmHgIJHwXCKUL5PoPS9LLrlbtyknqUzWSi380cOQj3JcudiJk5Py3GQP245jA2v0JmoYg6DGvbrlxpHUdEFKK-K66LYrjP_ALldZ8I';

describe('a letter handed over in the URL', () => {
  it('takes the payload from the fragment, and only its own', () => {
    expect(parseHandoffUrl(`https://dondocs.marines.dev/#${HANDOFF_HASH_PREFIX}abc`)).toBe('abc');
    expect(parseHandoffUrl(`#${HANDOFF_HASH_PREFIX}abc`)).toBe('abc');
    // A share link is somebody else's format, and neither is a bare page.
    expect(parseHandoffUrl('https://dondocs.marines.dev/#s=abc')).toBeNull();
    expect(parseHandoffUrl('https://dondocs.marines.dev/')).toBeNull();
    expect(parseHandoffUrl('')).toBeNull();
  });

  it('reads what the companion wrote', () => {
    const session = decodeHandoff(PAYLOAD);
    expect(session).toMatchObject({
      documentMode: 'compliant',
      documentCategory: 'correspondence',
      docType: 'naval_letter',
    });
    expect(session!.formData).toMatchObject({ subject: 'REQUEST FOR CFT WAIVER', from: 'Cpl R. Chiofalo' });
    expect(session!.paragraphs).toEqual([{ text: 'Body.', level: 0 }]);
  });

  it('answers null for a payload it cannot trust, rather than a half-loaded editor', () => {
    expect(decodeHandoff(PAYLOAD.slice(0, 40))).toBeNull();
    expect(decodeHandoff('not base64url at all !!')).toBeNull();
    expect(decodeHandoff('')).toBeNull();
    // Well-formed deflate, but not a session: no paragraphs, no docType.
    const notASession = 'eJyrVkpKLE5NUbJSSkosSU1RqgUAOwUFEA';
    expect(decodeHandoff(notASession)).toBeNull();
  });
});
