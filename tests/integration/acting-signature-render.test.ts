import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import mammoth from 'mammoth';
import { buildBaseline, type DocType } from '../_helpers/compileMatrix';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

describeToolchainRequirement('Acting signatures');
const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;

const fixtures: { type: DocType; title?: string; junior?: boolean; senior?: boolean; none?: boolean }[] = [
  { type: 'naval_letter' }, { type: 'standard_letter', title: 'Deputy' },
  { type: 'multiple_address_letter' }, { type: 'business_letter' },
  { type: 'same_page_endorsement', title: 'Deputy' }, { type: 'new_page_endorsement' },
  { type: 'plain_paper_memorandum', title: 'Deputy' }, { type: 'letterhead_memorandum', title: 'Deputy' },
  { type: 'decision_memorandum', title: 'Deputy' }, { type: 'mfr' }, { type: 'mf' },
  { type: 'joint_letter', junior: true }, { type: 'joint_memorandum', senior: true },
  { type: 'moa', junior: true }, { type: 'mou', senior: true },
  { type: 'executive_memorandum' }, { type: 'executive_correspondence' },
  { type: 'standard_memorandum' }, { type: 'action_memorandum' },
  { type: 'information_memorandum', none: true },
];

describe.skipIf(!hasPdfToolchain || !hasPandoc)('Acting signatures reach PDF and DOCX', () => {
  it.each(fixtures)('$type', async ({ type, title, junior, senior, none }) => {
    const input = buildBaseline(type);
    Object.assign(input.formData, {
      acting: true, byDirection: true, byDirectionAuthority: 'the Commanding General',
      actingTitle: title || '', juniorActing: junior, seniorActing: senior,
    });
    if (type === 'joint_memorandum') {
      Object.assign(input.formData, {
        jointMemoSeniorSigName: 'P. NEWMAN', jointMemoSeniorSigTitle: 'Deputy',
        jointMemoJuniorSigName: 'R. LOPEZ', jointMemoJuniorSigTitle: 'Chief of Staff',
      });
    }
    const pdf = await compileFixture(input);
    expect(pdf.ok, formatFailure(type, pdf)).toBe(true);
    const extracted = spawnSync('pdftotext', ['-layout', join(pdf.workDir, 'main.pdf'), '-'], { encoding: 'utf-8' });
    expect(extracted.status).toBe(0);
    const docx = await compileDocxFixture(input);
    expect(docx.ok, docx.log.slice(-1500)).toBe(true);
    const word = await mammoth.extractRawText({ buffer: Buffer.from(docx.docxBytes!) });
    for (const text of [extracted.stdout, word.value]) {
      expect(text.match(/\bActing\b/g)?.length || 0).toBe(none ? 0 : 1);
      expect(text).not.toContain('By direction');
      if (title) expect(text).toMatch(new RegExp(`${title}\\s+Acting`));
      if (type === 'joint_memorandum') {
        expect(text).toContain('P. NEWMAN');
        expect(text).toContain('R. LOPEZ');
        expect(text).not.toContain('SMITH');
        expect(text).not.toContain('JONES');
      }
    }
    if (type === 'naval_letter') {
      const name = extracted.stdout.indexOf('J. A. DOE');
      expect(name).toBeGreaterThan(-1);
      expect(extracted.stdout.slice(name)).toMatch(/^J\. A\. DOE\s+Acting/);
    }
    if (junior || senior) {
      // pdftotext -layout preserves columns: Acting must align with the chosen party.
      const lines = extracted.stdout.split('\n');
      const actingLine = lines.find((line) => /\bActing\b/.test(line))!;
      // A senior block is on the right; the junior is on the left.
      if (senior) expect(actingLine.indexOf('Acting')).toBeGreaterThan(30);
      else expect(actingLine.indexOf('Acting')).toBeLessThan(30);
    }
  }, 180_000);
});
