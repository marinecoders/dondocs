import type { DocumentSnapshot } from '@/stores/historyStore';
import type { StoredAttachment } from '@/lib/documentsDb';
import { RUNTIME_BASE } from '@/lib/releasePaths';
import { isTechnicalPublication, publicationExportErrors } from '@/lib/publicationPreflight';
import { publicationWordExportErrors } from '@/lib/publicationWordPreflight';
import { publicationMarking } from '@/lib/publicationMarking';
import { inspectRasterImage } from '../imageAssets';
import { PublicationWordPackage } from './package';
import { manualCover } from './frontMatter';
import { instructionBody, instructionCover } from './instructions';
import type { ArtworkLabel } from './artwork';
import { sl3Body, sl4Body, stockCover } from './stock';
import { sl3Portions } from '@/data/techpub/sl3';
import { sl4Portions } from '@/data/techpub/sl4';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { formatPublicationDate } from '@/lib/publicationDate';
import type { SectionFormat } from './package';
import { volumeWord } from './volume';

export type PublicationWordSource = Pick<DocumentSnapshot, 'docType' | 'formData' | 'paragraphs' | 'endItems' | 'publicationTables'>
  & { enclosures?: readonly { title: string }[] };
export interface PublicationWordPorts {
  readAsset(id: string): StoredAttachment;
  loadSeal?(signal: AbortSignal): Promise<Uint8Array>;
  renderArtwork?(bytes: Uint8Array, extent: { width: number; height: number }, labels: readonly ArtworkLabel[], signal: AbortSignal): Promise<Uint8Array>;
}

async function loadPublicationSeal(signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(`${RUNTIME_BASE}attachments/usmc-seal.png`, { signal });
  if (!response.ok) throw new Error('The Marine Corps seal could not be loaded. Retry Word export.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  await inspectRasterImage(bytes, 'image/png');
  return bytes;
}

/** Render native publication paragraphs, tables and sections from the
 * prepared source and its retained attachment lease.
 */
export async function renderPublicationDocx(document: PublicationWordSource, ports: PublicationWordPorts, signal: AbortSignal, referenceDate: Date): Promise<Blob> {
  if (!isTechnicalPublication(document.docType)) throw new Error('This publication family does not have a Word renderer.');
  const errors = [...publicationWordExportErrors(document), ...publicationExportErrors(document, referenceDate, 'docx')];
  if (errors.length) throw new Error(errors.join('\n'));
  const portions = [...document.paragraphs,
    ...(document.docType === 'sl3' && document.formData.sl3 ? sl3Portions(document.formData.sl3) : []),
    ...(document.docType === 'sl4' && document.formData.sl4 ? sl4Portions(document.formData.sl4, document.paragraphs) : []),
  ];
  document = { ...document, formData: { ...document.formData, docType: document.docType, classLevel: deriveOverallClassLevel(document.formData.classLevel, portions) } };
  const isVolume = document.docType === 'technical_volume';
  const fontSize = document.docType === 'i_type' || isVolume && document.formData.fontSize === '12pt'
    ? 12 : isVolume && document.formData.fontSize === '11pt' ? 11 : 10;
  const word = new PublicationWordPackage(signal, fontSize, isVolume ? document.formData.fontFamily : undefined);
  const marking = publicationMarking(document.formData, portions);
  const manual = document.formData.manualFrontMatter;
  const title = [document.formData.shortTitle, document.docType === 'tm_ietm_front_matter' && manual?.volume ? `VOLUME ${manual.volume}${manual.volumes ? ` OF ${manual.volumes}` : ''}` : ''].filter(Boolean).join('\n');
  const section: SectionFormat = { title, ...(document.docType === 'i_type' ? { bannerSize: 10, outerFurniture: true } : { pageNumberAlign: isVolume ? 'center' : 'right' }), ...(document.docType === 'sl3' || document.docType === 'sl4' ? { leftTitle: formatPublicationDate(document.formData.date ?? '', referenceDate).toUpperCase(), bannerSize: 14 } : {}), marking: document.docType !== 'i_type' && !isVolume && marking?.level === 'cui' && document.formData.cuiDissemination?.trim()
    ? `${marking.marking}//${document.formData.cuiDissemination.trim()}` : marking?.marking };
  word.check();
  if (isVolume) return word.finish(await volumeWord(word, document, ports, section, referenceDate));
  const seal = await (ports.loadSeal ?? loadPublicationSeal)(signal);
  word.check();
  if (document.docType === 'i_type') {
    instructionCover(word, document, seal, referenceDate, section);
    return word.finish(await instructionBody(word, document, ports, section));
  }
  if (document.docType === 'sl3' || document.docType === 'sl4') {
    stockCover(word, document, seal, referenceDate, section);
    return word.finish(await (document.docType === 'sl3' ? sl3Body : sl4Body)(word, document, ports, section));
  }
  manualCover(word, document.formData, seal, referenceDate, section);
  return word.finish({ ...section, start: 1 });
}
