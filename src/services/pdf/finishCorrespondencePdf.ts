import { DOC_TYPE_CONFIG, type DocumentData } from '@/types/document';
import type { GeneratedFiles } from '@/services/latex/generator';
import { mergeEnclosures, type ClassificationInfo, type EnclosureError } from './mergeEnclosures';
import { assembleEndorsement, shouldAssembleBasicLetter } from './assembleEndorsement';
import { addSignatureField, addDualSignatureFields, type DualSignatureFieldConfig, type SignatureFieldConfig } from './addSignatureField';

/**
 * Assemble the uploaded basic letter ahead of a compiled endorsement, so the
 * exported PDF is the letter followed by the endorsement (SECNAV M-5216.5 Ch 9:
 * the endorsement continues the basic letter's page numbers, so the letter
 * reads first). A no-op for non-endorsements or when no basic-letter PDF is
 * attached. Runs before the enclosure merge, so `mergeEnclosures` treats the
 * combined [letter + endorsement] as the main document and the signature-field
 * placement (`basicPageCount - 1`) still lands on the endorsement's last page.
 * On a bad upload it returns the endorsement unchanged plus an error for the
 * caller to surface — never a silently dropped export.
 */
export async function assembleBasicLetter(
  pdfBytes: Uint8Array,
  docType: string,
  formData: Partial<DocumentData>
): Promise<{ pdfBytes: Uint8Array; error?: string }> {
  // The gate (new-page only, letter attached) lives in assembleEndorsement.ts
  // where it is unit-tested; see shouldAssembleBasicLetter for the reasoning.
  if (!shouldAssembleBasicLetter(docType, formData)) return { pdfBytes };
  const result = await assembleEndorsement(pdfBytes, formData.basicLetterFile!.data);
  return result.ok ? { pdfBytes: result.pdfBytes } : { pdfBytes, error: result.error };
}

/** An EnclosureError-shaped entry so a failed basic-letter assembly surfaces in
 *  the same modal the enclosure merge uses — tagged so the modal doesn't call
 *  it "Enclosure (0)" or claim a placeholder page exists for it. */
export function basicLetterError(error: string): EnclosureError {
  return { enclosureNumber: 0, title: 'Basic letter', error, kind: 'basicLetter' };
}

export function getClassificationInfo(
  classLevel: string | undefined,
  customClassification?: string
): ClassificationInfo | undefined {
  if (!classLevel || classLevel === 'unclassified') {
    return undefined;
  }

  // Handle custom classification
  if (classLevel === 'custom' && customClassification) {
    return { level: classLevel, marking: customClassification };
  }

  const markingMap: Record<string, string> = {
    cui: 'CUI',
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };

  const marking = markingMap[classLevel];
  if (!marking) return undefined;

  return { level: classLevel, marking };
}

/**
 * Build signatory name configuration for signature field positioning.
 * Returns the abbreviated name format (e.g., "J. M. SMITH") used in signature blocks.
 */
export function getSignatoryConfig(formData: Partial<DocumentData>): SignatureFieldConfig {
  // Build abbreviated name for single signatures: F. M. LASTNAME
  const firstName = formData.sigFirst?.trim() || '';
  const middleName = formData.sigMiddle?.trim() || '';
  const lastName = formData.sigLast?.toUpperCase()?.trim() || '';

  const abbrevName = [
    firstName ? `${firstName[0].toUpperCase()}.` : '',
    middleName ? `${middleName[0].toUpperCase()}.` : '',
    lastName,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    signatoryName: abbrevName || undefined,
  };
}

/**
 * Build dual signatory name configuration for joint letter/MOA/MOU signature field positioning.
 * Returns junior and senior signatory names as they appear in the PDF.
 */
export function getDualSignatoryConfig(formData: Partial<DocumentData>, uiMode: string | undefined): DualSignatureFieldConfig {
  let juniorName: string | undefined;
  let seniorName: string | undefined;

  if (uiMode === 'moa') {
    // MOA/MOU: Junior uses full name uppercased, Senior uses "F. LASTNAME",
    // matching how the LaTeX generator renders them.
    juniorName = formData.juniorSigName?.toUpperCase()?.trim() || undefined;

    // Senior signatory in MOA/MOU uses abbreviated form: "F. LASTNAME"
    // e.g., "David Foster" -> "D. FOSTER"
    const seniorFullName = formData.seniorSigName?.trim() || '';
    if (seniorFullName) {
      const parts = seniorFullName.split(' ');
      const firstName = parts[0] || '';
      const lastName = parts[parts.length - 1]?.toUpperCase() || '';
      seniorName = firstName ? `${firstName[0].toUpperCase()}. ${lastName}` : lastName;
    }
  } else if (uiMode === 'joint' || uiMode === 'joint_memo') {
    // Joint letter and joint memo share the same fields (both uppercased)
    juniorName = formData.jointJuniorSigName?.toUpperCase()?.trim() || undefined;
    seniorName = formData.jointSeniorSigName?.toUpperCase()?.trim() || undefined;
  }

  return {
    juniorSignatoryName: juniorName,
    seniorSignatoryName: seniorName,
  };
}

/** The same assembly sequence is used by single downloads and batch results. */
export async function finishCorrespondencePdf(pdf: Uint8Array, docType: string, formData: Partial<DocumentData>, generated: GeneratedFiles): Promise<{ pdfBytes: Uint8Array; errors: EnclosureError[] }> {
  const assembled = await assembleBasicLetter(pdf, docType, formData);
  let pdfBytes = assembled.pdfBytes;
  const errors = assembled.error ? [basicLetterError(assembled.error)] : [];
  let lastBasicPageIndex: number | undefined;
  if (generated.enclosures.length || (generated.includeHyperlinks && generated.referenceUrls.length)) {
    const merged = await mergeEnclosures(pdfBytes, generated.enclosures, getClassificationInfo(formData.classLevel, formData.customClassification), generated.includeHyperlinks, generated.referenceUrls);
    pdfBytes = merged.pdfBytes;
    lastBasicPageIndex = merged.basicPageCount !== undefined ? merged.basicPageCount - 1 : undefined;
    if (merged.hasErrors) errors.push(...merged.errors);
  }
  if (formData.signatureType === 'digital') {
    const config = DOC_TYPE_CONFIG[docType];
    pdfBytes = config?.uiMode === 'moa' || config?.compliance?.dualSignature
      ? await addDualSignatureFields(pdfBytes, { ...getDualSignatoryConfig(formData, config?.uiMode), lastBasicPageIndex })
      : await addSignatureField(pdfBytes, { ...getSignatoryConfig(formData), lastBasicPageIndex });
  }
  return { pdfBytes, errors };
}
