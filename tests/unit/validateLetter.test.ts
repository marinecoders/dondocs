/**
 * The rules both transports enforce.
 *
 * These were only reachable through a running HTTP server or a spawned MCP
 * process, which is backwards: the shared rules deserve the cheapest test and
 * the transports should only have to prove they call them. The rule set exists
 * because the two once diverged — MCP had no emptiness check and returned a
 * letterhead over a blank page as a success.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { validateLetter, DOC_TYPES, FORMATS } from '../../companion/validateLetter';

const OK = { docType: 'naval_letter', subject: 'SUBJECT' } as const;

describe('docType', () => {
  it.each(DOC_TYPES)('accepts %s', (docType) => {
    expect(validateLetter({ ...OK, docType })).toEqual([]);
  });

  it('names the offending value and the allowed set', () => {
    const [problem] = validateLetter({ ...OK, docType: 'invoice' });
    expect(problem).toContain('"invoice"');
    // A caller that cannot see the options has to guess.
    for (const t of DOC_TYPES) { expect(problem).toContain(t); }
  });

  it('rejects a missing docType', () => {
    expect(validateLetter({ subject: 'S' }).join(' ')).toMatch(/unknown docType/);
  });
});

describe('format', () => {
  it.each(FORMATS)('accepts %s', (format) => {
    expect(validateLetter({ ...OK, format: format as 'pdf' | 'docx' })).toEqual([]);
  });

  it('treats an omitted format as valid — pdf is the default', () => {
    expect(validateLetter(OK)).toEqual([]);
  });

  it('rejects an unsupported format', () => {
    expect(validateLetter({ ...OK, format: 'rtf' as never }).join(' ')).toMatch(/unknown format "rtf"/);
  });
});

describe('nothing to render', () => {
  // The rule MCP was missing. A letter with neither is a blank page.
  it('refuses a request with no subject and no paragraphs', () => {
    expect(validateLetter({ docType: 'naval_letter' }).join(' ')).toMatch(/nothing to render/);
  });

  it('accepts a subject alone', () => {
    expect(validateLetter({ docType: 'naval_letter', subject: 'S' })).toEqual([]);
  });

  it('accepts a paragraph alone', () => {
    expect(validateLetter({ docType: 'naval_letter', paragraphs: [{ text: 'Body.' }] })).toEqual([]);
  });

  it('treats an empty paragraph array as nothing', () => {
    expect(validateLetter({ docType: 'naval_letter', paragraphs: [] }).join(' ')).toMatch(/nothing to render/);
  });
});

describe('collection shapes', () => {
  // Without these a string where an array belongs reaches the generator and
  // surfaces as a 500 — blaming us for the caller's mistake.
  it.each(['paragraphs', 'references', 'enclosures', 'copyTo', 'distribution', 'via'])(
    'rejects a string where %s should be an array', (field) => {
      const problems = validateLetter({ ...OK, [field]: 'not an array' } as never);
      expect(problems.join(' ')).toMatch(new RegExp(`${field} must be an array, got string`));
    });

  it.each(['unit', 'signature', 'formData'])('rejects an array where %s should be an object', (field) => {
    expect(validateLetter({ ...OK, [field]: [] } as never).join(' ')).toMatch(`${field} must be an object`);
  });

  it('names the index of a bad paragraph', () => {
    const problems = validateLetter({
      ...OK, paragraphs: [{ text: 'fine' }, { text: 42 }, { text: 'also fine' }],
    } as never);
    expect(problems.join(' ')).toMatch(/paragraphs\[1\]\.text must be a string/);
    expect(problems.join(' ')).not.toMatch(/paragraphs\[0\]/);
  });
});

describe('reporting', () => {
  it('returns every problem at once, not the first', () => {
    // One round-trip should be enough for a caller to fix its request.
    const problems = validateLetter({ docType: 'invoice', format: 'rtf', paragraphs: 'no' } as never);
    expect(problems.join(' ')).toMatch(/unknown docType/);
    expect(problems.join(' ')).toMatch(/unknown format/);
    expect(problems.join(' ')).toMatch(/paragraphs must be an array/);
  });

  it('does not also claim "nothing to render" when paragraphs is a string', () => {
    // The emptiness check reads `paragraphs?.length`, and a string has one. The
    // shape rule already rejects the request, so the caller gets one accurate
    // complaint instead of a contradictory pair.
    const problems = validateLetter({ docType: 'naval_letter', paragraphs: 'no' } as never);
    expect(problems.join(' ')).toMatch(/paragraphs must be an array/);
    expect(problems.join(' ')).not.toMatch(/nothing to render/);
  });

  it('returns an empty array for a valid request, never null', () => {
    const problems = validateLetter(OK);
    expect(Array.isArray(problems)).toBe(true);
    expect(problems).toHaveLength(0);
  });
});
