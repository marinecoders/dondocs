import { isStaffPaper } from './staffPapers';
import { DOC_TYPE_CONFIG, type DocumentMode, type DocTypeConfig, type DocumentData } from '@/types/document';

/** Custom mode lifts the same restrictions that the editor lifts. */
export function documentOutputConfig(docType: string, mode: DocumentMode = 'compliant'): DocTypeConfig {
  const config = Object.hasOwn(DOC_TYPE_CONFIG, docType) ? DOC_TYPE_CONFIG[docType] : DOC_TYPE_CONFIG.naval_letter;
  return mode === 'custom' && !isStaffPaper(docType) ? { ...config, compliance: { ...config.compliance, numberedParagraphs: true, allowReferences: true, allowEnclosures: true } } : config;
}


// Existing joint memos may have their rendered heading in the joint fields.
export function jointMemoHeading(data: Partial<DocumentData>) {
  return {
    subject: data.jointSubject?.trim() ? data.jointSubject : data.subject,
    to: data.jointTo?.trim() ? data.jointTo : data.to,
  };
}
