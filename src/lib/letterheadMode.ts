import type { DocTypeConfig, DocumentData } from '@/types/document';

export type LetterheadMode = 'full' | 'title-only' | 'preprinted';

/** Joint and publication layouts own their headers and ignore this preference. */
export function supportsLetterheadModes(config: Pick<DocTypeConfig, 'letterhead' | 'uiMode'>): boolean {
  return config.letterhead && ['standard', 'business', 'memo'].includes(config.uiMode);
}

export function resolveLetterheadMode(config: Pick<DocTypeConfig, 'letterhead' | 'uiMode'>,
  data: Pick<Partial<DocumentData>, 'letterheadMode'>): LetterheadMode {
  return supportsLetterheadModes(config) && (data.letterheadMode === 'title-only' || data.letterheadMode === 'preprinted')
    ? data.letterheadMode : 'full';
}
