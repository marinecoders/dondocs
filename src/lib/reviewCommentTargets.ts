import { documentTextFields, type DocumentFieldSource } from './documentFields';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { COMMENT_LIMITS, type CommentAnchor } from './reviewComments';
import { paragraphIdSchema } from './paragraphIdentity';
import type { Paragraph } from '@/types/document';

const labels: Readonly<Record<string, string>> = {
  subject: 'Subject', from: 'From', to: 'To', via: 'Via', date: 'Date', ssic: 'SSIC', serial: 'Serial',
  sigFirst: 'Signer first name', sigMiddle: 'Signer middle initial', sigLast: 'Signer last name', sigRank: 'Signer rank', sigTitle: 'Signer title',
  unitLine1: 'Unit name', unitLine2: 'Unit line 2', unitAddress: 'Unit address', memorandumFor: 'Memorandum for',
};
export function supportsReviewComments(source: DocumentFieldSource): boolean {
  return source.documentCategory === 'correspondence' && Object.hasOwn(DOC_TYPE_CONFIG, source.docType)
    && !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(source.docType);
}
export function commentFieldLabel(field: string): string {
  return Object.hasOwn(labels, field) ? labels[field] : field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase());
}
export function availableCommentFields(source: DocumentFieldSource): readonly { field: string; label: string; value: string }[] {
  if (!supportsReviewComments(source)) return [];
  return documentTextFields(source, 'output').filter(item => item.role === 'text' && item.path.length === 2
    && item.path[0] === 'formData' && item.path[1] !== 'body' && typeof item.path[1] === 'string'
    && Object.hasOwn(source.formData, item.path[1]))
    .map(item => ({ field: String(item.path[1]), label: commentFieldLabel(String(item.path[1])), value: item.text }));
}
export function paragraphCommentContext(paragraph: Paragraph): string {
  const text = paragraph.header ? `${paragraph.header}\n\n${paragraph.text}` : paragraph.text;
  const markings = [
    ...(paragraph.portionMarking ? [`(${paragraph.portionMarking})`] : []),
    ...(paragraph.figure?.portionMarking ? [`Figure marking: (${paragraph.figure.portionMarking})`] : []),
  ];
  return [...markings, text].join('\n');
}

export function availableCommentParagraphs(source: DocumentFieldSource): readonly { paragraphId: string; label: string; value: string }[] {
  if (!supportsReviewComments(source)) return [];
  const paragraphs = source.paragraphs ?? [];
  const counts = new Map<string, number>();
  for (const paragraph of paragraphs) if (paragraph.id) counts.set(paragraph.id, (counts.get(paragraph.id) ?? 0) + 1);
  return paragraphs.flatMap((paragraph, index) => {
    const value = paragraphCommentContext(paragraph);
    return paragraphIdSchema.safeParse(paragraph.id).success && counts.get(paragraph.id!) === 1 && value.length <= COMMENT_LIMITS.context
      ? [{ paragraphId: paragraph.id!, label: `Paragraph ${index + 1}${paragraph.header ? `: ${paragraph.header.slice(0, 80)}` : ''}`, value }] : [];
  });
}

export function captureCommentAnchor(source: DocumentFieldSource, field?: string, paragraphId?: string): CommentAnchor | null {
  if (!supportsReviewComments(source)) return null;
  if (paragraphId !== undefined) {
    if (field !== undefined) return null;
    const paragraph = availableCommentParagraphs(source).find(item => item.paragraphId === paragraphId);
    return paragraph ? { kind: 'paragraph', paragraphId, context: paragraph.value, docType: source.docType } : null;
  }
  if (field === undefined) return { kind: 'document' };
  const current = availableCommentFields(source).find(item => item.field === field);
  return current ? { kind: 'field', field, context: current.value, docType: source.docType } : null;
}
export function describeCommentAnchor(source: DocumentFieldSource, anchor: CommentAnchor): {
  label: string; status: 'current' | 'changed' | 'unavailable'; current?: string; context?: string;
} {
  if (anchor.kind === 'document') return { label: 'Whole document', status: 'current' };
  if (anchor.kind === 'paragraph') {
    const paragraphs = source.paragraphs ?? [];
    const matches = paragraphs.filter(paragraph => paragraph.id === anchor.paragraphId);
    const paragraph = matches.length === 1 && supportsReviewComments(source) ? matches[0] : undefined;
    const current = paragraph ? paragraphCommentContext(paragraph) : undefined;
    return { label: paragraph ? `Paragraph ${paragraphs.indexOf(paragraph) + 1}` : 'Deleted or unavailable paragraph',
      context: anchor.context, status: current === undefined ? 'unavailable' : current === anchor.context ? 'current' : 'changed',
      ...(current === undefined ? {} : { current }) };
  }
  const current = availableCommentFields(source).find(item => item.field === anchor.field);
  return { label: commentFieldLabel(anchor.field), context: anchor.context,
    status: !current ? 'unavailable' : current.value !== anchor.context || source.docType !== anchor.docType ? 'changed' : 'current',
    ...(current ? { current: current.value } : {}) };
}
