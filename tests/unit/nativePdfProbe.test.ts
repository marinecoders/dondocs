import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { PDFDocument } from 'pdf-lib';

test('a tested text field cannot qualify an untested editable dropdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'form-probe-'));
  try {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    form.createTextField('Name').addToPage(page);
    const choice = form.createDropdown('Unit');
    choice.addOptions(['Only option']);
    choice.select('Only option');
    choice.addToPage(page);
    const path = join(dir, 'sample.pdf');
    writeFileSync(path, await doc.save());
    const report = JSON.parse(execFileSync(process.execPath, ['scripts/probe-native-pdf-forms.mjs', path], { encoding: 'utf8' }));
    assert.equal(report.results[0].status, 'partial');
    assert.deepEqual(report.results[0].untestedTypes, ['dropdown']);
    assert.equal(report.results[0].checks[0].valueRetained, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
