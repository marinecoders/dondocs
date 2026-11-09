import { describe, expect, it } from 'vitest';
import { DISCREPANCY_NOTICE, MI_REPORTING } from '@/data/techpub/sections';
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

  it.each(['Operating Forces Support Desk, office@example.mil', 'Mr. John Q. Doe, 703.555.0100'])('accepts a valid contact without confusing it with reporting text: %s', (contact) => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact ${contact}. ${DISCREPANCY_NOTICE}`)).toEqual([]);
  });

  it.each(['office@example..mil', 'office@-example.mil', 'office@example-.mil', 'office..team@example.mil', 'office@example.mil__', 'team12345678@invalid', 'https://example.mil/12345678', '1234567890123456'])('rejects a malformed or missing contact: %s', (contact) => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact ${contact}. ${DISCREPANCY_NOTICE}`)).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('does not borrow numbers from another administrative subparagraph', () => {
    const paragraphs: Paragraph[] = [purpose,
      { level: 0, header: 'Administrative Instructions', text: '' },
      { level: 1, header: 'Point of Contact', text: 'For questions or concerns with the content or procedures in this Technical Instruction (TI) contact the program office.' },
      { level: 1, header: 'Tracking', text: 'Procurement case 12345678 remains open.' },
      { level: 1, header: 'Notice of Discrepancies', text: DISCREPANCY_NOTICE },
    ];
    expect(validatePublicationStructure(paragraphs, 'TI').map((finding) => finding.message)).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('requires the complete word contact in the prescribed sentence', () => {
    const messages = findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contactless equipment is used. For assistance contact office@example.mil. ${DISCREPANCY_NOTICE}`);
    expect(messages.some((message) => message.includes('point-of-contact sentence'))).toBe(true);
  });

  it('recognizes MI-only reporting even when pasted with line breaks', () => {
    const messages = findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact office@example.mil. ${DISCREPANCY_NOTICE} ${MI_REPORTING.replace('will not', 'will\nnot')}`);
    expect(messages.some((message) => message.includes('Remove the MI reporting'))).toBe(true);
  });

  it.each(['TI', 'SI', 'LI'] as const)('keeps formatted or differently capitalized MI reporting out of a %s', (type) => {
    const store = toStore(companionPublication(type));
    store.paragraphs[1].text += ` **${MI_REPORTING.toUpperCase().replace('WILL NOT', 'WILL\nNOT')}**`;
    expect(iTypeExportErrors(store).some((message) => message.includes('Remove the MI reporting'))).toBe(true);
  });

  it.each(['MI', 'TI', 'SI', 'LI'] as const)('accepts complete %s contacts in separate subparagraphs and combined prose', (type) => {
    const name = { MI: 'Modification', TI: 'Technical', SI: 'Supply', LI: 'Lubrication' }[type];
    for (const contact of ['Operating Forces Support Desk, office@example.mil', 'Dr. Jane A. Doe, office+support@example.mil', 'Mr. John Q. Doe, (703) 555-0100', '703.555.0100', 'DSN 278-1234', '+44 20 7946 0958', '703-555-0100, 703-555-0101', '<office@example.mil>', 'mailto:office@example.mil']) {
      for (const lead of [`For questions or concerns with the content or procedures in this ${name} Instruction (${type}) contact`, `For concerns / issues with the content / procedures in this ${name} Instruction (${type}) contact`]) {
        const store = toStore(companionPublication(type));
        const contactText = `${lead} ${contact}.`;
        const reporting = type === 'MI' ? MI_REPORTING : '';
        store.paragraphs[1].text = `${contactText} ${DISCREPANCY_NOTICE} ${reporting}`;
        expect(iTypeExportErrors(store), `${type}: ${contact}`).toEqual([]);
        store.paragraphs[1].text = '';
        store.paragraphs.push(
          { level: 1, header: 'Point of Contact', text: contactText },
          { level: 1, header: 'Notice of Discrepancies', text: DISCREPANCY_NOTICE },
          ...(type === 'MI' ? [{ level: 1, header: 'Reporting Instructions', text: reporting }] : []),
        );
        expect(iTypeExportErrors(store), `${type} subparagraphs: ${contact}`).toEqual([]);
      }
    }
  });

  it.each(['figure', 'callout'] as const)('does not use %s text to supply a missing contact or notice', (kind) => {
    const paragraphs: Paragraph[] = [purpose,
      { level: 0, header: 'Administrative Instructions', text: 'For questions or concerns with the content or procedures in this Technical Instruction (TI) contact the program office.' },
      { level: 1, text: `Contact office@example.mil. ${DISCREPANCY_NOTICE}`, ...(kind === 'figure' ? { figure: { name: 'Example' } } : { callout: 'note' as const }) },
    ];
    const messages = validatePublicationStructure(paragraphs, 'TI').map((finding) => finding.message);
    expect(messages.some((message) => message.includes('NAVMC 10772'))).toBe(true);
    expect(messages).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('handles long contact-free prose without treating it as a phone or mailbox', () => {
    expect(findings(`For questions or concerns with the content or procedures in this Technical Instruction (TI) contact ${'('.repeat(50_000)}. ${DISCREPANCY_NOTICE}`)).toContain('Administrative Instructions needs a contact phone number or section mailbox email.');
  });

  it('checks the visible text when contact and notice text uses editor formatting', () => {
    expect(findings(`**For questions or concerns with the content or procedures in this Technical Instruction (TI) contact** __office@example.mil__. ${DISCREPANCY_NOTICE.replace('NAVMC 10772', '*NAVMC 10772*')}`)).toEqual([]);
  });
});
