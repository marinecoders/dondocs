// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderPdf } from '../../companion/render';
import { toStore, type LetterInput } from '../../companion/letterInput';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

// The vendored SwiftLaTeX engine and browser template bundle are used here,
// not native TeX or tex/ sources. This runs in the normal npm test CI gate.
const correspondenceTypes = [
  'naval_letter', 'standard_letter', 'business_letter', 'multiple_address_letter',
  'joint_letter', 'same_page_endorsement', 'new_page_endorsement',
  'mfr', 'mf', 'plain_paper_memorandum', 'letterhead_memorandum',
  'standard_memorandum', 'joint_memorandum', 'executive_memorandum',
  'action_memorandum', 'information_memorandum', 'decision_memorandum',
  'executive_correspondence', 'moa', 'mou',
] as const;

const statements = {
  A: 'DISTRIBUTION STATEMENT A: Approved for public release: distribution is unlimited.',
  B: 'DISTRIBUTION STATEMENT B: Distribution authorized to U.S. Government agencies.',
  C: 'DISTRIBUTION STATEMENT C: Distribution authorized to U.S. Government agencies and their contractors.',
  D: 'DISTRIBUTION STATEMENT D: Distribution authorized to Department of Defense and U.S. DoD contractors only.',
  E: 'DISTRIBUTION STATEMENT E: Distribution authorized to DoD Components only.',
  F: 'DISTRIBUTION STATEMENT F: Further distribution only as directed or higher DoD authority.',
};

function input(docType: string, statement = 'F', level = 'cui'): LetterInput {
  return {
    docType, subject: 'DISTRIBUTION VERIFICATION', from: 'Commanding Officer', to: 'Commanding General',
    classification: { level, cui: { controlledBy: 'Test Command', category: 'CTI', distStatement: statement } },
    references: [{ title: 'Reference verification' }],
    enclosures: [{ title: 'Enclosure verification' }],
    paragraphs: [{ text: 'Fictional training correspondence.' }],
  };
}

async function verifyStatement(request: LetterInput, expected: string) {
  const { boxes } = await pdfTextLayout(await renderPdf(request));
  const start = boxes.findIndex(b => b.text.includes('DISTRIBUTION STATEMENT'));
  const ref = boxes.findIndex(b => b.text.includes('Ref:'));
  expect(start, 'the PDF must label the statement').toBeGreaterThanOrEqual(0);
  expect(ref, 'the reference must follow the statement').toBeGreaterThan(start);
  const statement = boxes.slice(start, ref);
  expect(statement.map(b => b.text).join(' ').replace(/\s+/g, ' ')).toBe(expected);
  expect(boxes.filter(b => b.text.includes('DISTRIBUTION STATEMENT'))).toHaveLength(1);
  for (const line of statement) {
    expect(line.page).toBe(boxes[ref].page);
    expect(line.left).toBeGreaterThanOrEqual(71);
    expect(line.right).toBeLessThanOrEqual(541);
    // Ending the paragraph must put Ref below every line, with a blank line.
    expect(line.bottom - boxes[ref].top).toBeGreaterThan(6);
  }
  // Word consumes the flat generator. Its statement must match the PDF text.
  expect(generateFlatLatex(toStore(request, {}))).toContain(expected);
}

describe('CUI distribution statements in rendered correspondence', () => {
  it.each(correspondenceTypes)('%s gives statement F its own labelled paragraph', async docType => {
    await verifyStatement(input(docType), statements.F);
  }, 60_000);

  it.each(['A', 'B', 'C', 'D', 'E'] as const)('prints the full wording for %s in PDF and Word', async letter => {
    await verifyStatement(input('naval_letter', letter), statements[letter]);
  }, 60_000);

  it('preserves a supplied full statement without expanding its first letter', async () => {
    const statement = 'DISTRIBUTION STATEMENT F: Further distribution only as directed by Test Command (6 November 2026) or higher DoD authority.';
    await verifyStatement(input('naval_letter', statement), statement);
  }, 60_000);

  it.each([
    ['cui', ''], ['unclassified', 'F'], ['secret', 'F'],
  ])('omits the statement for level %s and selection %j', async (level, statement) => {
    const { boxes } = await pdfTextLayout(await renderPdf(input('naval_letter', statement, level)));
    expect(boxes.map(b => b.text).join(' ')).not.toMatch(/DISTRIBUTION STATEMENT|Distribution Statement|Further distribution/);
    expect(boxes.some(b => b.text.includes('Ref:'))).toBe(true);
  }, 60_000);
});
