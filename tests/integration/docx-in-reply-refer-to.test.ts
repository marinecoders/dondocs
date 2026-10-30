/**
 * "In reply refer to" prints the same way in Word as in the PDF.
 *
 * SECNAV M-5216.5 ¶7-2.3 and App C ¶3.a: the caption is printed in capitals
 * and the SSIC goes on the next line. The PDF template does exactly that. The
 * Word path printed "In reply refer to:" in mixed case below the date, followed
 * by a reference the user typed, which the PDF never prints.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import mammoth from 'mammoth';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';

const pandocAvailable = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn('[docx-in-reply-refer-to] pandoc not found on PATH — these checks will be SKIPPED.');
}

const store = (inReplyTo: boolean) => ({
  docType: 'naval_letter',
  formData: {
    docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times', pageNumbering: 'none',
    department: 'usmc', unitLine1: '1ST BATTALION, 6TH MARINES',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123', sealType: 'dow',
    letterheadColor: 'blue', ssic: '5216', serial: '271', date: '7 Sep 06',
    inReplyTo, inReplyToText: 'CO ltr 5216 Ser 001 of 1 Jan 25',
    from: 'Commanding Officer', to: 'Commanding General', subject: 'REPLY CAPTION',
    sigFirst: 'John', sigLast: 'DOE', classLevel: 'unclassified',
  },
  references: [], enclosures: [], copyTos: [], distributions: [],
  paragraphs: [{ text: 'Body.', level: 0 }],
}) as never;

async function lines(inReplyTo: boolean): Promise<string[]> {
  const result = await compileDocxFixture(store(inReplyTo));
  expect(result.ok, formatDocxFailure('in reply refer to', result)).toBe(true);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) });
  return value.split('\n').map(l => l.trim()).filter(Boolean);
}

describe.skipIf(!pandocAvailable)('Word export — in reply refer to', () => {
  it('prints the caption in capitals directly above the SSIC, with no typed reference', async () => {
    const text = await lines(true);
    const caption = text.indexOf('IN REPLY REFER TO');
    expect(caption).toBeGreaterThan(-1);
    expect(text[caption + 1]).toBe('5216');
    expect(text.join('\n')).not.toMatch(/In reply refer to:/);
    expect(text.join('\n')).not.toContain('CO ltr 5216 Ser 001 of 1 Jan 25');
  }, 120_000);

  it('prints nothing when the caption is off', async () => {
    expect((await lines(false)).join('\n')).not.toMatch(/reply refer to/i);
  }, 120_000);
});
