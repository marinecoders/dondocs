import type { Paragraph } from '@/types/document';

export const PUBLICATION_SECTIONS = {
  purpose: 'Purpose',
  administration: 'Administrative Instructions',
  supersedure: 'Supersedure Notice',
  timeCompliance: 'Time Compliance Period',
  information: 'Information',
  manuals: 'Technical Manuals Affected',
  majorItems: 'Major Items Affected',
  components: 'Components Affected',
  materiel: 'Materiel Affected',
  materielRequired: 'Materiel Required',
  materielDiscarded: 'Materiel Discarded',
  materielRetained: 'Materiel Retained',
  materielBulk: 'Bulk and Consumable Materiel',
  tooling: 'Special Tools, Jigs, and Fixtures Required',
  specialTools: 'Special Tools',
  jigsFixtures: 'Jigs and Fixtures',
  specialInstructions: 'Special Instructions',
  supply: 'Supply Action',
  skill: 'Skill and Time Required',
  procedures: 'Procedures',
} as const;

export type PublicationSection = keyof typeof PUBLICATION_SECTIONS;
export const sectionTitle = (text = '') => text.trim().replace(/\.$/, '').toLowerCase();

/** Recognize older documents without changing their content. */
export function publicationSection(p: Pick<Paragraph, 'publicationSection' | 'header'>): PublicationSection | undefined {
  if (p.publicationSection) return p.publicationSection;
  return (Object.keys(PUBLICATION_SECTIONS) as PublicationSection[])
    .find((key) => sectionTitle(PUBLICATION_SECTIONS[key]) === sectionTitle(p.header));
}

// MIL-DTL-28999D §§3.3.2.2.2–3.3.2.2.3. Review contact details before release.
export const DISCREPANCY_NOTICE = 'Discrepancies or suggested changes for this publication may be reported by submitting a NAVMC 10772. For instructions on how to submit a NAVMC 10772, go to https://mceits.usmc.mil/sites/pubs/default.aspx and click on “NAVMC 10772 Submittal.” Questions or concerns regarding the NAVMC 10772 program should be reported via email to SMB.LOG.Tech.Pubs.fct@usmc.mil. A response will be provided to you.';
export const MI_REPORTING = 'Operating Forces (GCSS-MC users) will not manually add Modification Instructions (MI) into GCSS-MC Installed Base. Utilize manual reporting methods for tracking until loaded into GCSS-MC.';
