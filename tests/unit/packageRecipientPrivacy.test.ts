import 'fake-indexeddb/auto';
import { beforeAll, expect, it, vi } from 'vitest';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, reviseActionPackage } from '@/lib/actionPackages';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { extractPdfText } from '@/lib/pdfText';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('react-pdf', async () => ({ pdfjs: await import('pdfjs-dist/legacy/build/pdf.mjs') }));
vi.mock('@/components/pdf/pdfConfig', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  return { HARDENED_PDF_OPTIONS: { isEvalSupported: false, useSystemFonts: true } };
});
const unclassified = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => unclassified, getExportDeploymentPolicySync: () => unclassified }));
beforeAll(() => { Object.assign(globalThis, { DOMMatrix, ImageData, Path2D }); });
it('renders recipient form scope without its inactive correspondence, discussion or earlier package content', async () => {
  const { fixtureInstance, fixturePage } = await import('../_helpers/formFixture');
  const { preparePackageDelivery, copyPreparedPackageDeliveryProjection, readPreparedPackageDeliveryAsset, buildPackageDeliveryFile } = await import('@/lib/packageDelivery');
  const template = await fixturePage(), instance = fixtureInstance(); instance.definition.pages[0].sha256 = template.sha256; instance.answers.name = 'PUBLIC ACTIVE NAME';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(template.bytes))));
  try {
    const base = createBlankSession();
    const session = { ...base, documentCategory: 'forms' as const, formType: 'fixture', genericForm: instance, endItems: [], publicationTables: {},
      formData: { ...base.formData, subject: 'SECRET\nPRIVATE INACTIVE CORRESPONDENCE\nSECRET' },
      paragraphs: [{ id: 'inactive', text: 'SECRET\nPRIVATE INACTIVE BODY\nSECRET', level: 0 }],
      reviewComments: { version: 1 as const, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' as const }, resolved: false, messages: [{ id: crypto.randomUUID(), author: 'PRIVATE REVIEWER', text: 'PRIVATE DISCUSSION', createdAt: '2026-11-17T00:00:00Z' }] }] } };
    const member = await capturePackageMember(captureDocumentRevision({ documentId: 'PRIVATE_SOURCE_IDENTITY', epoch: 0, editSequence: 0, capturedAt: 1 }, session), 'Public form', 'basic-letter');
    const record = await reviseActionPackage(await createActionPackage(`PRIVATE PACKAGE ${crypto.randomUUID()}`), [member]);
    const prepared = await preparePackageDelivery(record, record.currentRevisionId, { purpose: 'recipient', label: 'Public delivery', memberIds: [member.id] }, unclassified, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true });
    const projection = copyPreparedPackageDeliveryProjection(prepared), selected = getPackageRevision(projection).members[0];
    if (selected.kind !== 'original') throw new Error('Expected rendered recipient PDF');
    const text = await extractPdfText(await readPreparedPackageDeliveryAsset(prepared, selected.original));
    expect(text).toContain('PUBLIC ACTIVE NAME'); expect(text).not.toMatch(/SECRET|PRIVATE/);
    const json = await buildPackageDeliveryFile(prepared, unclassified, true);
    expect(json).not.toMatch(/PRIVATE|reviewComments|genericForm|workingCopies|reviewRounds/);
    expect(JSON.stringify(projection)).not.toContain('session');
  } finally { vi.unstubAllGlobals(); }
});
