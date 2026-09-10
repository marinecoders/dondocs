/**
 * The doc types that used to render with holes now render their content.
 *
 * Each case renders from a request shaped the way the published schema shapes
 * it, then asserts on extracted text. These are the seven types that produced
 * a valid PDF with blank lines or bracketed placeholders where content belongs,
 * because toStore never set the fields the generator reads for them. The
 * surface matrix proves every type compiles; this proves the content arrives.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDefaults, type CompanionDefaults, type LetterInput } from '../../companion/letterInput';
import { renderToFile } from '../../companion/renderToFile';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

let root: string;
let defaults: CompanionDefaults;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-content-'));
  process.env.DONDOCS_CONFIG = '/nonexistent/companion.config.json';
  defaults = await loadDefaults();
}, 60_000);

afterAll(async () => { if (root) { await rm(root, { recursive: true, force: true }); } });

/** Render, then hand back the text so an assertion reads what a reader would. */
async function textOf(input: Partial<LetterInput> & { docType: string }): Promise<string> {
  const file = await renderToFile({ ...input, out: `${input.docType}.pdf` } as LetterInput, defaults, root);
  return spawnSync('pdftotext', ['-layout', file.path, '-'], { encoding: 'utf-8' }).stdout;
}

const parties = {
  senior: {
    name: 'COMMANDANT OF THE MARINE CORPS', from: 'Commandant of the Marine Corps',
    code: 'PP&O', zip: '20380', ssic: '1000', serial: '0001',
    signature: { name: 'David R. Smith', rank: 'General', title: 'Commandant of the Marine Corps' },
  },
  junior: {
    name: 'CHIEF OF NAVAL OPERATIONS', from: 'Chief of Naval Operations',
    code: 'N00', zip: '20350', ssic: '1000', serial: '0002', date: '15 Jan 26',
    signature: { name: 'Mary K. Jones', rank: 'Admiral', title: 'Chief of Naval Operations' },
  },
  commonLocation: 'Washington, D.C.',
};

describe.skipIf(!hasPdfToolchain)('previously hollow doc types carry their content', () => {
  describeToolchainRequirement('companion-doc-type-content');

  it('joint_letter names both commands, both signatories, and From/To/Subj', async () => {
    const text = await textOf({ docType: 'joint_letter', to: 'Secretary of the Navy', subject: 'JOINT POLICY', paragraphs: [{ text: 'Body.' }], parties });
    for (const s of ['COMMANDANT OF THE MARINE CORPS', 'CHIEF OF NAVAL OPERATIONS', 'WASHINGTON, D.C.',
                     'From: Commandant of the Marine Corps', 'To:   Secretary of the Navy', 'Subj: JOINT POLICY',
                     'PP&O', 'N00', 'Ser 0001', 'Ser 0002']) {
      expect(text, `missing ${JSON.stringify(s)}`).toContain(s);
    }
    // These were the symptom: an empty From/To/Subj and "()" where the commands go.
    expect(text).not.toMatch(/From:\s*\n/);
    expect(text).not.toContain('()');
    // The senior column takes the senior party's block, not the document default.
    // It was passed above and rendered 5216 for a while without anyone asserting.
    expect(text).not.toContain('5216');
  }, 120_000);

  it.each(['moa', 'mou'])('%s names both parties in the BETWEEN block and signs for both', async (docType) => {
    const text = await textOf({ docType, subject: 'AGREEMENT ON JOINT OPERATIONS', paragraphs: [{ text: 'Body.' }], parties });
    expect(text).toContain('COMMANDANT OF THE MARINE CORPS');
    expect(text).toContain('CHIEF OF NAVAL OPERATIONS');
    expect(text).toContain('Subj: AGREEMENT ON JOINT OPERATIONS');
    // Agreements reduce a full name to initial and surname.
    expect(text).toMatch(/D\. SMITH/);
    expect(text).toMatch(/M\. JONES/);
    expect(text).toContain('General');
    expect(text).toContain('Admiral');
    expect(text).not.toContain('[SENIOR COMMAND]');
    expect(text).not.toContain('[JUNIOR COMMAND]');
  }, 120_000);

  it('information_memorandum carries the coordination and prepared-by lines', async () => {
    const text = await textOf({ docType: 'information_memorandum', from: 'Director, Plans', to: 'Commandant', subject: 'Readiness',
      paragraphs: [{ text: 'Body.' }], coordination: 'DC PP&O, DC M&RA', preparedBy: 'CAPT J. Smith, USN' });
    expect(text).toContain('COORDINATION: DC PP&O, DC M&RA');
    expect(text).toContain('Prepared by: CAPT J. Smith, USN');
    expect(text).toContain('FOR:');
    expect(text).toContain('Commandant');
  }, 120_000);

  it('same_page_endorsement takes its header from the endorsement object, not the subject', async () => {
    const text = await textOf({ docType: 'same_page_endorsement', from: 'Sgt A. Marine', to: 'Commanding Officer', subject: 'APPOINTMENT',
      paragraphs: [{ text: 'I accept.' }], endorsement: { ordinal: 'SECOND', basicLetterId: 'CO 6th Comm Bn ltr 5216 of 8 Sep 26' } });
    expect(text).toContain('SECOND ENDORSEMENT on CO 6th Comm Bn ltr 5216 of 8 Sep 26');
  }, 120_000);

  it('business_letter uses the supplied salutation and close, and a spelled date', async () => {
    const text = await textOf({ docType: 'business_letter', to: 'Mr. J. Doe', subject: 'Thank You', paragraphs: [{ text: 'Body.' }],
      salutation: 'Dear Mr. Doe:', complimentaryClose: 'Very respectfully,' });
    expect(text).toContain('Dear Mr. Doe:');
    expect(text).toContain('Very respectfully,');
    // Ch 11: "September 10, 2026", never "10 Sep 26".
    expect(text).toMatch(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
    expect(text).not.toMatch(/\b\d{1,2} [A-Z][a-z]{2} \d{2}\b/);
  }, 120_000);

  it('standard_memorandum defaults to a spelled date when none is given', async () => {
    const text = await textOf({ docType: 'standard_memorandum', from: 'Director', to: 'Commandant', subject: 'Quarterly Report', paragraphs: [{ text: 'Body.' }] });
    expect(text).toMatch(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
    expect(text).toContain('MEMORANDUM FOR Commandant');
  }, 120_000);

  it('naval_letter still defaults to the naval date', async () => {
    // The date default became type-aware; the common case must not have moved.
    const text = await textOf({ docType: 'naval_letter', from: 'CO', to: 'CG', subject: 'CHECK', paragraphs: [{ text: 'Body.' }] });
    expect(text).toMatch(/\b\d{1,2} [A-Z][a-z]{2} \d{2}\b/);
  }, 120_000);
});
