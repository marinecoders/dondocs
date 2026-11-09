import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { captureFormExportTemplates } from '@/lib/formExportTemplates';
import { prepareExport, acknowledgePreparedExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { renderPreparedConfiguredForm } from '@/services/exports/configuredForms';

it('prints the captured configured form answers and repeated rows after live values change', async () => {
  const instance = fixtureInstance();const page = await fixturePage();instance.definition.pages[0].sha256 = page.sha256;
  instance.answers.name = 'ORIGINAL ANSWER';instance.rows.roster = [{ id: 'row', answers: { grade: 'e2', date: '2026-01-02' } }];
  const formTemplates = captureFormExportTemplates('configured-form', 'fixture', { 'page1.pdf': page.bytes }, JSON.stringify(instance.definition));
  const captured = captureDocumentRevision({ documentId: 'configured', epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentCategory: 'forms', documentMode: 'compliant', docType: 'standard_letter', formType: 'fixture', genericForm: instance,
    formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  const result = prepareExport({ id: 'configured', captured, target: 'pdf', filename: 'original.pdf', formTemplates,
    policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }),
  });
  if ('issues' in result) throw new Error(result.issues.join('\n'));
  const ready = result.status === 'ready' ? result.job : acknowledgePreparedExport(result.job);
  instance.answers.name = 'DIFFERENT';instance.rows.roster[0].answers.grade = 'e1';page.bytes.fill(0);
  const artifact = await renderPreparedConfiguredForm(ready, new AbortController().signal);
  const directory = mkdtempSync(join(tmpdir(), 'prepared-form-'));
  try {
    const path = join(directory, 'form.pdf');writeFileSync(path, new Uint8Array(await artifact.blob.arrayBuffer()));
    const text = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
    expect(text.status).toBe(0);expect(text.stdout.match(/ORIGINAL ANSWER/g)).toHaveLength(2);
    expect(text.stdout).toContain('E-2');expect(text.stdout).toContain('2026-01-02');expect(text.stdout).not.toContain('DIFFERENT');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
