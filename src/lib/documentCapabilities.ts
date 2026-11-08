import { DOC_TYPE_CONFIG, FORM_TYPE_LABELS, type DocumentMode } from '@/types/document';
import { compileFormDefinition } from '@/services/forms/model';
import { copyCapturedSession, type CapturedDocument } from './capturedDocument';

export type CapabilityRequest =
  | { readonly operation: 'export'; readonly target: 'pdf' | 'docx' | 'tex' }
  | { readonly operation: 'preview' | 'batch'; readonly target: 'pdf' }
  | { readonly operation: 'share'; readonly target: 'link' };

export type FormDefinitionState =
  | { readonly status: 'not-loaded' | 'loading' | 'failed' }
  | { readonly status: 'loaded'; readonly definition: unknown };

export type CapabilitySubject = { readonly documentMode: DocumentMode } & (
  | { readonly kind: 'correspondence'; readonly docType: string }
  | { readonly kind: 'builtin-form'; readonly formType: string }
  | { readonly kind: 'configured-form'; readonly formType: string; readonly definition: FormDefinitionState }
);

export type CapabilityReason =
  | 'invalid-request' | 'invalid-subject' | 'invalid-mode' | 'unknown-document-type' | 'unknown-form-type'
  | 'definition-not-loaded' | 'definition-load-failed' | 'invalid-definition' | 'definition-mismatch'
  | 'pdf-only' | 'configured-form-batch' | 'tex-configuration-only' | 'share-separate-assets';

export type CapabilityResult =
  | { readonly status: 'supported' }
  | { readonly status: 'partial' | 'unsupported' | 'invalid-data' | 'not-ready'; readonly reason: CapabilityReason; readonly message: string };

const supported: CapabilityResult = Object.freeze({ status: 'supported' });
function result(status: Exclude<CapabilityResult['status'], 'supported'>, reason: CapabilityReason, message: string): CapabilityResult {
  return Object.freeze({ status, reason, message });
}
function validRequest(request: CapabilityRequest): boolean {
  if (!request || typeof request !== 'object') return false;
  switch (request.operation) {
    case 'export': return ['pdf', 'docx', 'tex'].includes(request.target);
    case 'preview': case 'batch': return request.target === 'pdf';
    case 'share': return request.target === 'link';
    default: return false;
  }
}

/** Format/operation availability, independent of engine readiness, content checks, or output geometry. */
export function resolveCapabilities(subject: CapabilitySubject, request: CapabilityRequest): CapabilityResult {
  if (!validRequest(request)) return result('invalid-data', 'invalid-request', 'This operation has an invalid output target.');
  if (!subject || typeof subject !== 'object') return result('invalid-data', 'invalid-subject', 'Choose a supported document or form.');
  if (subject.documentMode !== 'compliant' && subject.documentMode !== 'custom') {
    return result('invalid-data', 'invalid-mode', 'Choose compliant or custom mode.');
  }
  if (subject.kind === 'correspondence') {
    if (typeof subject.docType !== 'string' || !Object.hasOwn(DOC_TYPE_CONFIG, subject.docType)) {
      return result('invalid-data', 'unknown-document-type', 'Choose a supported document type.');
    }
    if (request.target === 'docx' && DOC_TYPE_CONFIG[subject.docType].pdfOnly) {
      return result('unsupported', 'pdf-only', 'This publication exports to PDF.');
    }
    if (request.target === 'tex') {
      return result('partial', 'tex-configuration-only', 'Exports LaTeX configuration fragments; a standalone project also needs templates and assets.');
    }
  } else if (subject.kind === 'builtin-form' || subject.kind === 'configured-form') {
    if (typeof subject.formType !== 'string' || !subject.formType
      || (subject.kind === 'builtin-form' ? !Object.hasOwn(FORM_TYPE_LABELS, subject.formType) : Object.hasOwn(FORM_TYPE_LABELS, subject.formType))) {
      return result('invalid-data', 'unknown-form-type', 'Choose a supported form type.');
    }
    if (request.target === 'docx' || request.target === 'tex') {
      return result('unsupported', 'pdf-only', 'This form exports to PDF.');
    }
    if (subject.kind === 'configured-form') {
      if (request.operation === 'batch') {
        return result('unsupported', 'configured-form-batch', 'Batch generation is available for correspondence and the two built-in NAVMC forms.');
      }
      const availability = subject.definition;
      if (!availability || typeof availability !== 'object') return result('invalid-data', 'invalid-definition', 'The selected form definition is invalid.');
      if (availability.status === 'not-loaded' || availability.status === 'loading') {
        return result('not-ready', 'definition-not-loaded', 'Load the selected form definition before continuing.');
      }
      if (availability.status === 'failed') {
        return result('not-ready', 'definition-load-failed', 'The selected form definition could not be loaded. Retry loading it.');
      }
      if (availability.status !== 'loaded') return result('invalid-data', 'invalid-definition', 'The selected form definition is invalid.');
      try {
        const definition = compileFormDefinition(availability.definition);
        if (definition.formId !== subject.formType) {
          return result('invalid-data', 'definition-mismatch', 'The loaded definition does not match the selected form.');
        }
        if (definition.pages.some(page => !page.sha256)) {
          return result('invalid-data', 'invalid-definition', 'The selected form definition is missing template page checksums.');
        }
      } catch {
        return result('invalid-data', 'invalid-definition', 'The selected form definition is invalid or uses an unsupported version.');
      }
    }
  } else return result('invalid-data', 'invalid-subject', 'Choose a supported document or form.');

  if (request.operation === 'share') {
    const template = subject.kind === 'configured-form' ? ' Configured forms also require access to the selected PDF template.' : '';
    return result('partial', 'share-separate-assets', `Share links carry text and form values; attached files and signature images require a separate transfer.${template}`);
  }
  return supported;
}

/** Resolve from an issued revision without reading the active editor or fetching a catalog. */
export function capturedCapabilities(captured: CapturedDocument, request: CapabilityRequest): CapabilityResult {
  const session = copyCapturedSession(captured);
  const documentMode = session.documentMode;
  switch (captured.kind) {
    case 'correspondence': return resolveCapabilities({ kind: captured.kind, documentMode, docType: session.docType }, request);
    case 'builtin-form': return resolveCapabilities({ kind: captured.kind, documentMode, formType: session.formType }, request);
    case 'configured-form': return resolveCapabilities({
      kind: captured.kind, documentMode, formType: session.formType,
      definition: { status: 'loaded', definition: session.genericForm?.definition },
    }, request);
  }
}
