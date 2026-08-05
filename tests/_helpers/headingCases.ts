/**
 * Paragraph headings as an author types them, and what each must still read
 * once rendered. Shared by the PDF and DOCX casing tests so the two formats
 * are held to the identical strings and cannot drift apart.
 *
 * Most entries are lifted from the manuals rather than invented: FOIA, HqDON,
 * E-mail and the slash form are real SECNAV M-5216.5 paragraph headings, and
 * MedEvac/HQMC/USMC are MCO 5216.20B Ch 13 ¶5b's own examples of forms that
 * keep their capitals.
 */
export const HEADING_CASES: { typed: string; rendered: string }[] = [
  // MCO Ch 13 ¶5b's own examples.
  { typed: 'MedEvac and HQMC Support', rendered: 'MedEvac and HQMC Support' },
  { typed: 'USMC Correspondence', rendered: 'USMC Correspondence' },
  // Ch 13 ¶7's unit forms.
  { typed: 'Support From 1st MarDiv and COMMARFORPAC', rendered: 'Support From 1st MarDiv and COMMARFORPAC' },
  // Real SECNAV M-5216.5 headings.
  { typed: 'HqDON Correspondence', rendered: 'HqDON Correspondence' },
  { typed: 'Acting for the Commander/Commanding Officer', rendered: 'Acting for the Commander/Commanding Officer' },
  { typed: 'FOIA', rendered: 'FOIA' },
  { typed: 'E-mail', rendered: 'E-mail' },
  // The heading a reviewer in the field marked up.
  { typed: 'Tropical Cyclone Conditions of Readiness TCCOR Milestones', rendered: 'Tropical Cyclone Conditions of Readiness TCCOR Milestones' },
  { typed: 'Conditions-Based Securing Matrix', rendered: 'Conditions-Based Securing Matrix' },
  // Commas survive the Word export too; they used to be deleted there only.
  { typed: 'Roles, Duties, and Limits', rendered: 'Roles, Duties, and Limits' },
  // An acronym that spells a minor word ("at", "so") is still an acronym.
  { typed: 'Force Protection and AT Measures', rendered: 'Force Protection and AT Measures' },
  { typed: 'Coordination With SO Units', rendered: 'Coordination With SO Units' },
  // Ordinary prose still gets Title Cased, minor words still stay down.
  { typed: 'scope of this policy', rendered: 'Scope of This Policy' },
  { typed: 'rules for a unit', rendered: 'Rules for a Unit' },
];
