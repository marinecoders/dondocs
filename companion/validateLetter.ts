import { MANUAL_DOC_TYPE } from '../src/data/techpub/manualFrontMatter';
import { manualFrontMatterErrors } from '../src/lib/manualFrontMatterValidation';
import { manualFrontMatterInputSchema } from './manualFrontMatterInput';
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
import { publicationExportErrors, isTechnicalPublication } from '../src/lib/publicationPreflight';
import { publicationInputErrors } from './publicationInput';
import { attachmentSchema } from './publicationSchema';
import { TEMPLATE_FOR, toStore, type CompanionDefaults, type LetterInput } from './letterInput';
import { DOC_TYPE_CONFIG } from '../src/types/document';
import { businessFigureFile } from '../src/lib/figures';

export const DOC_TYPES = [...Object.keys(DOC_TYPE_CONFIG), ...Object.keys(TEMPLATE_FOR)];
export const FORMATS = ['pdf', 'docx'];
export const formatsFor = (docType: string): string[] => isTechnicalPublication(docType) ? ['pdf'] : FORMATS;
/** The levels the generator marks; anything else renders unmarked. */
export const CLASSIFICATION_LEVELS = ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'];
/** Paragraph portion marks, placed in the .tex as given, so nothing else may pass. */
export const PORTION_MARKINGS = ['U', 'CUI', 'FOUO', 'C', 'S', 'TS'] as const;
/** The types whose heading is the ordinal and the letter being endorsed. */
export const ENDORSEMENT_TYPES = ['same_page_endorsement', 'new_page_endorsement'];

/** Return input problems; unexpected validation failures throw a sanitized error. */
export function validateLetter(body: Partial<LetterInput>, defaults: CompanionDefaults = {}): string[] {
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
    ['distribution', body.distribution], ['via', body.via], ['attachments', body.attachments],
  ];
  for (const [name, value] of arrays) {
    if (value !== undefined && !Array.isArray(value)) {
      problems.push(`${name} must be an array, got ${typeof value}`);
    }
  }
  if (problems.some(problem => problem.includes(' must be an array'))) return problems;
  for (const file of body.attachments ?? []) if (!attachmentSchema.safeParse(file).success) problems.push('Attachments require bounded PNG, JPEG or PDF metadata and valid base64 bytes.');
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
  if (problems.length) return problems;

  if (body.docType === MANUAL_DOC_TYPE) {
    if (body.format === 'docx') problems.push('TM/IETM front matter supports PDF only.');
    if (!body.date?.trim()) problems.push('TM/IETM front matter requires an explicit publication date.');
    const parsed = manualFrontMatterInputSchema.safeParse(body.manualFrontMatter);
    if (!parsed.success) problems.push('Supply valid manualFrontMatter metadata, including a supported subtype.');
    if (body.paragraphs?.length || body.enclosures?.length || body.references?.length || body.copyTo?.length || body.distribution?.length || body.publication || body.attachments?.length)
      problems.push('TM/IETM front matter uses its structured metadata, without body paragraphs, references, enclosures or I-Type tables.');
    if (body.classification?.cui?.distStatement && parsed.success && body.classification.cui.distStatement !== parsed.data.distribution.statement)
      problems.push('Classification and manual distribution statements must agree.');
    if (!problems.length) {
      try { problems.push(...manualFrontMatterErrors(toStore(body as LetterInput, defaults))); }
      catch (error) {
        console.error('  manual front-matter validation failed:', error);
        throw new Error('Could not validate manual front matter. Check the companion logs for details.', { cause: error });
      }
    }
    return problems;
  }
  if (body.manualFrontMatter) problems.push('Manual front-matter metadata requires docType tm_ietm_front_matter.');
  if (isTechnicalPublication(body.docType ?? '')) {
    const label = body.docType === 'sl4' ? 'SL-4' : body.docType === 'sl3' ? 'SL-3' : 'I-Type';
    if (body.format === 'docx') problems.push(`${label} export supports PDF only.`);
    if (!body.publication) problems.push(`${label} export requires publication metadata.`);
    if (body.classification?.cui?.distStatement && body.publication
      && body.classification.cui.distStatement !== body.publication.distribution.statement) {
      problems.push('Classification and publication distribution statements must agree.');
    }
    if (!problems.length) {
      try {
        const input = body as LetterInput;
        problems.push(...publicationInputErrors(input));
        if (!problems.length) problems.push(...publicationExportErrors(toStore(input, defaults)));
      } catch (error) {
        console.error('  publication validation failed:', error);
        throw new Error('Could not validate publication metadata. Check the companion logs for details.', { cause: error });
      }
    }
  } else if (body.publication || (Array.isArray(body.enclosures) && body.enclosures.some((e) => e?.fileId))
    || (Array.isArray(body.paragraphs) && body.paragraphs.some((p) => (p?.figure && body.docType !== 'business_letter') || p?.tableKey || p?.publicationSection || p?.callout || p?.procedure || p?.appendix))) {
    problems.push('Publication fields and attachments require docType i_type, sl3 or sl4.');
  }
  if (!isTechnicalPublication(body.docType ?? '')) {
    const input = body as LetterInput;
    problems.push(...publicationInputErrors(input));
    const used = new Set((body.paragraphs ?? []).flatMap(p => p.figure ? [p.figure.fileId] : []));
    if (body.signature?.imageFileId) used.add(body.signature.imageFileId);
    for (const file of body.attachments ?? []) if (!used.has(file.id)) problems.push(`Attachment "${file.id}" is not used by a signature or business-letter figure.`);
  }
  if (body.signature?.imageFileId) {
    const file = body.attachments?.find(file => file.id === body.signature!.imageFileId);
    if (!file) problems.push(`Signature attachment "${body.signature.imageFileId}" is missing.`);
    else if (file.mimeType !== 'image/png') problems.push('Signature images require a PNG attachment.');
    if (DOC_TYPE_CONFIG[body.docType ?? '']?.signature === 'dual' || body.docType === 'information_memorandum' || isTechnicalPublication(body.docType ?? '')) problems.push('Signature images require supported single-signer correspondence.');
  }
  if (body.docType === 'business_letter' && body.format !== 'docx') {
    for (const [index, paragraph] of (body.paragraphs ?? []).entries()) {
      if (!paragraph.figure) continue;
      const file = body.attachments?.find(file => file.id === paragraph.figure!.fileId);
      try { businessFigureFile(index + 1, file?.mimeType, file?.name, paragraph.figure.fileId); }
      catch (error) { problems.push(error instanceof Error ? error.message : 'Use a shorter figure attachment ID.'); }
    }
  }
  return problems;
}
