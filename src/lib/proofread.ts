import type { DocumentSnapshot } from '@/stores/historyStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentOutputConfig } from './documentOutputConfig';
import type { FieldPath } from './documentFields';
import { getEditorSections } from './editorSections';
import { formattingFindings } from './formattingFindings';
import { validateParagraphStructure } from './paragraphStructureValidation';
import { findUndefinedAcronyms } from './acronyms';
import { validateClassificationMarkings, validateDistributionFillIns, validateDistributionStatement, validateReasonForStatement } from './classificationValidation';
import { canReviewReferenceOrder, planFirstCitationOrder } from './referenceCitations';
import { detectDocumentTextPII, getPIITypeLabel } from '@/services/pii/detector';
import { proofreadFieldControl, proofreadOutputFields } from './proofreadOutputFields';
import { cuiTransmittalIssue, inspectEnclosureMarkings } from './enclosureMarkings';
import { deriveOverallClassLevel } from './overallClassification';
import { correspondencePortions } from './renderedDocument';
import { inspectCuiRegistryMarkings } from './cuiRegistryMarkings';

export type ProofreadSource = Pick<DocumentSnapshot, 'documentCategory' | 'documentMode' | 'docType' | 'formData' | 'paragraphs' | 'references' | 'enclosures' | 'copyTos' | 'distributions'>
  & Partial<Pick<DocumentSnapshot, 'endItems' | 'publicationTables'>>;

export interface ProofreadFinding {
  id: string;
  group: 'required' | 'formatting' | 'structure' | 'references' | 'markings' | 'acronyms' | 'privacy' | 'spelling';
  /** Describes the finding, not a new export gate. Existing validators retain their authority. */
  severity: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  target: { sectionId: string; field?: string; paragraphId?: string; paragraphPath?: FieldPath; textSelection?: { text: string; offset: number } };
  source?: { chapter: number; paragraph?: string; query?: string };
}

export const PROOFREAD_GROUPS: Readonly<Record<ProofreadFinding['group'], string>> = {
  required: 'Required fields', formatting: 'Formatting', structure: 'Paragraph structure',
  references: 'References', markings: 'Markings', acronyms: 'Abbreviations', spelling: 'Spelling', privacy: 'Sensitive text',
};

/** Stable local keys without retaining document text in DOM identifiers. */
function key(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

/** Route projected text to the editor that owns it; nested publication data has its own outline. */
function textSection(path: FieldPath, docType: string, has: (id: string) => boolean): string | undefined {
  const [root, field, nested] = path;
  const first = (...ids: string[]) => ids.find(has);
  if (root === 'paragraphs') return first('body', 'sl3-figures', 'sl4-figures');
  if (root === 'references') return first('references');
  if (root === 'enclosures') return first('enclosures');
  if (root === 'copyTos') return first('copyto');
  if (root === 'distributions') return first('distribution');
  if (root === 'publicationTables') return first('tables');
  if (root === 'endItems') return first('sl3-cover', 'sl4-cover', 'cover');
  if (root !== 'formData' || typeof field !== 'string') return undefined;
  if (field === 'sl3') {
    if (nested === 'components' || nested === 'fieldingPlanReference') return 'sl3-inventory';
    if (nested === 'artwork') return 'sl3-figures';
    return 'sl3-details';
  }
  if (field === 'sl4') {
    const destinations: Record<string, string> = {
      rows: 'sl4-parts', cages: 'sl4-cages', revisions: 'sl4-revisions',
      circuitIndex: 'sl4-indexes', artwork: 'sl4-figures',
    };
    return destinations[String(nested)] ?? 'sl4-preface';
  }
  if (docType === 'tm_ietm_front_matter') {
    if (field === 'manualFrontMatter') {
      if (nested === 'endItems') return 'manual-items';
      if (nested === 'contentContact' || nested === 'authorityReference') return 'manual-authentication';
      if (['volumeNotice', 'supplementNotice', 'copyrightCredit', 'governmentRights'].includes(String(nested))) return 'manual-notices';
      return 'manual-publication';
    }
    if (/^(cui|dist)/.test(field) || field === 'pocEmail' || field === 'supersedure') return 'manual-notices';
    if (/^(unit|sig)/.test(field) || field === 'controllingOffice') return 'manual-authentication';
    return 'manual-publication';
  }
  if (/^(cui|class|customClass|derivedFrom|declassifyOn|distReason|distDate)/.test(field)) return first('classification');
  if (field.startsWith('joint')) return first('joint_memo', 'joint');
  if (/^(senior|junior|moa)/.test(field)) return first('moa');
  // Stock-list publications collect their program-office contact on the cover.
  if (field === 'pocEmail' && (docType === 'sl3' || docType === 'sl4')) return first(`${docType}-cover`);
  if (field === 'endorsementOrdinal') return first('basic');
  if (field === 'pocEmail') return first('signature', 'classification');
  if (/^(sig|endorsement)/.test(field) || ['additionalEndorsements', 'complimentaryClose', 'officeCode', 'pocEmail'].includes(field)) {
    return first('signature', 'moa', 'joint_memo', 'joint', 'executive', 'classification');
  }
  if (field.startsWith('basicLetter')) return first('basic');
  if (['shortTitle', 'pcn', 'nomenclature', 'controllingOffice', 'supersedure', 'publicationSigningDate', 'publicationClosedDates', 'miCompletionDate'].includes(field)) return first('sl3-cover', 'sl4-cover', 'cover');
  if (/^unit/.test(field) || field === 'inReplyToText') return first('letterhead', 'sl3-cover', 'sl4-cover', 'cover');
  return first('addressing', 'executive', 'joint_memo', 'joint', 'moa', 'cover', 'sl3-cover', 'sl4-cover');
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
  const portions = correspondencePortions(source);
  const transmittalIssue = cuiTransmittalIssue(source.formData, portions, source.enclosures, source.docType);
  if (has('enclosures') && transmittalIssue) findings.push({ id: 'enclosure-marking:transmittal', group: 'markings', severity: 'warning',
    title: 'Review the transmittal note', message: transmittalIssue, target: { sectionId: 'enclosures', field: 'cuiTransmittalNote' } });
  const overallLevel = deriveOverallClassLevel(source.formData.classLevel, portions);
  if (has('enclosures')) {
    for (const issue of inspectEnclosureMarkings({ ...source.formData, classLevel: overallLevel }, source.enclosures)) {
      findings.push({ id: `enclosure-marking:${issue.index}:${issue.kind}`, group: 'markings', severity: 'warning',
        title: `Review enclosure (${issue.index + 1}) marking`, message: issue.message,
        target: { sectionId: 'enclosures', field: `enclosure-marking-${issue.index}` } });
    }
    for (const [index, enclosure] of source.enclosures.entries()) if (enclosure.marking?.classLevel === 'cui') {
      for (const issue of inspectCuiRegistryMarkings(enclosure.marking).issues) findings.push({
        id: `enclosure-registry:${index}:${issue.field}`, group: 'markings', severity: 'error',
        title: `Verify enclosure (${index + 1}) CUI markings`, message: issue.message,
        target: { sectionId: 'enclosures', field: `enclosure-marking-${index}-${issue.field === 'cuiCategory' ? 'category' : 'controls'}` },
      });
    }
  }
  if (overallLevel === 'cui') for (const issue of inspectCuiRegistryMarkings(source.formData).issues) {
    const sectionId = textSection(['formData', issue.field], source.docType, has);
    if (sectionId) findings.push({
      id: `cui-registry:${issue.field}`, group: 'markings', severity: 'error', title: 'Verify CUI markings',
      message: issue.message, target: { sectionId, field: sectionId === 'manual-notices' ? `manual-${issue.field}` : issue.field },
    });
  }
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
  for (const field of proofreadOutputFields(source).filter(field => field.role === 'text')) {
    const detected = detectDocumentTextPII([field]);
    const root = field.path[0], fieldId = field.path[1];
    const destination = textSection(field.path, source.docType, has);
    if (!destination) continue;
    const identity = root === 'paragraphs' && typeof fieldId === 'number' && source.paragraphs[fieldId]?.id
      ? [root, source.paragraphs[fieldId].id, ...field.path.slice(2)] : field.path;
    for (const type of new Set(detected.findings.map(finding => finding.type))) findings.push({ id: `privacy:${key(JSON.stringify(identity))}:${type}`,
      group: 'privacy', severity: 'warning', title: `${getPIITypeLabel(type)} pattern in ${field.label}`,
      message: 'Review whether this text belongs in the document and its intended delivery. A pattern match is not a determination of sensitive content.',
      target: { sectionId: destination, ...(root === 'formData' && typeof fieldId === 'string' ? { field: fieldId === 'pocEmail' && destination === 'classification' && source.formData.classLevel === 'cui' ? 'cuiPocEmail' : proofreadFieldControl(source, fieldId) } : {}),
        ...(root === 'paragraphs' && typeof fieldId === 'number' ? { paragraphId: source.paragraphs[fieldId]?.id, paragraphPath: field.path.slice(2) } : {}) } });
  }
  const byId = new Map(findings.map(finding => [finding.id, finding]));
  for (const finding of additional) if (has(finding.target.sectionId) && !byId.has(finding.id)) byId.set(finding.id, finding);
  return [...byId.values()];
}
