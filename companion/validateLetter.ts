/**
 * What makes a letter request renderable, independent of how it arrived.
 *
 * Both transports enforce these. Keeping them here rather than in the HTTP
 * handler is the point: the MCP path used to skip the emptiness check entirely
 * and would happily render a letter with no subject and no body, which is a
 * blank page dressed up as a success.
 *
 * Transport-specific concerns stay out — the HTTP contract version belongs to
 * HTTP, and MCP gets argument types from its published schema.
 */
import type { LetterInput } from './letterInput';

export const DOC_TYPES = ['naval_letter', 'standard_letter', 'memorandum'];
export const FORMATS = ['pdf', 'docx'];

/** Everything wrong with a request, so one round-trip is enough to fix it. */
export function validateLetter(body: Partial<LetterInput>): string[] {
  const problems: string[] = [];

  if (!DOC_TYPES.includes(body.docType as string)) {
    problems.push(`unknown docType ${JSON.stringify(body.docType)}; expected one of ${DOC_TYPES.join(', ')}`);
  }
  if (body.format !== undefined && !FORMATS.includes(body.format)) {
    problems.push(`unknown format ${JSON.stringify(body.format)}; expected pdf or docx`);
  }

  // Shape-check the collections. Without this a string where an array belongs
  // reaches the generator and surfaces as a 500 — telling the caller it is our
  // fault when the request is simply wrong.
  const arrays: Array<[string, unknown]> = [
    ['paragraphs', body.paragraphs], ['references', body.references],
    ['enclosures', body.enclosures], ['copyTo', body.copyTo],
    ['distribution', body.distribution], ['via', body.via],
  ];
  for (const [name, value] of arrays) {
    if (value !== undefined && !Array.isArray(value)) {
      problems.push(`${name} must be an array, got ${typeof value}`);
    }
  }
  if (Array.isArray(body.paragraphs)) {
    body.paragraphs.forEach((para, i) => {
      if (typeof para?.text !== 'string') { problems.push(`paragraphs[${i}].text must be a string`); }
    });
  }
  for (const [name, value] of [['unit', body.unit], ['signature', body.signature], ['formData', body.formData]] as const) {
    if (value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
      problems.push(`${name} must be an object`);
    }
  }

  // A letter with neither a subject nor a body renders a page with a letterhead
  // and nothing else. Refusing beats handing back a blank document that looks
  // like it worked.
  if (!body.paragraphs?.length && !body.subject) {
    problems.push('nothing to render: supply at least a subject or one paragraph');
  }

  return problems;
}
