import { emptyPublicationVolume, freshVolumeContent, VOLUME_DOC_TYPE } from './publicationVolume';
import { emptySl4 } from '@/data/techpub/sl4';
import { emptySl3 } from '@/data/techpub/sl3';
import type { LetterTemplate } from '@/data/templates';
import type { SerializedSession } from '@/stores/documentStore';
import type { DocumentData } from '@/types/document';

/** Build independently of the open draft so unrelated content cannot leak in. */
export function templateSession(template: LetterTemplate, profile: Partial<DocumentData> = {}): SerializedSession {
  const volume = template.docType === VOLUME_DOC_TYPE ? emptyPublicationVolume() : undefined;
  const body = volume ? freshVolumeContent(volume, template.paragraphs.map(paragraph => ({ ...paragraph, volumeSectionId: volume.chapters[0].sections[0].id }))) : undefined;
  return {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: template.docType, formType: 'navmc_10274',
    formData: { fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none', ...profile, ...(template.docType === 'executive_correspondence' ? template.correspondenceDefaults : {}), docType: template.docType,
      ...(body ? { volume: body.volume, signatureType: 'none' as const } : {}),
      ...(template.publicationType ? { publicationType: template.publicationType } : {}),
      ...(template.manualFrontMatter ? { manualFrontMatter: structuredClone(template.manualFrontMatter), signatureType: 'digital' as const, fontSize: '10pt' } : {}),
      ...(template.docType === 'sl4' ? { sl4: emptySl4(), signatureType: 'digital' as const, fontSize: '10pt' } : {}),
      ...(template.docType === 'sl3' ? { sl3: emptySl3(), signatureType: 'digital' as const, fontSize: '10pt' } : {}),
      subject: template.subject, ...(template.ssic ? { ssic: template.ssic } : {}) },
    paragraphs: body?.paragraphs ?? structuredClone(template.paragraphs), references: structuredClone(template.references ?? []),
    enclosures: [], copyTos: [], distributions: [], timestamp: Date.now(),
  };
}
