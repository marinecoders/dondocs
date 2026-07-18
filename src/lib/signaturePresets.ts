import type { FormSignatureBlock } from '@/types/signature';

export type SignatureFormKind = 'navmc_10274' | 'navmc_118_11';

export interface SignaturePreset {
  id: string;
  label: string;
  /** A fresh block for this role. */
  make(): FormSignatureBlock;
}

/**
 * Names the app already knows, offered so a preset arrives pre-filled instead
 * of demanding a second "Use profile" click. Every fill is an editable typed
 * name, never a lock.
 */
export interface SignaturePresetNames {
  /** Counselor/Originator typed name — usually the active profile's. */
  signer?: string;
  /**
   * The counseled Marine's typed name — on the 118(11) it's derivable from the
   * Marine Identification fields. The AA form's "To" is freeform (rank, name,
   * MOS in one box), so callers there leave this unset rather than mis-parse.
   */
  marine?: string;
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
export function signaturePresets(
  form: SignatureFormKind,
  names: SignaturePresetNames = {}
): SignaturePreset[] {
  const acknowledgement =
    form === 'navmc_118_11'
      ? 'I have been counseled this date and understand this entry.'
      : 'I acknowledge receipt and understanding of this counseling.';
  const signerLabel = form === 'navmc_118_11' ? 'Counselor' : 'Originator';
  const block = (statement: string, name = ''): FormSignatureBlock => ({
    statement,
    name,
    style: 'typed',
  });
  return [
    { id: 'signer', label: signerLabel, make: () => block('', names.signer ?? '') },
    {
      id: 'acknowledgement',
      label: 'Marine acknowledgement',
      make: () => block(acknowledgement, names.marine ?? ''),
    },
    // A witness is whoever happened to be present — never a name the app can
    // guess, so it stays blank even when names are supplied.
    { id: 'witness', label: 'Witness', make: () => block('Witnessed:') },
  ];
}

/**
 * The standard counseling setup — signer + Marine acknowledgement, in signing
 * order — for the empty state's one-click start. With `names` supplied the
 * whole pair arrives ready to export.
 */
export function standardSignaturePair(
  form: SignatureFormKind,
  names: SignaturePresetNames = {}
): FormSignatureBlock[] {
  const presets = signaturePresets(form, names);
  const byId = (id: string) => presets.find((p) => p.id === id)!.make();
  return [byId('signer'), byId('acknowledgement')];
}
