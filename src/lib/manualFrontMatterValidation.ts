import { stockPublicationPrompt } from './stockPublicationText';
import { isValid, parseISO } from 'date-fns';
import { MANUAL_DOC_TYPE, manualFrontMatterSchema, manualType } from '@/data/techpub/manualFrontMatter';
import type { DocumentData } from '@/types/document';
import { validatePublicationDate } from './publicationDate';
import { publicationDate } from './timeCompliance';
import { validateDistributionFillIns, validateReasonForStatement } from './classificationValidation';

export interface ManualFinding { section: 'manual-publication' | 'manual-items' | 'manual-notices' | 'manual-authentication'; message: string; fields?: string[] }
export interface ManualStore { docType: string; formData: Partial<DocumentData> }

/** Check author inputs; rendered measurements are checked separately by the PDF renderer. */
export function manualFrontMatterFindings(store: ManualStore): ManualFinding[] {
  if (store.docType !== MANUAL_DOC_TYPE) return [];
  const d = store.formData;
  const findings: ManualFinding[] = [];
  const add = (section: ManualFinding['section'], message: string, fields?: string[]) => findings.push({ section, message, ...(fields?.length ? { fields } : {}) });
  const parsed = manualFrontMatterSchema.safeParse(d.manualFrontMatter ?? {});
  if (!parsed.success) return [{ section: 'manual-publication', message: 'The manual front-matter data is invalid. Select a supported subtype and correct its fields.' }];
  const m = parsed.data;
  for (const [key, label, section] of [
    ['shortTitle', 'Short title', 'manual-publication'], ['pcn', 'PCN', 'manual-publication'],
    ['subject', 'Long title', 'manual-publication'], ['nomenclature', 'Nomenclature', 'manual-publication'],
    ['unitLine1', 'Issuing entity', 'manual-authentication'], ['unitAddress', 'Mailing address', 'manual-authentication'],
    ['sigLast', 'Signing official name', 'manual-authentication'], ['sigTitle', 'Signing authority title', 'manual-authentication'],
    ['controllingOffice', 'Controlling office', 'manual-authentication'],
  ] as const) if (!String(d[key] ?? '').trim()) add(section, `${label} is required.`, [key]);
  if (d.pcn?.trim() && !/^\d{11}$/.test(d.pcn.replace(/\s/g, ''))) add('manual-publication', 'PCN must contain eleven digits.', ["pcn"]);
  const prefix = manualType(m.subtype)[2];
  const shortTitle = d.shortTitle?.trim() ?? '';
  if (shortTitle && m.shortTitleBasis === 'sponsor_assigned') {
    if (!/^[A-Z][A-Z0-9/-]*\s+\S[^\r\n]*$/.test(shortTitle) || !/\d/.test(shortTitle))
      add('manual-publication', 'Enter the complete sponsor-assigned publication number, including its numeric identifier.', ["shortTitle"]);
    if (!m.shortTitleApproval.trim()) add('manual-publication', 'Identify the assigning activity and approval reference for the sponsor-assigned short title.', ["shortTitleApproval"]);
  } else if (shortTitle) {
    if (!shortTitle.startsWith(`${prefix} `)) add('manual-publication', `The selected publication uses an uppercase ${prefix} short title.`, ['shortTitle']);
    // ID (five digits plus suffix, excluding I/O), multi-model ID, FSC or SSIC;
    // optional maintenance/parts, sequence and edition (excluding I/O/Q/S/Z).
    const number = shortTitle.slice(prefix.length + 1);
    if (!/^(?:\d{4,5}|\d{5}[A-HJ-NP-Z])(?:-(?:10|20|30|40|50|12|13|14|15|23|24|25|34|35|45)(?:&P|P)?(?:\/[1-9]\d*)?[A-HJ-NPRT-Y]?)?$/.test(number))
      add('manual-publication', 'Review the assigned short title: use an ID/FSC/SSIC basic number and valid maintenance, parts, sequence and edition designators, or select a reviewed sponsor-assigned number.', ["shortTitle"]);
  }
  if (!isValid(publicationDate(d.date ?? ''))) add('manual-publication', 'Enter a valid publication date.', ["date"]);
  if (!d.publicationSigningDate || !/^\d{4}-\d{2}-\d{2}$/.test(d.publicationSigningDate) || !isValid(parseISO(d.publicationSigningDate)))
    add('manual-publication', 'Enter a valid signing date.', ["publicationSigningDate"]);
  for (const f of validatePublicationDate(d.date ?? '', d.publicationSigningDate, d.publicationClosedDates)) add('manual-publication', f.message, [f.message.includes('closure') ? 'publicationClosedDates' : f.message === 'Enter a valid signing date.' ? 'publicationSigningDate' : 'date']);
  if (m.volume || m.volumes) {
    if (!/^[1-9]\d*$/.test(m.volume) || !/^[1-9]\d*$/.test(m.volumes) || Number(m.volume) > Number(m.volumes))
      add('manual-publication', 'Enter a volume number and total volumes, with the volume within that total.', ["volume", "volumes"]);
    if (!m.subtitle.trim()) add('manual-publication', 'Enter the subtitle identifying this volume.', ["subtitle"]);
  }
  if (m.subtype === 'supplement' && !m.supplementNotice.trim()) add('manual-notices', 'Identify the publication this supplement supports.', ["supplementNotice"]);
  if (m.copyrightCredit.trim() && !m.governmentRights.trim())
    add('manual-notices', 'Include the owner- or contract-approved statement of government rights to publish, reproduce and distribute with the copyright credit.', ["governmentRights"]);
  if (!m.contentContact.trim()) add('manual-authentication', 'Enter the technical-content contact.', ["contentContact"]);
  if (d.byDirection || /\bby[\s\u2010-\u2015-]+direction\b/i.test(d.sigTitle ?? '')) add('manual-authentication', 'Technical publications cannot be authenticated by direction.', ["sigTitle"]);
  const title = d.sigTitle?.trim() ?? '';
  const pdm = /^(?:(?:acting|interim)\s+)?(?:product manager|pdm)\b/i.test(title);
  const pmOrAbove = /^(?:program manager|program executive officer|portfolio acquisition executive|commander,? marine corps systems command|commanding general,? marine corps systems command)(?:$|\s*[,–—-]\s*\S)/i.test(title);
  if (m.authorityBasis === 'unconfirmed') add('manual-authentication', 'Confirm the signing authority basis before export.', ["authorityBasis"]);
  if (m.authorityBasis === 'pm_or_above' && !pmOrAbove)
    add('manual-authentication', 'Choose a reviewed Program Manager-or-higher title, or record another approved authority basis.', ["sigTitle", "authorityBasis"]);
  if (m.authorityBasis === 'pdm_deviation' && !pdm)
    add('manual-authentication', 'The Product Manager deviation requires a Product Manager/PdM signing title.', ["sigTitle", "authorityBasis"]);
  if (pdm && m.authorityBasis !== 'pdm_deviation')
    add('manual-authentication', 'Product Manager authority requires confirmation of the 21 March 2024 deviation and its applicability.', ["authorityBasis"]);
  if (['pdm_deviation', 'other_approved'].includes(m.authorityBasis) && !m.authorityReference.trim())
    add('manual-authentication', 'Record the applicable delegation or approval reference for this signing authority.', ["authorityReference"]);
  if (/^(?:equipment specialist|assistant program manager|deputy program manager|contractor|technical writer|editor)\b/i.test(title))
    add('manual-authentication', 'This signing title does not establish the required publication authority. Enter the authorized role and its applicable authority basis.', ["sigTitle", "authorityBasis"]);
  if (d.signatureType !== 'digital') add('manual-authentication', 'Use an empty digital signature field for external signing.');
  if (m.endItems.length > 38) add('manual-items', 'This source profile supports up to 38 end items on one continuation page.');
  if (!m.endItems.length) add('manual-items', 'Add the equipment end items covered by this publication.');
  const ids = new Set<string>();
  m.endItems.forEach((item, i) => {
    if (ids.has(item.rowId)) add('manual-items', 'Every end-item row must have a unique row ID.');
    ids.add(item.rowId);
    if (![item.nsn, item.tamcn, item.id, item.model].some((v) => v.trim())) add('manual-items', `End item ${i + 1} is empty. Complete or remove it.`, ['nsn', 'tamcn', 'id', 'model'].map(key => `item-${item.rowId}-${key}`));
    if (!item.id.trim() || !item.model.trim()) add('manual-items', `End item ${i + 1} needs its identification number and model.`, ['id', 'model'].filter(key => !item[key as 'id' | 'model'].trim()).map(key => `item-${item.rowId}-${key}`));
    if (item.nsn.trim() && !/^(\d{13}|\d{4}-\d{2}-\d{3}-\d{4})$/.test(item.nsn.trim())) add('manual-items', `End item ${i + 1}: enter a thirteen-digit NSN or leave an unassigned NSN blank.`, [`item-${item.rowId}-nsn`]);
    if (item.tamcn.trim() && !/^[A-Z]\d{4}[A-Z0-9]{0,2}$/i.test(item.tamcn.trim())) add('manual-items', `End item ${i + 1}: review the TAMCN format.`, [`item-${item.rowId}-tamcn`]);
  });
  if (!['unclassified', 'cui'].includes(d.classLevel ?? 'unclassified')) add('manual-notices', 'This template profile supports unclassified or CUI packets. Review the inherited marking before export.', ["classLevel"]);
  if (!/^[A-F]$/.test(d.cuiDistStatement ?? '')) add('manual-notices', 'Select Distribution Statement A, B, C, D, E or F.', ["cuiDistStatement"]);
  if (d.cuiDistStatement === 'A' && (d.classLevel === 'cui' || d.exportRestricted)) add('manual-notices', 'Public release conflicts with CUI or export-controlled information.', ["classLevel", "cuiDistStatement", "exportRestricted"]);
  if (d.exportRestricted && (!['B', 'C', 'D', 'E'].includes(d.cuiDistStatement ?? '') || d.distReason !== 'Export Controlled')) add('manual-notices', 'Export-controlled information requires Statement B–E and the Export Controlled reason.', ["cuiDistStatement", "distReason", "exportRestricted"]);
  if (['B', 'C', 'D', 'E'].includes(d.cuiDistStatement ?? '') && d.distReason === 'Export Controlled' && !d.exportRestricted) add('manual-notices', 'Include the export-control warning for the selected distribution reason.', ["exportRestricted"]);
  if (['B', 'E'].includes(d.cuiDistStatement ?? '') && m.rightsAssessment === 'unreviewed')
    add('manual-notices', 'Review whether the contract requires limited-rights proprietary markings for this packet.', ["rightsAssessment"]);
  if (m.rightsAssessment === 'limited_rights')
    add('manual-notices', 'This packet profile cannot produce required contract/company proprietary markings and the Limited Rights legend. Use an approved profile for that contract.', ["rightsAssessment"]);
  const missingDistributionFields = [
    d.cuiDistStatement !== 'F' && !d.distReason?.trim() ? 'distReason' : '',
    !d.distDate?.trim() ? 'distDate' : '',
    !d.controllingOffice?.trim() ? 'controllingOffice' : '',
  ].filter(Boolean);
  for (const f of validateDistributionFillIns(d.cuiDistStatement, { reason: d.distReason, date: d.distDate, office: d.controllingOffice })) add('manual-notices', f.message, missingDistributionFields);
  for (const f of validateReasonForStatement(d.cuiDistStatement, d.distReason)) add('manual-notices', f.message, ['distReason']);
  if (d.cuiDistStatement && d.cuiDistStatement !== 'A' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.distDate ?? '') || !isValid(parseISO(d.distDate ?? '')))) add('manual-notices', 'Enter the distribution determination date.', ["distDate"]);
  if (d.classLevel === 'cui') {
    for (const [key, label] of [['cuiControlledBy', 'Controlled by'], ['cuiCategory', 'CUI category'], ['pocEmail', 'CUI contact']] as const)
      if (!d[key]?.trim()) add('manual-notices', `${label} is required for CUI.`, [key]);
  }
  const sourcePrompt = /\(select\b|INSERT (?:LONG TITLE|NOMENCLATURE)|NAME OF SIGNING OFFICIAL|\{\{|#{3,}|\[(?:INSERT|SELECT|PHONE|SYSTEM)\b|\bX{5,}\b|\bphone or email address\b|\bname,\s*email,\s*phone,\s*or\s*team\/pm\b|\bselect (?:publication type|for DFAR clause|supersedure statement)\b|\bchoose (?:letter|applicable distribution statement)\b|\bREL\s+TO\s+USA,\s*LIST\b|\bMONTH\s+YYYY\b|\bVOLUME\s+#\s+OF\s+#/i;
  const promptGroups: [ManualFinding['section'], readonly (readonly [string, string | undefined])[]][] = [
    ['manual-publication', [['subject', d.subject], ['shortTitle', d.shortTitle], ['nomenclature', d.nomenclature], ['maintenanceLevel', m.maintenanceLevel], ['subtitle', m.subtitle], ['shortTitleApproval', m.shortTitleBasis === 'sponsor_assigned' ? m.shortTitleApproval : '']]],
    ['manual-items', m.endItems.flatMap(item => (['nsn', 'tamcn', 'id', 'model'] as const).map(key => [`item-${item.rowId}-${key}`, item[key]] as const))],
    ['manual-notices', [['supersedure', d.supersedure], ...(d.classLevel === 'cui' ? (['cuiControlledBy', 'cuiCategory', 'cuiDissemination', 'pocEmail'] as const).map(key => [key, d[key]] as const) : []), ['supplementNotice', m.supplementNotice], ['volumeNotice', m.volumeNotice], ['copyrightCredit', m.copyrightCredit], ['governmentRights', m.governmentRights]]],
    ['manual-authentication', [['unitLine1', d.unitLine1], ['unitLine2', d.unitLine2], ['unitAddress', d.unitAddress], ['sigFirst', d.sigFirst], ['sigMiddle', d.sigMiddle], ['sigLast', d.sigLast], ['sigTitle', d.sigTitle], ['controllingOffice', d.controllingOffice], ['contentContact', m.contentContact], ['authorityReference', ['pdm_deviation', 'other_approved'].includes(m.authorityBasis) ? m.authorityReference : '']]],
  ];
  for (const [section, entries] of promptGroups) {
    const fields = entries.filter(([, value]) => sourcePrompt.test(value ?? '') || stockPublicationPrompt(value ?? '')).map(([field]) => field);
    if (fields.length) add(section, 'Replace the remaining template prompts before export.', fields);
  }
  return findings;
}

export const manualFrontMatterErrors = (store: ManualStore): string[] => [...new Set(manualFrontMatterFindings(store).map((f) => f.message))];
