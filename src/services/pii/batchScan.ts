import { copyCapturedDocument, type CapturedDocument } from '@/lib/capturedDocument';
import { mapCapturedText } from '@/lib/documentFields';
import { buildNavmc11811DefaultValues, replacePlaceholders } from '@/lib/placeholders';
import { detectCapturedPII, detectTextPII, mergePIIResults } from './detector';

/** Raw row values are reviewed even when a column is unused. Source and
 * resolved text keep the same active-field projection as individual exports. */
export function detectBatchPII(captured: CapturedDocument, values: Readonly<Record<string, string>>) {
  const source = copyCapturedDocument(captured);
  const page11 = source.kind === 'builtin-form' && source.document.formType === 'navmc_118_11'
    ? source.document.forms.navmc11811 : undefined;
  const fields = Object.entries(values).flatMap(([key, value]) => {
    // Exempt a column only when it supplies the dedicated ID. Any second use
    // in remarks or other text is still inspected in the resolved document.
    const suppliesDedicatedId = page11 && page11.edipi !== value
      && replacePlaceholders(page11.edipi, { [key]: value }) === value;
    return suppliesDedicatedId && /^\d{10}$/.test(value)
      ? [] : [{ field: `Batch value: ${key}`, value }];
  });
  const substitutions = { ...(page11 ? buildNavmc11811DefaultValues(page11) : {}), ...values };
  const resolved = mapCapturedText(captured, field => replacePlaceholders(field.text, substitutions));
  const documentFindings = mergePIIResults([detectCapturedPII(captured), detectCapturedPII(resolved)]);
  const rawValues = detectTextPII(fields);
  // A value already identified in document text needs no duplicate row-value
  // warning. Unused columns still retain their own locations.
  return mergePIIResults([documentFindings, { ...rawValues, findings: rawValues.findings.filter(finding =>
    !documentFindings.findings.some(existing => existing.type === finding.type && existing.value === finding.value)),
  }]);
}
