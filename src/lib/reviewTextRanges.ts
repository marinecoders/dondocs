import { z } from 'zod';
import type { Paragraph } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import type { DocumentFieldSource } from './documentFields';
import { paragraphIdSchema } from './paragraphIdentity';

export const TEXT_RANGE_CONTEXT_LIMIT = 20_000;
/** Offsets use JavaScript/ProseMirror UTF-16 units, but must land on grapheme boundaries. */
export function isTextRangeBoundary(text: string, offset: number): boolean {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) return false;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === text.length) return true;
  // Range validation runs repeatedly while typing. Inspect only the segment at
  // this offset instead of allocating every grapheme in each retained context.
  return new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text).containing(offset)?.index === offset;
}
const position = z.object({ context: z.string().max(TEXT_RANGE_CONTEXT_LIMIT), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();
export const selectedTextRangeSchema = z.object({
  kind: z.literal('range'), paragraphId: paragraphIdSchema, docType: z.string().min(1).max(100),
  context: z.string().max(TEXT_RANGE_CONTEXT_LIMIT), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  tracking: position.optional(), detached: z.literal(true).optional(),
}).strict().superRefine((range, ctx) => {
  for (const value of [range, ...(range.tracking ? [range.tracking] : [])]) {
    if (value.start > value.end || !isTextRangeBoundary(value.context, value.start) || !isTextRangeBoundary(value.context, value.end)) {
      ctx.addIssue({ code: 'custom', message: 'Text range offsets must be ordered grapheme boundaries in the exact context.' });
    }
  }
  if (range.tracking && range.context.slice(range.start, range.end) !== range.tracking.context.slice(range.tracking.start, range.tracking.end)) {
    ctx.addIssue({ code: 'custom', message: 'A tracked range must retain the original selected text.' });
  }
});
export type SelectedTextRange = z.infer<typeof selectedTextRangeSchema>;
export interface TextRangeEdit { from: number; to: number; insert: string }

/** The first release supports a single native paragraph of literal, unformatted text. */
export function supportsPlainTextRange(paragraph: Paragraph): boolean {
  return paragraph.text.length <= TEXT_RANGE_CONTEXT_LIMIT && !/[\r\n*\\]|__|\{\{/.test(paragraph.text)
    && !paragraph.header && !paragraph.portionMarking && !paragraph.figure && !paragraph.tableKey && !paragraph.tableFootnotes?.length
    && !paragraph.callout && !paragraph.procedure && !paragraph.appendix && !paragraph.publicationSection && !paragraph.referenceId;
}
function findParagraph(source: DocumentFieldSource, paragraphId: string): Paragraph | undefined {
  if (source.documentCategory !== 'correspondence' || !Object.hasOwn(DOC_TYPE_CONFIG, source.docType)
    || ['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(source.docType)) return;
  const matches = source.paragraphs?.filter(paragraph => paragraph.id === paragraphId) ?? [];
  return matches.length === 1 && supportsPlainTextRange(matches[0]) ? matches[0] : undefined;
}
export function captureTextRange(source: DocumentFieldSource, paragraphId: string, start: number, end: number,
  options: { allowCaret?: boolean } = {}): SelectedTextRange | null {
  const paragraph = findParagraph(source, paragraphId);
  if (!paragraph || !options.allowCaret && start === end) return null;
  const parsed = selectedTextRangeSchema.safeParse({ kind: 'range', paragraphId, docType: source.docType, context: paragraph.text, start, end });
  return parsed.success ? parsed.data : null;
}
export function resolveTextRange(source: DocumentFieldSource, range: SelectedTextRange): {
  status: 'current' | 'changed' | 'unavailable'; paragraph?: Paragraph; start?: number; end?: number; text?: string;
} {
  const parsed = selectedTextRangeSchema.safeParse(range);
  if (!parsed.success) return { status: 'unavailable' };
  const paragraph = findParagraph(source, range.paragraphId);
  if (!paragraph) return { status: 'unavailable' };
  const current = range.tracking ?? range;
  if (range.detached || source.docType !== range.docType || paragraph.text !== current.context) return { status: 'changed', paragraph };
  return { status: 'current', paragraph, start: current.start, end: current.end, text: paragraph.text.slice(current.start, current.end) };
}
/** Apply a known splice. Edits touching either selection boundary detach conservatively. */
export function transformTextRange(range: SelectedTextRange, before: string, edit: TextRangeEdit): SelectedTextRange {
  const current = range.tracking ?? range;
  const detach = (): SelectedTextRange => ({ ...range, detached: true });
  if (range.detached) return range;
  if (!selectedTextRangeSchema.safeParse(range).success || current.context !== before || edit.from > edit.to
    || !isTextRangeBoundary(before, edit.from) || !isTextRangeBoundary(before, edit.to)) return detach();
  const context = before.slice(0, edit.from) + edit.insert + before.slice(edit.to);
  if (context === before) return range;
  let { start, end } = current;
  if (edit.to < start) { const shift = edit.insert.length - (edit.to - edit.from); start += shift; end += shift; }
  else if (edit.from <= end) return detach();
  const next = { ...range, tracking: { context, start, end } };
  return selectedTextRangeSchema.safeParse(next).success && !/[\r\n*\\]|__|\{\{/.test(context) ? next : detach();
}
/** Derive every equivalent minimal single splice; keep only an unambiguous mapping.
 * Never search for the selection text or infer paragraph identity from its content. */
export function transformTextRangeForText(range: SelectedTextRange, before: string, after: string): SelectedTextRange {
  if (range.detached) return range;
  if (!selectedTextRangeSchema.safeParse(range).success || (range.tracking ?? range).context !== before) return { ...range, detached: true };
  if (before === after) return range;
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  while (suffix < Math.min(before.length, after.length) && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const removed = Math.max(0, before.length - after.length, before.length - prefix - suffix);
  const inserted = after.length - before.length + removed;
  const lower = Math.max(0, before.length - removed - suffix), upper = Math.min(prefix, before.length - removed);
  const candidates = [lower, upper].map(from => transformTextRange(range, before, { from, to: from + removed, insert: after.slice(from, from + inserted) }));
  if (candidates.some(value => value.detached) || JSON.stringify(candidates[0].tracking) !== JSON.stringify(candidates[1].tracking)) return { ...range, detached: true };
  return candidates[0];
}
