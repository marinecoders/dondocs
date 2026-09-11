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
import { TEMPLATE_FOR, type LetterInput } from './letterInput';
import { DOC_TYPE_CONFIG } from '../src/types/document';

/**
 * Every doc type the app defines, plus the friendly aliases `templateFor`
 * translates. Derived so the companion cannot advertise a type the app lacks or
 * lag behind one it gains; the tool schema's enum derives from this in turn.
 */
export const DOC_TYPES = [...Object.keys(DOC_TYPE_CONFIG), ...Object.keys(TEMPLATE_FOR)];
export const FORMATS = ['pdf', 'docx'];
/** The levels the generator marks; anything else renders unmarked. */
export const CLASSIFICATION_LEVELS = ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'];
/** Paragraph portion marks, placed in the .tex as given, so nothing else may pass. */
export const PORTION_MARKINGS = ['U', 'CUI', 'FOUO', 'C', 'S', 'TS'];
/** The types whose heading is the ordinal and the letter being endorsed. */
export const ENDORSEMENT_TYPES = ['same_page_endorsement', 'new_page_endorsement'];

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
      if (para?.portionMarking !== undefined && !PORTION_MARKINGS.includes(para.portionMarking)) {
        problems.push(`paragraphs[${i}].portionMarking must be one of ${PORTION_MARKINGS.join(', ')}`);
      }
    });
  }
  for (const [name, value] of [['unit', body.unit], ['signature', body.signature]] as const) {
    if (value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
      problems.push(`${name} must be an object`);
    }
  }
  // Refused here rather than at the write, after a full render, with an errno.
  if (body.out !== undefined) {
    if (typeof body.out !== 'string') { problems.push('out must be a string'); }
    else if (body.out.includes('\0')) { problems.push('out must not contain a NUL byte'); }
    else if (body.out.split(/[/\\]/).some((part) => Buffer.byteLength(part) > 255)) {
      problems.push('out: no path component may exceed 255 bytes');
    }
  }
  // A bare "ENDORSEMENT" heading looks rendered and says nothing.
  if (ENDORSEMENT_TYPES.includes(body.docType as string)
    && !(body.endorsement?.ordinal && body.endorsement?.basicLetterId)) {
    problems.push(`${body.docType} needs endorsement.ordinal (FIRST, SECOND ...) and endorsement.basicLetterId, the letter being endorsed`);
  }
  const level = body.classification?.level;
  if (level !== undefined && !CLASSIFICATION_LEVELS.includes(level)) {
    problems.push(`classification.level must be one of ${CLASSIFICATION_LEVELS.join(', ')}`);
  }
  // The generator prints either the level's marking or the custom text.
  if (level && body.classification?.custom) {
    problems.push('classification.custom is the banner itself; give it instead of classification.level');
  }

  // A letter with neither a subject nor a body renders a page with a letterhead
  // and nothing else. Refusing beats handing back a blank document that looks
  // like it worked.
  if (!body.paragraphs?.length && !body.subject) {
    problems.push('nothing to render: supply at least a subject or one paragraph');
  }

  return problems;
}
