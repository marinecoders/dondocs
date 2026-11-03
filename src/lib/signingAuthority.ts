import type { DocTypeConfig, DocumentData } from '@/types/document';

export type SigningCapacity = 'regular' | 'byDirection' | 'acting';

export interface SigningAuthority {
  byDirection?: boolean;
  byDirectionAuthority?: string;
  acting?: boolean;
  /** Title of a temporarily replaced official who signs by title, e.g. Deputy.
   *  Separate from sigTitle so a profile's Commanding Officer title does not
   *  leak into a name-only naval-letter block. */
  actingTitle?: string;
}

const ACTING_DOCUMENT_TYPES = new Set([
  'naval_letter', 'standard_letter', 'multiple_address_letter', 'business_letter',
  'same_page_endorsement', 'new_page_endorsement', 'joint_letter', 'joint_memorandum',
  'moa', 'mou', 'mfr', 'mf', 'plain_paper_memorandum', 'letterhead_memorandum',
  'decision_memorandum', 'executive_memorandum', 'executive_correspondence',
  'standard_memorandum', 'action_memorandum',
]);

/** Ch 2 ¶5c–d applies to correspondence; Info Memos have no bottom signature
 *  block (Ch 12 §12-4 ¶4a(7)). Forms and technical publications keep their own rules. */
export function supportsActingSignature(docType: string): boolean {
  return ACTING_DOCUMENT_TYPES.has(docType);
}

/** Missing acting is false for older documents/profiles. Acting takes precedence
 *  over a stale by-direction flag so imports can never print both capacities. */
export function signingCapacity(data: SigningAuthority): SigningCapacity {
  return data.acting ? 'acting' : data.byDirection ? 'byDirection' : 'regular';
}

export function signingCapacityPatch(value: SigningCapacity) {
  return { acting: value === 'acting', byDirection: value === 'byDirection' };
}

/** Plain text; each output engine escapes it for its own context. */
export function signatureAuthorityLine(data: SigningAuthority, allowActing = true): string {
  if (data.acting) return allowActing ? 'Acting' : '';
  if (!data.byDirection) return '';
  const authority = (data.byDirectionAuthority || '').trim();
  return authority ? `By direction of ${authority}` : 'By direction';
}

export function signaturePosition(
  data: SigningAuthority & { sigTitle?: string }, config: DocTypeConfig,
): string {
  if (config.showSignatureRankTitle !== false) return data.sigTitle || '';
  return data.acting ? (data.actingTitle || '').trim() : '';
}

/** Joint memos have their own editor fields. Fall back only for older sessions;
 *  an explicitly cleared memo field must not revive a previous letter's signer. */
export function jointSignatories(data: Partial<DocumentData>, isMemo: boolean) {
  return {
    seniorName: (isMemo ? data.jointMemoSeniorSigName : undefined) ?? data.jointSeniorSigName ?? '',
    seniorTitle: (isMemo ? data.jointMemoSeniorSigTitle : undefined) ?? data.jointSeniorSigTitle ?? '',
    juniorName: (isMemo ? data.jointMemoJuniorSigName : undefined) ?? data.jointJuniorSigName ?? '',
    juniorTitle: (isMemo ? data.jointMemoJuniorSigTitle : undefined) ?? data.jointJuniorSigTitle ?? '',
  };
}
