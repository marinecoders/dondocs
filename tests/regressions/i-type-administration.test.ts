import { describe, expect, it } from 'vitest';
import { DISCREPANCY_NOTICE } from '@/data/techpub/sections';
import { validatePublicationStructure } from '@/lib/publicationRules';
import { iTypeExportErrors } from '@/lib/iTypePreflight';
import { toStore } from '../../companion/letterInput';
import { companionPublication } from '../_helpers/companionPublication';
import type { Paragraph } from '@/types/document';

// A technical writer reported that pasted template text still raised the
// Administrative Instructions warnings. Keep genuine omissions visible while
// accepting the specification's example wording and punctuation in contacts.
const purpose: Paragraph = { level: 0, header: 'Purpose', text: 'Inspect the equipment.' };
const reportedContact = 'For concerns/issues with the content/procedures contact Equipment Specialist or designated Program Office representative John Doe, jdoe@usmc.mil, 123-456-7890. (Paragraph may be removed if not needed.)';
const findings = (text: string) => validatePublicationStructure([
  purpose, { level: 0, header: 'Administrative Instructions', text },
], 'TI').map((finding) => finding.message);

describe('pasted I-Type administrative instructions', () => {
  it('accepts the slash wording in MIL-DTL-28999D figure 1', () => {
    expect(findings(`For concerns/issues with the content/procedures in this Technical Instruction (TI) contact office@example.mil. ${DISCREPANCY_NOTICE}`)).toEqual([]);
  });

  it.each(['Mr. John Q. Doe, john.doe@example.mil', 'Mr. John Q. Doe, (703) 555-0100'])('accepts punctuation before a valid contact: %s', (contact) => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact ${contact}. ${DISCREPANCY_NOTICE}`)).toEqual([]);
  });

  it('does not use the NAVMC notice mailbox as the publication point of contact', () => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact the program office. ${DISCREPANCY_NOTICE}`)).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it.each(['[PHONE OR SECTION MAILBOX EMAIL]', '123-456'])('still requires actual contact details: %s', (contact) => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact ${contact}. ${DISCREPANCY_NOTICE}`)).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('still requires the selected instruction type in the contact sentence', () => {
    expect(findings(`For concerns/issues with the content/procedures in this Supply Instruction (SI) contact office@example.mil. ${DISCREPANCY_NOTICE}`).some((message) => message.includes('Technical Instruction (TI) contact'))).toBe(true);
  });

  it('explains why the reported removable paragraph is incomplete', () => {
    const messages = findings(reportedContact);
    expect(messages.some((message) => message.includes('NAVMC 10772'))).toBe(true);
    expect(messages.some((message) => message.includes('Technical Instruction (TI) contact'))).toBe(true);
    expect(messages).not.toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('still blocks export of the exact reported paragraph with both missing-content findings', () => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs[1].text = reportedContact;
    const errors = iTypeExportErrors(store);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('NAVMC 10772');
    expect(errors[1]).toContain('Technical Instruction (TI) contact');
  });

  it('still blocks export when Administrative Instructions is removed', () => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs = store.paragraphs.slice(0, 1);
    const errors = iTypeExportErrors(store);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Administrative Instructions is required');
  });

  it('clears export checks after adding the missing type wording and NAVMC notice', () => {
    const store = toStore(companionPublication('TI'));
    store.paragraphs[1].text = `For concerns/issues with the content/procedures in this Technical Instruction (TI) contact Equipment Specialist or designated Program Office representative John Doe, jdoe@usmc.mil, 123-456-7890. ${DISCREPANCY_NOTICE}`;
    expect(iTypeExportErrors(store)).toEqual([]);
  });
});
