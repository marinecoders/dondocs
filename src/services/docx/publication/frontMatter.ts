import { manualType } from '@/data/techpub/manualFrontMatter';
import { MANUAL_DESTRUCTION, MANUAL_DISTRIBUTION } from '@/data/techpub/manualStatements';
import { publicationTypeName } from '@/data/techpub/publicationTypes';
import { abbreviatedSignatoryName } from '@/lib/signatoryName';
import { formatPublicationDate } from '@/lib/publicationDate';
import { publicationDate } from '@/lib/timeCompliance';
import { documentDistributionStatement } from '@/services/latex/distributionStatement';
import { format, isValid, parseISO } from 'date-fns';
import type { DocumentData, EndItem } from '@/types/document';
import { PublicationWordPackage, type SectionFormat } from './package';

const EXPORT_WARNING = 'WARNING: This document contains technical data whose export is restricted by the Arms Export Control Act (Section 2751 of Title 22, United States Code) or the Export Control Reform Act of 2018 (Chapter 58 Sections 4801–4852 of Title 50, United States Code). Violations of these export laws are subject to severe criminal penalties. Disseminate in accordance with provisions of DoD Directive 5230.25 and DoD Instruction 2040.02.';
const HAZARDS = 'Per MCO 5100.34_, Commanders, Commanding Officers, and Officers-In-Charge shall identify and report situations that negatively affect safety of operation via the Automated Message Handling System to: COMMARCORSYSCOM QUANTICO VA, PAE MC QUANTICO VA, CMC PPO WASHINGTON DC, CMC I WASHINGTON DC, CMC L WASHINGTON DC, and CMC DCI WASHINGTON DC. Individuals may report potential hazards to Marine Corps Systems Command System Safety at smb_mcsc_safety@usmc.mil and/or to Commandant of the Marine Corps Safety Division (CMC SD) at hqmc_safety_division@usmc.mil.';

export function endItemTable(word: PublicationWordPackage, items: readonly EndItem[], minRows = 0): void {
  const rows = items.map(item => [item.nsn, item.tamcn, item.id, item.model]);
  while (rows.length < minRows) rows.push(['', '', '', '']);
  word.table(['NSN', 'TAMCN', 'ID NO.', 'MODEL'], rows, [2520, 1440, 2340, 3780], { size: 10 });
}

export function publicationNotices(word: PublicationWordPackage, data: Partial<DocumentData>, manual = false): void {
  const m = data.manualFrontMatter;
  if (data.classLevel === 'cui') {
    const office = [...new Set([data.cuiControlledBy, data.controllingOffice].filter(Boolean))].join(', ');
    word.text(`Controlled by: ${manual ? 'United States Marine Corps\nControlled by: ' : ''}${office}\nCUI Category: ${data.cuiCategory ?? ''}\nDistribution/Dissemination Control: ${data.cuiDissemination ?? ''}\nPOC: ${data.pocEmail ?? ''}`, { size: 8 });
  } else if (['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(data.classLevel ?? '')) {
    word.text(`Classified By: ${data.classifiedBy ?? ''}\n${data.classificationBasis === 'original' ? `Reason: ${data.classReason ?? ''}` : `Derived From: ${data.derivedFrom ?? ''}`}\nDeclassify On: ${data.declassifyOn ?? ''}`, { size: 8 });
  }
  if (manual && m) for (const notice of [m.supplementNotice, m.volumeNotice]) if (notice) word.text(notice, { size: 8 });
  if (data.supersedure) word.text(`SUPERSEDURE NOTICE: ${data.supersedure.replace(/^SUPERSEDURE NOTICE:\s*/i, '')}`, { size: 8 });
  if (manual) {
    const key = data.cuiDistStatement as keyof typeof MANUAL_DISTRIBUTION;
    const determined = parseISO(data.distDate ?? '');
    const statement = MANUAL_DISTRIBUTION[key]?.replaceAll('(category)', data.distReason ?? '')
      .replaceAll('(date of determination)', isValid(determined) ? format(determined, 'd MMMM yyyy') : data.distDate ?? '')
      .replaceAll('(insert controlling DoD office)', data.controllingOffice ?? '');
    if (statement) word.text(`DISTRIBUTION STATEMENT ${key}: ${statement}`, { size: 8 });
  } else if (data.cuiDistStatement) word.text(documentDistributionStatement(data), { size: 8 });
  if (data.exportRestricted) word.text(EXPORT_WARNING, { size: 8 });
  if (manual && data.cuiDistStatement && data.cuiDistStatement !== 'A') word.text(MANUAL_DESTRUCTION, { size: 8 });
  if (manual && m) for (const notice of [m.copyrightCredit, m.governmentRights]) if (notice) word.text(notice, { size: 8 });
}

export function authentication(word: PublicationWordPackage, data: Partial<DocumentData>, referenceDate: Date, manual = false, opening?: string): void {
  const m = manual ? data.manualFrontMatter : undefined;
  if (m) word.text(m.service, { bold: true, align: 'center', after: 4 });
  word.text([data.unitLine1?.toUpperCase(), data.unitLine2, data.unitAddress].filter(Boolean).join('\n'), { align: 'center', after: 8 });
  const issued = formatPublicationDate(data.date ?? '', referenceDate);
  word.text(manual || ['sl3', 'sl4'].includes(data.docType ?? '') ? issued.toUpperCase() : issued, { align: 'right', after: 8 });
  const type = m ? manualType(m.subtype)[1] : data.docType === 'sl3' ? 'Components Stock List SL-3' : data.docType === 'sl4' ? 'Components Stock List SL-4' : publicationTypeName(data.publicationType);
  word.text(opening ? `1.  ${opening}` : `1.  This ${type}, ${m?.subtype === 'ietm' ? 'IETM ' : ''}${data.shortTitle ?? ''}, is authenticated for Marine Corps use and is effective upon receipt.`, { after: 8 });
  word.text(`2.  ${HAZARDS}`, { after: 8 });
  word.text('All significant hazards that have the potential to affect other commands and require widespread dissemination shall be reported via a Hazard Report per MCO 5100.29_.', { after: 8 });
  word.text('3.  Use TDM-Publications portal, at https://app.mcboss.usmc.mil/, as your central resource for all publication feedback and support. Please use this single portal to:', { after: 4 });
  for (const text of ['a.  Submit a Change Request to report discrepancies or suggest changes.', 'b.  Access Knowledge Base Articles (KBA) for self-help and guidance (including the Change Request Process).', 'c.  Open a Support Case for any further questions not addressed by the KBA.']) word.text(text, { indent: 18, after: 4 });
  word.text(`4.  For concerns/issues with the content/procedures contact Equipment Specialist or designated Program Office representative ${m?.contentContact || data.pocEmail || ''}`.trim().replace(/\.+$/, '') + '.', { after: 8 });
  if (m && m.dfarClause !== 'none') word.text(`5.  DFAR ${m.dfarClause} was incorporated into the acquisition contract; therefore, a separate copyright release letter is not required for this publication.`, { after: 8 });
  if (!manual && data.docType === 'i_type' && (data.publicationType ?? 'MI') === 'MI') word.text('5.  GCSS-MC Recording. Ensure appropriate records are updated in accordance with (IAW) GCSS-MC User Manual 4000-125, Vol 3.', { after: 8 });
  word.text('OFFICIAL', { underline: true, before: 12, after: 36 });
  word.text([abbreviatedSignatoryName(data.sigFirst, data.sigMiddle, data.sigLast), data.sigTitle, data.controllingOffice].filter(Boolean).join('\n'), { after: 12 });
  word.text('DISTRIBUTION: EDO');
}

export function manualCover(word: PublicationWordPackage, data: Partial<DocumentData>, seal: Uint8Array, referenceDate: Date, section: SectionFormat): void {
  const m = data.manualFrontMatter;
  if (!m) throw new Error('Complete the TM/IETM publication data before Word export.');
  const [cover] = manualType(m.subtype);
  word.text(data.shortTitle ?? '', { bold: true, size: 24, align: 'right', after: 4 });
  if (m.volume || m.volumes) word.text(`VOLUME ${m.volume} OF ${m.volumes}`, { bold: true, size: 14, align: 'right' });
  const technicalHeading = cover.includes('TECHNICAL MANUAL');
  word.text(`U.S. MARINE CORPS ${technicalHeading ? cover : 'TECHNICAL MANUAL'}`, { bold: true, size: 14, align: 'center' });
  if (!technicalHeading) word.text(cover, { bold: true, size: 14, align: 'center' });
  word.text((data.subject ?? '').toUpperCase(), { style: 'Title', bold: true, size: 14, align: 'center' });
  for (const line of [m.maintenanceLevel, data.nomenclature, m.subtitle]) if (line) word.text(line.toUpperCase(), { bold: true, size: line === data.nomenclature ? 18 : 14, align: 'center' });
  word.image(seal, 'png', 120, 120, 'United States Marine Corps seal');
  if (m.endItems.length > 6) {
    word.text('END ITEMS: See end-item continuation.', { align: 'center' });
  } else endItemTable(word, m.endItems, 6);
  publicationNotices(word, data, true);
  const issued = publicationDate(data.date ?? '', referenceDate);
  word.text(isValid(issued) ? format(issued, 'MMMM yyyy').toUpperCase() : data.date ?? '', { bold: true, size: 14, align: 'right', before: 6 });
  word.text(`PCN ${(data.pcn ?? '').replace(/\s/g, '').replace(/^(\d{3})(\d{6})(\d{2})$/, '$1 $2 $3')}`, { bold: true, align: 'right' });
  if (m.endItems.length > 6) {
    word.endSection({ ...section, prefix: 'T-', start: 1, cover: true, hidePageNumber: true });
    word.heading('END ITEM CONTINUATION');
    endItemTable(word, m.endItems);
  }
  word.endSection({ ...section, prefix: 'T-', start: m.endItems.length > 6 ? 2 : 1, cover: m.endItems.length <= 6, hidePageNumber: m.endItems.length <= 6 });
  authentication(word, data, referenceDate, true);
}
