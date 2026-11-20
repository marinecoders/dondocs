import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, readPackageAsset } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { assemblePackage, preparePackageAssembly } from '@/lib/actionPackageAssembly';
import { updatePackageAssemblySettings } from '@/lib/packageAssemblySettings';
import { defaultPackageAssemblySettings } from '@/lib/packageAssemblyModel';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { volumeFixture } from '../_helpers/volumeFixture';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));

beforeEach(() => vi.stubGlobal('__RUNTIME_BASE__', ''));
afterEach(() => vi.unstubAllGlobals());

it.skipIf(!hasPdfToolchain).each([[false, false], [true, false], [true, true]])('retains working links with duplicate volume identities, package front matter=%s and dense body=%s', async (frontMatter, dense) => {
  const session = { ...createBlankSession(), ...volumeFixture(dense), documentCategory: 'correspondence' as const, formType: 'navmc_10274' };
  const captured = captureDocumentRevision({ documentId: 'volume-source', epoch: 1, editSequence: 0, capturedAt: 42 }, session);
  const first = await capturePackageMember(captured, 'First volume', 'basic-letter');
  const second = await capturePackageMember(captured, 'Second volume', 'supporting-document');
  let record = await reviseActionPackage(await createActionPackage('Synthetic linked volumes'), [first, second]);
  if (frontMatter) record = await updatePackageAssemblySettings(record, { ...defaultPackageAssemblySettings(), cover: true, contents: true }, policy);
  const ready = await preparePackageAssembly(record, record.currentRevisionId, policy);
  expect(ready.readiness.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  const assembled = await assemblePackage(ready, {
    compile: async files => {
      const text = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      const binary = Object.fromEntries(Object.entries(files).filter((entry): entry is [string, Uint8Array] => entry[1] instanceof Uint8Array));
      const result = await compileGeneratedFixture(text, binary);
      expect(result.ok, result.logTail).toBe(true);
      return resolvePublicationDestinations(result.pdfBytes!);
    },
    convertDocx: vi.fn(), waitForReady: async () => true,
  });
  const output = getPackageRevision(assembled).outputs.at(-1)!;
  const task = getDocument({ data: new Uint8Array(await readPackageAsset(output.asset)), useSystemFonts: false });
  try {
    const reader = await task.promise;
    for (const boundary of output.boundaries) {
      let links = 0;
      for (let page = boundary.startPage; page < boundary.startPage + boundary.pageCount; page++) {
        for (const annotation of await (await reader.getPage(page)).getAnnotations()) {
          if (!annotation.dest) continue;
          const destination = typeof annotation.dest === 'string' ? await reader.getDestination(annotation.dest) : annotation.dest;
          expect(destination, `Missing link target in ${boundary.memberId}`).toBeTruthy();
          const target = await reader.getPageIndex(destination[0]);
          expect(target).toBeGreaterThanOrEqual(boundary.startPage - 1);
          expect(target).toBeLessThan(boundary.startPage - 1 + boundary.pageCount);
          links++;
        }
      }
      expect(links).toBeGreaterThanOrEqual(7);
    }
  } finally { await task.destroy(); }
}, 60_000);
