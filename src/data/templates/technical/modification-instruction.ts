import type { LetterTemplate } from '../types';

/**
 * Modification Instruction (MI) — the I-Type that directs a change to
 * equipment already in the fleet.
 *
 * The paragraphs below are not a suggested starting point the way a letter
 * template is. MIL-STD-38784C fixes their titles and their order: an author
 * fills them in, removes the ones that do not apply, and changes nothing else.
 * Numbering closes over whatever is removed on its own.
 *
 * SI, TI and LI share this skeleton; only the Recording Instruction on the
 * signature page is MI-only. Tables belong to the paragraphs that carry them
 * (Major Items, Components, Materiel, Special Tools) and are still to come.
 */
export const modificationInstruction: LetterTemplate = {
  id: 'modification-instruction',
  name: 'Modification Instruction (MI)',
  category: 'Technical Publications',
  description: 'Directs a modification to fielded equipment, with a time compliance period',
  docType: 'i_type',
  publicationType: 'MI',
  subject: 'INSERT LONG TITLE HERE',
  paragraphs: [
    {
      header: 'Purpose',
      text: 'To provide instructions for [SYSTEM NAME], TAMCN [TAMCN], NSN [NSN]. [State applicability here if required.]',
      level: 0,
    },
    {
      header: 'Administrative Instructions',
      text: 'For concerns or issues with the content or procedures contact [EQUIPMENT SPECIALIST OR PROGRAM OFFICE REPRESENTATIVE], [EMAIL], [PHONE]. [Remove this paragraph if not needed.]',
      level: 0,
    },
    {
      header: 'Time Compliance Period',
      text: 'Complete this modification by [DATE]. [An URGENT MI must give a completion date less than one year out. A NORMAL MI runs one year and this paragraph is omitted unless the period differs.]',
      level: 0,
    },
    {
      header: 'Information',
      text: 'This modification instruction contains procedures for [DESCRIBE THE MODIFICATION].',
      level: 0,
    },
    {
      header: 'Technical Manuals Affected',
      text: '[Name every technical publication this document changes, in sentence form. Do not put this list in a table.]',
      level: 0,
    },
    {
      header: 'Major Items Affected',
      tableKey: 'majorItems',
      text: '[Identify all major military equipment items affected, in numeric order by ID number.]',
      level: 0,
    },
    {
      header: 'Components Affected',
      tableKey: 'components',
      text: '[List the components affected.]',
      level: 0,
    },
    {
      header: 'Materiel Affected',
      text: '[Remove any of the four that do not apply.]',
      level: 0,
    },
    { header: 'Materiel Required', text: '', level: 1, tableKey: 'materielRequired' },
    {
      header: 'Materiel Discarded',
      text: 'Dispose of discarded materiel in accordance with current Marine Corps directives.',
      level: 1,
      tableKey: 'materielDiscarded',
    },
    { header: 'Materiel Retained', text: '', level: 1, tableKey: 'materielRetained' },
    { header: 'Bulk and Consumable Materiel', text: '', level: 1, tableKey: 'materielBulk' },
    {
      header: 'Special Tools, Jigs, and Fixtures Required',
      text: '[Remove either sub-paragraph if it does not apply.]',
      level: 0,
    },
    { header: 'Special Tools', text: '', level: 1, tableKey: 'specialTools' },
    { header: 'Jigs and Fixtures', text: '', level: 1, tableKey: 'jigsFixtures' },
    {
      header: 'Special Instructions',
      text: '[List any special instructions needed to complete the modification. Remove if none exist.]',
      level: 0,
    },
    {
      header: 'Supply Action',
      text: '[List any supply information or directions. Remove if no supply action exists.]',
      level: 0,
    },
    {
      header: 'Skill and Time Required',
      text: '[Indicate every MOS and the time required to complete the action, per NAVMC 1008-A.]',
      level: 0,
    },
    {
      header: 'Procedures',
      text: '[First step of the procedure.]',
      level: 0,
    },
  ],
};
