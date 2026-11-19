import type { DocumentSnapshot } from '@/stores/historyStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentOutputConfig } from './documentOutputConfig';
import { documentTextFields } from './documentFields';
import { getEditorSections } from './editorSections';
import { formattingFindings } from './formattingFindings';
import { validateParagraphStructure } from './paragraphStructureValidation';
import { findUndefinedAcronyms } from './acronyms';
import { validateClassificationMarkings, validateDistributionFillIns, validateDistributionStatement, validateReasonForStatement } from './classificationValidation';
import { canReviewReferenceOrder, planFirstCitationOrder } from './referenceCitations';
import { detectDocumentTextPII, getPIITypeLabel } from '@/services/pii/detector';

export type ProofreadSource = Pick<DocumentSnapshot, 'documentCategory' | 'documentMode' | 'docType' | 'formData' | 'paragraphs' | 'references' | 'enclosures' | 'copyTos' | 'distributions'>
  & Partial<Pick<DocumentSnapshot, 'endItems' | 'publicationTables'>>;

export interface ProofreadFinding {
  id: string;
  group: 'required' | 'formatting' | 'structure' | 'references' | 'markings' | 'acronyms' | 'privacy';
  /** Describes the finding, not a new export gate. Existing validators retain their authority. */
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  target: { sectionId: string; field?: string; paragraphId?: string };
  source?: { chapter: number; paragraph?: string; query?: string };
}

export const PROOFREAD_GROUPS: Readonly<Record<ProofreadFinding['group'], string>> = {
  required: 'Required fields', formatting: 'Formatting', structure: 'Paragraph structure',
  references: 'References', markings: 'Markings', acronyms: 'Abbreviations', privacy: 'Sensitive text',
};

/** Stable local keys without retaining document text in DOM identifiers. */
function key(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

/** Collect existing check results. This function never changes a draft or export policy. */
export function collectProofreadFindings(
  source: ProofreadSource,
  missingSections: readonly { id: string; label: string }[] = [],
  additional: readonly ProofreadFinding[] = [],
): ProofreadFinding[] {
  const findings: ProofreadFinding[] = missingSections.map(section => ({
    id: `required:${section.id}`, group: 'required', severity: 'warning', title: `${section.label} needs attention`,
    message: 'Complete the required fields identified in this editor section.', target: { sectionId: section.id },
  }));
  if (source.documentCategory !== 'correspondence' || !Object.hasOwn(DOC_TYPE_CONFIG, source.docType)) return findings;
  const config = documentOutputConfig(source.docType, source.documentMode);
  const sections = getEditorSections(config, source.docType);
  const has = (id: string) => sections.some(section => section.id === id);
  for (const section of sections) {
    for (const finding of formattingFindings({ ...source, documentCategory: 'correspondence' }, section.id)) findings.push({
      id: `formatting:${finding.field}`, group: 'formatting', severity: 'warning', title: finding.label,
      message: finding.message, target: { sectionId: section.id, field: finding.field },
    });
  }
  if (has('body')) {
    if (config.compliance.numberedParagraphs) for (const finding of validateParagraphStructure(source.paragraphs)) findings.push({
      id: `structure:${key(finding.message)}`, group: 'structure', severity: 'warning', title: 'Check paragraph structure',
      message: finding.message, target: { sectionId: 'body' }, source: { chapter: 7, paragraph: '13' },
    });
    const body = source.paragraphs.map(paragraph => paragraph.text ?? '').join('\n');
    for (const finding of findUndefinedAcronyms(body, { strict: source.docType === 'i_type' })) {
      let start = 0;
      const paragraph = source.paragraphs.find(item => { const end = start + item.text.length;const matches = finding.index >= start && finding.index <= end;start = end + 1;return matches; });
      findings.push({ id: `acronym:${finding.acronym}`, group: 'acronyms', severity: 'warning', title: `Define ${finding.acronym} on first use`,
        message: 'Spell out the term with its abbreviation in parentheses at its first use. Review the context before changing it.',
        target: { sectionId: 'body', paragraphId: paragraph?.id }, source: { chapter: 2, paragraph: '17' } });
    }
  }
  if (has('classification')) {
    const level = source.formData.classLevel || 'unclassified';
    const marking = validateClassificationMarkings(level, source.paragraphs);
    if (['i_type', 'sl3', 'sl4'].includes(source.docType)) marking.push(
      ...validateDistributionStatement(level, source.formData.cuiDistStatement),
      ...validateDistributionFillIns(source.formData.cuiDistStatement, { reason: source.formData.distReason, date: source.formData.distDate, office: source.formData.controllingOffice }),
      ...validateReasonForStatement(source.formData.cuiDistStatement, source.formData.distReason),
    );
    for (const finding of marking) findings.push({ id: `marking:${key(finding.message)}`, group: 'markings', severity: finding.severity,
      title: 'Review document markings', message: finding.message, target: { sectionId: 'classification' } });
  }
  if (has('references') && canReviewReferenceOrder(source)) {
    const plan = planFirstCitationOrder(source);
    for (const message of [...new Set([...plan.blockers, ...plan.advisories])]) findings.push({ id: `reference:${key(message)}`,
      group: 'references', severity: 'warning', title: 'Review reference citations', message, target: { sectionId: 'references' }, source: { chapter: 7 } });
    if (plan.changed && !plan.blockers.length) findings.push({ id: 'reference:first-citation-order', group: 'references', severity: 'warning',
      title: 'Review reference order', message: 'The reference list differs from the existing first-citation ordering proposal. Review the before/after changes in References.',
      target: { sectionId: 'references' }, source: { chapter: 7 } });
  }
  for (const field of documentTextFields(source, 'output').filter(field => field.role === 'text')) {
    const detected = detectDocumentTextPII([field]);
    const root = field.path[0], fieldId = field.path[1];
    const sectionId = root === 'paragraphs' ? 'body' : root === 'references' ? 'references' : root === 'enclosures' ? 'enclosures'
      : root === 'copyTos' ? 'copyto' : root === 'distributions' ? 'distribution'
        : typeof fieldId === 'string' && /^sig/.test(fieldId) ? 'signature' : 'addressing';
    const destination = has(sectionId) ? sectionId : sections[0]?.id;
    if (!destination) continue;
    for (const type of new Set(detected.findings.map(finding => finding.type))) findings.push({ id: `privacy:${key(JSON.stringify(field.path))}:${type}`,
      group: 'privacy', severity: 'warning', title: `${getPIITypeLabel(type)} pattern in ${field.label}`,
      message: 'Review whether this text belongs in the document and its intended delivery. A pattern match is not a determination of sensitive content.',
      target: { sectionId: destination, ...(root === 'formData' && typeof fieldId === 'string' ? { field: fieldId } : {}),
        ...(root === 'paragraphs' && typeof fieldId === 'number' ? { paragraphId: source.paragraphs[fieldId]?.id } : {}) } });
  }
  const byId = new Map(findings.map(finding => [finding.id, finding]));
  for (const finding of additional) if (has(finding.target.sectionId) && !byId.has(finding.id)) byId.set(finding.id, finding);
  return [...byId.values()];
}
