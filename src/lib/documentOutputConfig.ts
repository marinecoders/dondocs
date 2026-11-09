import { DOC_TYPE_CONFIG, type DocumentMode, type DocTypeConfig } from '@/types/document';

/** Custom mode lifts the same restrictions that the editor lifts. */
export function documentOutputConfig(docType: string, mode: DocumentMode = 'compliant'): DocTypeConfig {
  const config = Object.hasOwn(DOC_TYPE_CONFIG, docType) ? DOC_TYPE_CONFIG[docType] : DOC_TYPE_CONFIG.naval_letter;
  return mode === 'custom' ? { ...config, compliance: { ...config.compliance, numberedParagraphs: true, allowReferences: true, allowEnclosures: true } } : config;
}
