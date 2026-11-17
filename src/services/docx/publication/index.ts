import type { DocumentSnapshot } from '@/stores/historyStore';
import type { StoredAttachment } from '@/lib/documentsDb';
import { RUNTIME_BASE } from '@/lib/releasePaths';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { publicationWordExportErrors } from '@/lib/publicationWordPreflight';
import { publicationMarking } from '@/lib/publicationMarking';
import { inspectRasterImage } from '../imageAssets';
import { PublicationWordPackage } from './package';
import { manualCover } from './frontMatter';
import { instructionBody, instructionCover } from './instructions';
import type { ArtworkLabel } from './artwork';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import type { SectionFormat } from './package';

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

/** Publication content uses native Word paragraphs, tables and sections. It does
 * not share correspondence's flat-LaTeX conversion or embed original PDF pages.
 * The prepared export owner retains the source and its attachment lease.
 */
export async function renderPublicationDocx(document: PublicationWordSource, ports: PublicationWordPorts, signal: AbortSignal, referenceDate: Date): Promise<Blob> {
  if (!['tm_ietm_front_matter', 'i_type'].includes(document.docType)) throw new Error('This publication family does not have a Word renderer.');
  const errors = [...publicationWordExportErrors(document), ...publicationExportErrors(document, referenceDate)];
  if (errors.length) throw new Error(errors.join('\n'));
  const portions = document.paragraphs;
  document = { ...document, formData: { ...document.formData, docType: document.docType, classLevel: deriveOverallClassLevel(document.formData.classLevel, portions) } };
  const word = new PublicationWordPackage(signal, document.docType === 'i_type' ? 12 : 10);
  const marking = publicationMarking(document.formData, portions);
  const manual = document.formData.manualFrontMatter;
  const title = [document.formData.shortTitle, document.docType === 'tm_ietm_front_matter' && manual?.volume ? `VOLUME ${manual.volume}${manual.volumes ? ` OF ${manual.volumes}` : ''}` : ''].filter(Boolean).join('\n');
  const section: SectionFormat = { title, ...(document.docType === 'i_type' ? { bannerSize: 10, outerFurniture: true } : { pageNumberAlign: 'right' }), marking: document.docType !== 'i_type' && marking?.level === 'cui' && document.formData.cuiDissemination?.trim()
    ? `${marking.marking}//${document.formData.cuiDissemination.trim()}` : marking?.marking };
  word.check();
  const seal = await (ports.loadSeal ?? loadPublicationSeal)(signal);
  word.check();
  if (document.docType === 'i_type') {
    instructionCover(word, document, seal, referenceDate, section);
    return word.finish(await instructionBody(word, document, ports, section));
  }
  manualCover(word, document.formData, seal, referenceDate, section);
  return word.finish({ ...section, start: 1 });
}
