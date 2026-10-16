import { describe, expect, it } from 'vitest';
import type { Paragraph } from '@/types/document';
import { DISCREPANCY_NOTICE, MI_REPORTING } from '@/data/techpub/sections';
import { validatePublicationStructure } from '@/lib/publicationRules';
import { modificationInstruction } from '@/data/templates/technical/modification-instruction';
import { technicalInstruction, supplyInstruction, lubricationInstruction } from '@/data/templates/technical/i-type-instructions';

const purpose: Paragraph = { level: 0, header: 'Purpose', text: 'Inspect the equipment.' };
const admin = (type = 'MI'): Paragraph => ({ level: 0, header: 'Administrative Instructions', text: `For questions or concerns with the content or procedures in this ${{ MI: 'Modification', TI: 'Technical', SI: 'Supply', LI: 'Lubrication' }[type]} Instruction (${type}) contact office@example.mil. ${DISCREPANCY_NOTICE} ${type === 'MI' ? MI_REPORTING : ''}` });

describe('publication structure', () => {
  it('keeps authored procedures beneath a body procedure heading', () => {
    const steps: Paragraph[] = [{ level: 1, procedure: true, text: 'Inspect the bracket.' }, { level: 1, procedure: true, text: 'Record the result.' }];
    const skill: Paragraph = { level: 0, header: 'Skill and Time Required', text: 'Equipment technician, 0.5 hours.' };
    const heading: Paragraph = { level: 0, header: 'Inspect the bracket', publicationSection: 'procedures', text: '' };
    const appendix: Paragraph = { level: 0, header: 'Reference data', appendix: true, text: '' };
    expect(validatePublicationStructure([purpose, admin(), skill, heading, ...steps, appendix, { level: 0, text: 'Reference data.' }])).toEqual([]);
    expect(validatePublicationStructure([purpose, admin(), appendix, heading, ...steps]).map((f) => f.message).join(' ')).toContain('not an appendix');
    expect(validatePublicationStructure([purpose, admin(), skill, ...steps]).map((f) => f.message).join(' ')).toContain('beneath an action-specific');
  });
  it('rejects missing administration, misspelled headings and deleted prescribed content', () => {
    expect(validatePublicationStructure([purpose]).map((f) => f.message).join(' ')).toContain('Administrative Instructions is required');
    expect(validatePublicationStructure([purpose, { ...admin(), header: 'Administrativ Instructions' }])).not.toEqual([]);
    expect(validatePublicationStructure([purpose, { ...admin(), text: 'Contact office@example.mil.' }]).map((f) => f.message).join(' ')).toContain('NAVMC 10772');
  });
  it('retains section identity when its heading is changed', () => {
    const findings = validatePublicationStructure([purpose, { ...admin(), publicationSection: 'administration', header: 'Other' }]);
    expect(findings.map((f) => f.message)).toContain('Restore the heading "Administrative Instructions".');
  });
  it('permits promoted subsections and action-specific procedures', () => {
    expect(validatePublicationStructure([purpose, admin(), { level: 0, header: 'Materiel Required', text: 'None.' }, { level: 0, header: 'Skill and Time Required', text: 'Equipment technician, 0.5 hours.' }, { level: 0, header: 'Inspection', publicationSection: 'procedures', text: 'Inspect the bracket.' }])).toEqual([]);
  });
  it('keeps MI reporting out of other subtypes', () => {
    for (const type of ['TI', 'SI', 'LI']) {
      expect(validatePublicationStructure([purpose, admin(type)], type)).toEqual([]);
      expect(validatePublicationStructure([purpose, admin()], type).map((f) => f.message).join(' ')).toContain('Remove the MI reporting');
    }
  });
  it('ships valid structure in all four templates after entering a contact', () => {
    for (const template of [modificationInstruction, technicalInstruction, supplyInstruction, lubricationInstruction]) {
      const paragraphs = template.paragraphs.map((p) => ({ ...p, text: p.text.replace('[PHONE OR SECTION MAILBOX EMAIL]', 'office@example.mil') }));
      expect(validatePublicationStructure(paragraphs, template.publicationType)).toEqual([]);
    }
  });
});
