import { documentTextFields } from './documentFields';
import { deriveOverallClassLevel } from './overallClassification';
import { documentDistributionStatement } from '@/services/latex/distributionStatement';
import type { DocumentData } from '@/types/document';
import type { ProofreadSource } from './proofread';

const PUBLICATIONS = new Set(['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter', 'technical_volume']);
const CLASSIFIED_LEVELS = new Set(['confidential', 'secret', 'top_secret', 'top_secret_sci']);
const CLASSIFIED_FIELDS = new Set(['classifiedBy', 'derivedFrom', 'declassifyOn', 'classReason', 'classifiedPocEmail']);
const CUI_FIELDS = new Set(['cuiControlledBy', 'cuiCategory', 'cuiDissemination', 'pocEmail']);
const MEMO_SIGNER_FIELDS = new Map<string, keyof DocumentData>([
  ['jointSeniorSigName', 'jointMemoSeniorSigName'], ['jointSeniorSigTitle', 'jointMemoSeniorSigTitle'],
  ['jointJuniorSigName', 'jointMemoJuniorSigName'], ['jointJuniorSigTitle', 'jointMemoJuniorSigTitle'],
]);

/** A legacy memo signer is displayed in the memo control until that control is
 * explicitly set, including an explicit empty string. Match jointSignatories.
 */
export function proofreadFieldControl(source: ProofreadSource, field: string): string {
  return source.docType === 'joint_memorandum' ? MEMO_SIGNER_FIELDS.get(field) ?? field : field;
}

/** Refine the review view without narrowing transfer or export privacy scans.
 * Publications also print contact/control metadata in their front matter, so
 * retain their established projection rather than applying letter-block rules.
 */
export function proofreadOutputFields(source: ProofreadSource) {
  const publication = PUBLICATIONS.has(source.docType);
  const level = deriveOverallClassLevel(source.formData.classLevel, source.paragraphs);
  const fields = documentTextFields(source, 'output').filter(field => {
    if (field.path[0] !== 'formData' || typeof field.path[1] !== 'string') return true;
    const key = field.path[1];
    if (!publication) {
      if (key === 'cuiDistStatement') return false;
      if (key === 'customClassification') return level === 'custom';
      if (CLASSIFIED_FIELDS.has(key)) return CLASSIFIED_LEVELS.has(level);
      if (CUI_FIELDS.has(key)) return level === 'cui';
    }
    if (source.docType === 'joint_memorandum' && MEMO_SIGNER_FIELDS.has(key)) {
      const memoField = MEMO_SIGNER_FIELDS.get(key);
      return !!memoField && source.formData[memoField] == null;
    }
    return true;
  });
  // The general projector omits choice controls. This selector prints a
  // composed statement containing author-supplied fill-ins, so inspect that
  // visible text once and keep navigation on the actual statement control.
  if (!publication && level === 'cui') {
    const data = source.formData;
    const text = documentDistributionStatement({
      cuiDistStatement: typeof data.cuiDistStatement === 'string' ? data.cuiDistStatement : undefined,
      distReason: typeof data.distReason === 'string' ? data.distReason : undefined,
      distDate: typeof data.distDate === 'string' ? data.distDate : undefined,
      controllingOffice: typeof data.controllingOffice === 'string' ? data.controllingOffice : undefined,
    });
    if (text.trim()) fields.push({ path: ['formData', 'cuiDistStatement'], role: 'text', label: 'Distribution statement', text });
  }
  return fields;
}
