export function supportsDlaLetterhead(type: string): boolean {
  return type === 'business_letter' || type === 'letterhead_memorandum' || type === 'mf' || type === 'mfr';
}

export function hasDlaStationery(type: string, data: { letterheadStandard?: string }): boolean {
  return supportsDlaLetterhead(type) && data.letterheadStandard === 'dla';
}

export function usesDlaLetterhead(type: string, data: { letterheadStandard?: string; letterheadMode?: string }): boolean {
  return hasDlaStationery(type, data) && (!data.letterheadMode || data.letterheadMode === 'full');
}
