import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { jointLetterFixture } from '../_helpers/jointLetterFixture';
import { generateFlatLatex } from '@/services/latex/flat-generator';

describeToolchainRequirement('three-command joint letter');
describe.skipIf(!hasPdfToolchain)('three-command joint letter output', () => {
  it.each([false, true])('renders every command and correct signing order, third=%s', async additional => {
    const fixture = jointLetterFixture(additional);
    const result = await compileFixture(fixture);
    expect(result.ok, formatFailure('joint_letter', result)).toBe(true);
    const { boxes, collisions } = await pdfTextLayout(result.pdfBytes!);
    const text = boxes.map(box => box.text).join(' ');
    for (const value of ['SENIOR COMMAND', 'JUNIOR COMMAND', 'A. SENIOR', 'B. JUNIOR', 'Coordinate the shared action']) expect(text).toContain(value);
    const junior = boxes.find(box => box.text.includes('B. JUNIOR'))!;
    const senior = boxes.find(box => box.text.includes('A. SENIOR'))!;
    expect(junior.left).toBeLessThan(senior.left);
    if (additional) {
      for (const value of ['MIDDLE COMMAND', 'C. MIDDLE', '301', 'Deputy Commander', 'Acting']) expect(text).toContain(value);
      const middle = boxes.find(box => box.text.includes('C. MIDDLE'))!;
      expect(middle.left).toBeGreaterThan(junior.left);
      expect(middle.right).toBeLessThan(senior.left);
      expect(Math.abs(middle.top - senior.top)).toBeLessThan(1);
    } else expect(text).not.toContain('MIDDLE');
    expect(collisions).toEqual([]);
    const texPath = join(result.workDir, 'word.tex'), docxPath = join(result.workDir, 'joint.docx');
    writeFileSync(texPath, generateFlatLatex(fixture));
    execFileSync('pandoc', ['--from=latex', '--to=docx', texPath, '-o', docxPath]);
    const xml = execFileSync('unzip', ['-p', docxPath, 'word/document.xml'], { encoding: 'utf8' });
    expect(xml).toContain('B. JUNIOR'); expect(xml).toContain('A. SENIOR');
    expect(xml.includes('C. MIDDLE')).toBe(additional);
    if (additional) {
      expect(xml).toContain('Deputy Commander');
      expect(xml.indexOf('B. JUNIOR')).toBeLessThan(xml.indexOf('C. MIDDLE'));
      expect(xml.indexOf('C. MIDDLE')).toBeLessThan(xml.indexOf('A. SENIOR'));
    }
    expect(readFileSync(docxPath).subarray(0, 2).toString()).toBe('PK');
    console.info(`Qualified ${additional ? 3 : 2}-command fixtures: ${result.workDir}`);
  });
  it('wraps long identifiers and signatory names without crossing adjacent columns', async () => {
    const source = jointLetterFixture();
    Object.assign(source.formData.jointAdditionalCommands![0], {
      code: 'M'.repeat(40), signatureName: 'C. ' + 'M'.repeat(70),
      signatureTitle: 'Deputy Commander, Shared Support Operations and Sustainment Coordination Division',
    });
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('long three-command fields', result)).toBe(true);
    const { boxes, collisions } = await pdfTextLayout(result.pdfBytes!);
    expect(collisions).toEqual([]);
    expect(boxes.every(box => box.left >= 71 && box.right <= 541)).toBe(true);
  });

});
