import type { DocumentSnapshot } from '@/stores/historyStore';
import type { FormSession } from '@/stores/formStore';
import { parseFormInstance, type FormInstance } from '@/services/forms/model';
import { serializeDocumentSnapshot } from './documentSerialization';

export interface CapturedSource {
  readonly documentId: string;
  readonly epoch: number;
  readonly editSequence: number;
  readonly capturedAt: number;
}
type BuiltinForm = 'navmc_10274' | 'navmc_118_11';
function isBuiltinForm(value: unknown): value is BuiltinForm { return value === 'navmc_10274' || value === 'navmc_118_11'; }
export type CapturedContent =
  | { kind: 'correspondence'; document: DocumentSnapshot }
  | { kind: 'builtin-form'; document: DocumentSnapshot & { documentCategory: 'forms'; formType: BuiltinForm; forms: FormSession } }
  | { kind: 'configured-form'; document: DocumentSnapshot & { documentCategory: 'forms'; genericForm: FormInstance } };
const captureBrand = Symbol('captured-document');
export interface CapturedDocument {
  readonly [captureBrand]: true;
  readonly kind: CapturedContent['kind'];
  readonly source: CapturedSource;
}
const captures = new WeakMap<CapturedDocument, CapturedContent>();

/** Own the full editable model, including buffers; never transfer editor bytes. */
export function captureDocumentRevision(source: CapturedSource, snapshot: DocumentSnapshot): CapturedDocument {
  if (!source.documentId || !Number.isSafeInteger(source.epoch) || source.epoch < 0
    || !Number.isSafeInteger(source.editSequence) || source.editSequence < 0 || !Number.isFinite(source.capturedAt)) throw new Error('Invalid captured document identity.');
  const owned = structuredClone(snapshot);
  let content: CapturedContent;
  if (owned.documentCategory === 'forms') {
    if (owned.genericForm) {
      const form = parseFormInstance(owned.genericForm);
      if (owned.formType !== form.definition.formId) throw new Error('Captured form type does not match its definition.');
      content = { kind: 'configured-form', document: { ...owned, documentCategory: 'forms', genericForm: form } };
    } else {
      if (!isBuiltinForm(owned.formType) || !owned.forms
        || !(owned.formType === 'navmc_10274' ? owned.forms.navmc10274 : owned.forms.navmc11811)) throw new Error('Captured built-in form data is missing.');
      content = { kind: 'builtin-form', document: { ...owned, documentCategory: 'forms', formType: owned.formType, forms: owned.forms } };
    }
  } else if (!owned.documentCategory || owned.documentCategory === 'correspondence') content = { kind: 'correspondence', document: owned };
  else throw new Error('Unsupported captured document kind.');
  const captured: CapturedDocument = Object.freeze({ [captureBrand]: true as const, kind: content.kind, source: Object.freeze({ ...source }) });
  captures.set(captured, content);
  return captured;
}

function ownedContent(captured: CapturedDocument): CapturedContent {
  const content = captures.get(captured);
  if (!content) throw new Error('This captured document was not issued by the capture boundary.');
  return content;
}

/** Each consumer owns its copy; mutations cannot alter this or another job. */
export function copyCapturedDocument(captured: CapturedDocument): CapturedContent {
  return structuredClone(ownedContent(captured));
}

/** Preserve the existing saved format while projecting from the captured data. */
export function copyCapturedSession(captured: CapturedDocument) {
  return structuredClone(serializeDocumentSnapshot(ownedContent(captured).document, captured.source.capturedAt));
}
