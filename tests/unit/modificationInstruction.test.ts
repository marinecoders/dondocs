import { describe, it, expect } from 'vitest';
import { modificationInstruction } from '@/data/templates/technical';
import { LETTER_TEMPLATES } from '@/data/templates';
import { DOC_TYPE_CONFIG } from '@/types/document';

// MIL-STD-38784C fixes both the titles and their order; an author fills the
// paragraphs in and removes the ones that do not apply, but changes nothing
// else. Encoding that here means a well-meaning edit to the wording of a
// heading fails rather than silently shipping a non-compliant publication.
const CANONICAL_TITLES = [
  'Purpose',
  'Administrative Instructions',
  'Time Compliance Period',
  'Information',
  'Technical Manuals Affected',
  'Major Items Affected',
  'Components Affected',
  'Materiel Affected',
  'Special Tools, Jigs, and Fixtures Required',
  'Special Instructions',
  'Supply Action',
  'Skill and Time Required',
  'Procedures',
];

describe('Modification Instruction template', () => {
  it('keeps the standard’s paragraph titles, in order', () => {
    expect(modificationInstruction.paragraphs.map((p) => p.header)).toEqual(CANONICAL_TITLES);
  });

  it('targets a registered document type', () => {
    expect(DOC_TYPE_CONFIG[modificationInstruction.docType]).toBeDefined();
  });

  it('is offered in the template library', () => {
    expect(LETTER_TEMPLATES).toContain(modificationInstruction);
  });
});
