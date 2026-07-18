import type { FormSignatureBlock } from '@/types/signature';

export type SignatureFormKind = 'navmc_10274' | 'navmc_118_11';

export interface SignaturePreset {
  id: string;
  label: string;
  /** A fresh block for this role. */
  make(): FormSignatureBlock;
}

/**
 * Quick-add presets for a form's signature blocks — the counselor/originator,
 * the counseled Marine's acknowledgement, and a witness. Each drops a new block
 * with a sensible starting statement so users don't retype the boilerplate.
 *
 * The acknowledgement wording is MCO 1610.7 / IRAM-governed and differs by form,
 * so every preset is an EDITABLE starting point — never a locked value; the same
 * posture as the app's demo text.
 */
export function signaturePresets(form: SignatureFormKind): SignaturePreset[] {
  const acknowledgement =
    form === 'navmc_118_11'
      ? 'I have been counseled this date and understand this entry.'
      : 'I acknowledge receipt and understanding of this counseling.';
  const signerLabel = form === 'navmc_118_11' ? 'Counselor' : 'Originator';
  const block = (statement: string): FormSignatureBlock => ({ statement, name: '', style: 'typed' });
  return [
    { id: 'signer', label: signerLabel, make: () => block('') },
    { id: 'acknowledgement', label: 'Marine acknowledgement', make: () => block(acknowledgement) },
    { id: 'witness', label: 'Witness', make: () => block('Witnessed:') },
  ];
}
