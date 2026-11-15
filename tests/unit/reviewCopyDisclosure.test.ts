import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { buildReviewCopy, downloadReviewCopy, prepareReviewCopyExport, startReviewRound } from '@/lib/reviewRoundActions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { docxImageFixture } from '../_helpers/docxImageFixture';
import { persistAttachment } from '@/lib/attachments';
import { PDFDocument } from 'pdf-lib';
import { fixtureInstance } from '../_helpers/formFixture';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'SYNTHETIC FRESH REVIEW');
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(['signature', 'figure', 'enclosure', 'basic-letter'] as const)('reviews the %s filename actually retained in a reviewer copy', async kind => {
  const { signature } = await docxImageFixture();
  const name = `Synthetic SSN 123-45-6789.${kind === 'signature' || kind === 'figure' ? 'png' : 'pdf'}`;
  if (kind === 'signature') {
    useDocumentStore.getState().setFormData({ signatureType: 'image', signatureImage: {
      name, size: signature.length, data: signature.toString('base64'),
    } });
  } else {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const data = kind === 'figure' ? new Uint8Array(signature).buffer : new Uint8Array(await pdf.save()).buffer;
    const type = kind === 'figure' ? 'image/png' : 'application/pdf';
    const fileRef = await persistAttachment({ name, size: data.byteLength, type }, data);
    if (kind === 'figure') useDocumentStore.setState({ paragraphs: [{ id: 'synthetic-figure', level: 0, text: 'Synthetic figure', figure: { name, type, fileRef } }] });
    if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Synthetic enclosure', fileRef }] });
    if (kind === 'basic-letter') useDocumentStore.getState().setFormData({ basicLetterFileRef: fileRef });
  }
  const round = await startReviewRound('Retained filename privacy');
  const copy = await buildReviewCopy(round);
  expect(JSON.stringify(copy)).toContain(name);
  const review = prepareReviewCopyExport(copy, policy);
  expect(review.review.privacy.findings.some(finding => finding.type === 'SSN' && finding.value === '123-45-6789')).toBe(true);
});

it('does not emit dormant built-in answers or accept a configured form inside a native review baseline', async () => {
  const round = await startReviewRound('Native baseline only');
  round.baseline.session.forms = createBlankSession('navmc_10274').forms!;
  round.baseline.session.forms.navmc10274!.to = 'DORMANT SSN 234-56-7890';
  const copy = await buildReviewCopy(round);
  expect(JSON.stringify(copy)).not.toContain('DORMANT SSN 234-56-7890');
  expect(JSON.stringify(copy)).not.toContain('navmc10274');
  round.baseline.session.genericForm = fixtureInstance();
  await expect(buildReviewCopy(round)).rejects.toThrow(/baseline is invalid/);
});

it('enforces retained filename markings again when a prepared copy is delivered under a lower policy', async () => {
  const { signature } = await docxImageFixture();
  useDocumentStore.getState().setFormData({ signatureType: 'image', signatureImage: {
    name: '(S) Synthetic signature.png', size: signature.length, data: signature.toString('base64'),
  } });
  const round = await startReviewRound('Filename marking policy');
  const copy = await buildReviewCopy(round);
  expect(() => prepareReviewCopyExport(copy, policy)).toThrow(/configured levels/);
  const allowed = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: {
    maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'],
  }, runtime: { status: 'absent' } });
  const prepared = prepareReviewCopyExport(copy, allowed);
  expect(prepared.review.marking).toBe('SECRET');
  expect(() => downloadReviewCopy(prepared, policy)).toThrow(/configured levels/);
});

it('does not treat a valid retained paragraph identity as a classification banner', async () => {
  useDocumentStore.setState({ paragraphs: [{ id: 'SECRET', text: 'Ordinary unmarked synthetic training text.', level: 0 }] });
  const round = await startReviewRound('Ordinary identity control');
  const copy = await buildReviewCopy(round);
  expect((copy.draft as { paragraphs: Array<{ id: string }> }).paragraphs[0].id).toBe('SECRET');
  const prepared = prepareReviewCopyExport(copy, policy);
  expect(prepared.review.marking).toBe('UNCLASSIFIED');
  expect(prepared.review.privacy.found).toBe(false);
});

it('keeps an ordinary copy free of invented privacy findings', async () => {
  const round = await startReviewRound('Clean copy control');
  const prepared = prepareReviewCopyExport(await buildReviewCopy(round), policy);
  expect(prepared.review.marking).toBe('UNCLASSIFIED');
  expect(prepared.review.privacy.found).toBe(false);
});
