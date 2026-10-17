import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderForm } from '@/services/forms/render';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';

function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'form-text-'));
  try {
    const path = join(dir, 'form.pdf');
    writeFileSync(path, bytes);
    const output = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
    expect(output.status).toBe(0);
    return output.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it('exports multiline answers with line breaks and pasted tabs without losing text', async () => {
  const instance = fixtureInstance();
  instance.definition.fields.name.multiline = true;
  for (const placement of instance.definition.placements.filter(p => p.fieldId === 'name')) placement.box.height = 28;
  instance.answers.name = 'First paragraph\r\n\tSecond paragraph';
  const page = await fixturePage();
  const result = await renderForm(instance, 'export', async () => page.bytes);
  expect(result.diagnostics).toEqual([]);
  const text = pdfText(result.bytes);
  expect(text.match(/First paragraph/g)).toHaveLength(2);
  expect(text.match(/Second paragraph/g)).toHaveLength(2);
  expect(instance.answers.name).toBe('First paragraph\r\n\tSecond paragraph');
});

it.each(['mdy', 'dmy'] as const)('leaves cleared %s dates blank in the exported PDF', async dateFormat => {
  const instance = fixtureInstance();
  for (const row of instance.definition.rowGroups.roster.rows) row[1].dateFormat = dateFormat;
  instance.rows.roster = [{ id: 'row', answers: { grade: 'e1', date: '' } }];
  const page = await fixturePage();
  const result = await renderForm(instance, 'export', async () => page.bytes);
  expect(result.diagnostics).toEqual([]);
  expect(pdfText(result.bytes)).not.toContain('undefined');
});

it('never shrinks below the minimum font size to make an export pass', async () => {
  const instance = fixtureInstance();
  instance.answers.name = 'WWWW';
  for (const placement of instance.definition.placements.filter(p => p.fieldId === 'name')) {
    placement.box.height = 5.7;
    placement.box.width = 24.5;
  }
  const page = await fixturePage();
  await expect(renderForm(instance, 'export', async () => page.bytes)).rejects.toThrow(/exceeds/);
});

it('prints repeated answers and only the selected mark in independently specified regions', async () => {
  const instance = fixtureInstance();
  instance.answers.decision = 'no';
  instance.rows.roster = [{ id: 'one', answers: { grade: 'e2', date: '2026-01-02' } }];
  const page = await fixturePage();
  const result = await renderForm(instance, 'export', async () => page.bytes);
  expect(result.diagnostics).toEqual([]);
  const temp = mkdtempSync(join(tmpdir(), 'form-render-'));
  try {
    const path = join(temp, 'form.pdf'); writeFileSync(path, result.bytes);
    const output = spawnSync('pdftotext', ['-bbox', path, '-'], { encoding: 'utf8' });
    expect(output.status).toBe(0);
    expect(output.stdout.match(/>000123<\/word>/g)).toHaveLength(2);
    const marks = [...output.stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>X<\/word>/g)];
    expect(marks).toHaveLength(1);
    expect(+marks[0][1]).toBeGreaterThan(80);
    expect(+marks[0][1]).toBeLessThan(92);
    expect(+marks[0][2]).toBeGreaterThan(112);
    expect(+marks[0][2]).toBeLessThan(124);
    expect(output.stdout).toContain('>E-2</word>');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
it('retains overflowing answers for preview and refuses a truncated export', async () => {
  const instance = fixtureInstance(); instance.answers.name = 'TOO LONG '.repeat(100);
  const original = instance.answers.name;
  const page = await fixturePage(); const loader = async () => page.bytes;
  const result = await renderForm(instance, 'preview', loader);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name', code: 'overflow' })]));
  await expect(renderForm(instance, 'export', loader)).rejects.toThrow(/exceeds/);
  expect(instance.answers.name).toBe(original);
  instance.answers.name = '漢字';
  await expect(renderForm(instance, 'export', loader)).rejects.toThrow(/characters/);
});
