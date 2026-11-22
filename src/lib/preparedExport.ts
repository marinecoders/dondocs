import { stationeryIssues } from './stationery';
import { taggedCorrespondenceIssues } from '@/services/pdf/accessibility/preflight';
import { jointLetterCommandIssues } from './jointLetterCommands';
import { projectRenderedDocument, correspondencePortions } from './renderedDocument';
import { validateAnswers, diagnosticText } from '@/services/forms/model';
import { copyFormExportTemplates, type FormExportTemplates } from './formExportTemplates';
import { captureDocumentRevision, copyCapturedDocument, type CapturedDocument, type CapturedSource } from './capturedDocument';
import { capturedCapabilities } from './documentCapabilities';
import { mapCapturedText } from './documentFields';
import { buildNavmc11811DefaultValues, replacePlaceholders, type PlaceholderValues } from './placeholders';
import { assertExportDeploymentPolicy, type ExportDeploymentPolicy, type PolicyResolution } from './exportDeploymentPolicy';
import { classificationRank, deriveOverallClassLevel } from './overallClassification';
import { classificationBannerLevel, detectClassification } from './detectClassification';
import { publicationMarking } from './publicationMarking';
import { publicationExportErrors } from './publicationPreflight';
import { publicationWordExportErrors } from './publicationWordPreflight';
import { validateParagraphStructure, type ParagraphStructureFinding } from './paragraphStructureValidation';
import { detectCapturedPII, mergePIIResults, type PIIDetectionResult } from '@/services/pii/detector';
import { detectBatchPII } from '@/services/pii/batchScan';
import type { ClassificationInfo } from '@/services/pdf/mergeEnclosures';
import type { ClassificationLevel } from './domainClassification';
import { assertEnclosureMarkingPolicy, cuiTransmittalIssue, inspectEnclosureMarkings } from './enclosureMarkings';

export type ExportTarget = 'pdf' | 'docx' | 'tex';
const preparedBrand = Symbol('prepared-export');
const readyBrand = Symbol('ready-export');
export interface PreparedExportJob {
  readonly [preparedBrand]: true;
  readonly id: string;
  readonly source: CapturedSource;
  readonly kind: CapturedDocument['kind'];
  readonly target: ExportTarget;
  readonly texMode?: 'configuration' | 'flat';
  readonly pdfAccessibility?: 'tagged';
  readonly wordEnclosurePages?: boolean;
  readonly filename: string;
  readonly policyIdentity: string;
}
export interface ReadyExportJob { readonly [readyBrand]: true; readonly job: PreparedExportJob }
export interface ExportReview {
  privacy: PIIDetectionResult;
  structure: ParagraphStructureFinding[];
  notices: string[];
  markingReview: boolean;
}
interface PreparedContent {
  captured: CapturedDocument;
  policy: ExportDeploymentPolicy;
  marking: ClassificationInfo | undefined;
  review: ExportReview;
  formTemplates?: FormExportTemplates;
}
const prepared = new WeakMap<PreparedExportJob, PreparedContent>();
const authorized = new WeakSet<ReadyExportJob>();
export type ExportPreparation =
  | { readonly status: 'ready'; readonly job: ReadyExportJob }
  | { readonly status: 'needs-review'; readonly job: PreparedExportJob }
  | { readonly status: 'not-ready' | 'error'; readonly issues: readonly string[] };

function content(job: PreparedExportJob): PreparedContent {
  const data = prepared.get(job);
  if (!data) throw new Error('This export job was not issued by preparation.');
  return data;
}
/** Approval issues a capability for this exact document, target, and policy. */
export function acknowledgePreparedExport(job: PreparedExportJob): ReadyExportJob {
  content(job);
  const ready = Object.freeze({ [readyBrand]: true as const, job });
  authorized.add(ready);
  return ready;
}
export function assertReadyExport(job: ReadyExportJob): void {
  if (!authorized.has(job)) throw new Error('Export execution requires an issued approval.');
  content(job.job);
}
export function copyExportReview(job: PreparedExportJob): ExportReview { return structuredClone(content(job).review); }
export function copyPreparedDocument(job: ReadyExportJob) {
  assertReadyExport(job);
  return copyCapturedDocument(content(job.job).captured);
}
export function copyPreparedFormTemplates(job: ReadyExportJob) {
  assertReadyExport(job);
  const templates = content(job.job).formTemplates;
  if (!templates) throw new Error('This job has no captured form templates.');
  return copyFormExportTemplates(templates);
}
export function preparedExportMarking(job: ReadyExportJob): ClassificationInfo | undefined {
  assertReadyExport(job);
  return structuredClone(content(job.job).marking);
}

/** No stores, clock, engine, or modal: all decisions belong to the supplied inputs. */
export function prepareExport(input: {
  readonly id: string;
  readonly captured: CapturedDocument;
  readonly target: ExportTarget;
  readonly texMode?: 'configuration' | 'flat';
  readonly pdfAccessibility?: 'tagged';
  readonly wordEnclosurePages?: boolean;
  readonly filename: string;
  readonly policy: PolicyResolution;
  readonly placeholders?: PlaceholderValues;
  readonly formTemplates?: FormExportTemplates;
}): ExportPreparation {
  const error = (message: string): ExportPreparation => Object.freeze({ status: 'error', issues: Object.freeze([message]) });
  if (input.policy.status !== 'ready') return Object.freeze({ status: input.policy.status, issues: Object.freeze([input.policy.message]) });
  try {
    assertExportDeploymentPolicy(input.policy.policy);
    if (input.pdfAccessibility !== undefined && (input.target !== 'pdf' || input.pdfAccessibility !== 'tagged')) return error('Invalid tagged PDF export option.');
    if (input.wordEnclosurePages !== undefined && (typeof input.wordEnclosurePages !== 'boolean' || input.target !== 'docx')) return error('PDF enclosure page images are a Word export option.');
    if (input.texMode !== undefined && (input.target !== 'tex' || !['configuration', 'flat'].includes(input.texMode))) return error('Invalid TeX export mode.');
    if (!input.id.trim() || !input.filename.trim() || /[\\/]/.test(input.filename) || [...input.filename].some(char => char.charCodeAt(0) < 32)) return error('Choose a valid export identity and filename.');
    const capability = capturedCapabilities(input.captured, { operation: 'export', target: input.target, texMode: input.texMode });
    if (capability.status !== 'supported' && capability.status !== 'partial') return error(capability.message);
    const original = copyCapturedDocument(input.captured);
    if (original.kind !== 'correspondence') {
      if (!input.formTemplates || input.formTemplates.kind !== original.kind || input.formTemplates.formType !== original.document.formType) return error('Capture the selected form templates before export.');
      const pages = copyFormExportTemplates(input.formTemplates);
      if (original.kind === 'configured-form' && (input.formTemplates.definitionIdentity !== JSON.stringify(original.document.genericForm.definition)
        || original.document.genericForm.definition.pages.some(page => !Object.hasOwn(pages, page.file)))) return error('Captured templates do not match the selected form definition.');
    }
    const defaults = original.kind === 'builtin-form' && original.document.formType === 'navmc_118_11'
      ? buildNavmc11811DefaultValues(original.document.forms.navmc11811!) : {};
    const values = { ...defaults, ...input.placeholders };
    // Configured forms already contain typed answers from direct field mapping.
    // Their literal text must not become another field's placeholder template.
    const substituted = original.kind === 'configured-form' ? input.captured
      : mapCapturedText(input.captured, field => replacePlaceholders(field.text, values));
    let output = projectRenderedDocument(substituted);
    const snapshot = copyCapturedDocument(output).document;
    const notices: string[] = capability.status === 'partial' && input.texMode !== 'flat' ? [capability.message] : [];
    let markingReview = false;
    let marking: ClassificationInfo | undefined;
    if (output.kind === 'correspondence') {
      const stockIssues = stationeryIssues(snapshot.docType, snapshot.formData, snapshot.paragraphs, snapshot.documentMode);
      if (stockIssues.length) return error(stockIssues.join(' '));
      const jointIssues = jointLetterCommandIssues(snapshot.docType, snapshot.formData);
      if (jointIssues.length) return error(jointIssues.join(' '));
      assertEnclosureMarkingPolicy(snapshot, input.policy);
      const portions = correspondencePortions(snapshot);
      const transmittalIssue = cuiTransmittalIssue(snapshot.formData, portions, snapshot.enclosures, snapshot.docType);
      if (transmittalIssue) return error(transmittalIssue);
      const level = deriveOverallClassLevel(snapshot.formData.classLevel, portions);
      const enclosureIssues = inspectEnclosureMarkings({ ...snapshot.formData, classLevel: level }, snapshot.enclosures);
      if (enclosureIssues.length) {
        notices.push(...enclosureIssues.map(issue => `Enclosure ${issue.index + 1}: ${issue.message}`));
        markingReview = true;
      }
      if (level !== 'custom' && classificationRank(level) === undefined) return error('The document has an unknown classification level.');
      const customText = snapshot.formData.customClassification?.trim();
      if (level === 'custom' && !customText) return error('Enter the custom marking before exporting.');
      const portionLevel = deriveOverallClassLevel('unclassified', portions) as ClassificationLevel;
      const customMarking = level === 'custom' ? detectClassification(customText!) : undefined;
      const selectedLevel = customMarking?.classLevel ?? level as ClassificationLevel;
      if (customMarking && classificationBannerLevel(customText!) === null) {
        notices.push('Review the custom banner: its classification could not be determined automatically.');
        markingReview = true;
      }
      const effectiveLevel = classificationRank(portionLevel)! > classificationRank(selectedLevel)! ? portionLevel : selectedLevel;
      if (!input.policy.policy.allowedLevels.includes(effectiveLevel)) return error(`The prepared ${effectiveLevel.replaceAll('_', ' ').toUpperCase()} marking is outside this deployment's configured levels.`);
      if (level === 'custom' && classificationRank(portionLevel)! > classificationRank(selectedLevel)!) {
        notices.push('Review the custom banner against the higher portion markings.');
        markingReview = true;
      }
      snapshot.formData.classLevel = level;
      marking = publicationMarking(snapshot.formData, portions);
      const issues = publicationExportErrors(snapshot, new Date(output.source.capturedAt), input.target === 'docx' ? 'docx' : 'pdf');
      if (input.target === 'docx') issues.push(...publicationWordExportErrors(snapshot));
      if (input.wordEnclosurePages && snapshot.enclosures.length) {
        notices.push('Review every original PDF enclosure for markings and personal information. Enclosure pages will be noneditable images; interactive fields and original certificate signatures do not carry into the Word copy.');
        markingReview = true;
      }
      if (issues.length) return Object.freeze({ status: 'error', issues: Object.freeze(issues) });
      output = captureDocumentRevision(output.source, snapshot);
    }
    if (input.pdfAccessibility === 'tagged') {
      if (output.kind !== 'correspondence') return error('Tagged PDF requires supported native correspondence.');
      const issues = taggedCorrespondenceIssues(snapshot);
      if (issues.length) return Object.freeze({ status: 'error', issues: Object.freeze(issues) });
      notices.push('Tagged output is experimental. English (en-US), document tags, reading order, table column headers and image alternatives are included. Native screen-reader qualification and PDF/UA conformance have not been established.');
    }
    if (output.kind === 'configured-form') {
      const form = copyCapturedDocument(output);
      if (form.kind !== 'configured-form') throw new Error('Configured form projection lost its definition.');
      const issues = validateAnswers(form.document.genericForm.definition, form.document.genericForm.answers, form.document.genericForm.rows)
        .filter(issue => issue.severity === 'error').map(issue => diagnosticText(form.document.genericForm.definition, issue));
      if (issues.length) return Object.freeze({ status: 'error', issues: Object.freeze(issues) });
    }
    const privacy = mergePIIResults([detectCapturedPII(output, 'output'),
      ...(input.placeholders ? [detectBatchPII(input.captured, input.placeholders)] : []),
    ]);
    const structure = output.kind === 'correspondence' && !['sl3', 'sl4'].includes(snapshot.docType) ? validateParagraphStructure(snapshot.paragraphs) : [];
    const job: PreparedExportJob = Object.freeze({ [preparedBrand]: true as const, id: input.id, source: output.source, kind: output.kind, target: input.target, ...(input.pdfAccessibility ? { pdfAccessibility: input.pdfAccessibility } : {}), ...(input.wordEnclosurePages ? { wordEnclosurePages: true } : {}), ...(input.target === 'tex' ? { texMode: input.texMode ?? 'configuration' } : {}), filename: input.filename, policyIdentity: input.policy.policy.identity });
    prepared.set(job, { captured: output, policy: input.policy.policy, marking, formTemplates: input.formTemplates, review: { privacy, structure, notices, markingReview } });
    return privacy.found || structure.length || markingReview
      ? Object.freeze({ status: 'needs-review', job })
      : Object.freeze({ status: 'ready', job: acknowledgePreparedExport(job) });
  } catch (cause) { return error(cause instanceof Error ? cause.message : 'The document could not be prepared.'); }
}
