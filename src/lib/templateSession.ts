import { emptySl3 } from '@/data/techpub/sl3';
import type { LetterTemplate } from '@/data/templates';
import type { SerializedSession } from '@/stores/documentStore';
import type { DocumentData } from '@/types/document';

/** Build independently of the open draft so unrelated content cannot leak in. */
export function templateSession(template: LetterTemplate, profile: Partial<DocumentData> = {}): SerializedSession {
  return {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: template.docType, formType: 'navmc_10274',
    formData: { fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none', ...profile, docType: template.docType,
      ...(template.publicationType ? { publicationType: template.publicationType } : {}),
      ...(template.docType === 'sl3' ? { sl3: emptySl3(), signatureType: 'digital' as const, fontSize: '10pt' } : {}),
      subject: template.subject, ...(template.ssic ? { ssic: template.ssic } : {}) },
    paragraphs: structuredClone(template.paragraphs), references: structuredClone(template.references ?? []),
    enclosures: [], copyTos: [], distributions: [], timestamp: Date.now(),
  };
}
