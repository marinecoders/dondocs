import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { WordReviewControls } from '@/components/WordReviewControls';
import { createExportGate } from '@/lib/exportController';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { readReviewRound } from '@/lib/reviewRounds';
import { useDocumentStore } from '@/stores/documentStore';
import { commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { openBrowserExportDelivery } from '@/utils/exportDelivery';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
vi.mock('@/utils/exportDelivery', () => ({ openBrowserExportDelivery: vi.fn() }));
installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
beforeEach(() => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }));
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'SYNTHETIC WORD REVIEW');
});
afterEach(async () => { await flushDocumentWrites();vi.clearAllMocks(); });
async function fixture(text: string) {
  useDocumentStore.getState().updateParagraph(0, { text });await commitCurrentDocument();
  const round = await startReviewRound('Owned baseline'), bytes = await wordImportFixture(wordParagraph(`1. ${text}`));
  const gate = createExportGate(), deliver = vi.fn(async () => true), release = vi.fn(), busy = vi.fn(), saved = vi.fn();
  vi.mocked(openBrowserExportDelivery).mockReturnValue({ deliver, release });
  const renderer = { compile: vi.fn(), convertDocx: vi.fn(async () => new Blob([new Uint8Array(bytes)])) };
  return { round, gate, renderer, deliver, busy, saved, bytes };
}
it('requires a privacy approval and works after the React strict-mode lifecycle check', async () => {
  const app = await fixture('Fictional SSN 123-45-6789');
  render(<StrictMode><WordReviewControls gate={app.gate} renderer={app.renderer} rounds={[app.round]} disabled={false} onSaved={app.saved} onBusyChange={app.busy} /></StrictMode>);
  fireEvent.click(screen.getByRole('button', { name: 'Download Word review copy' }));
  expect(await screen.findByLabelText('Approve Word review export')).toHaveTextContent('123-45-6789');
  expect(app.deliver).not.toHaveBeenCalled();expect(app.renderer.convertDocx).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve privacy for Word review' }));
  expect(await screen.findByText(/Word review copy sent to browser downloads/)).toBeVisible();
  expect(app.deliver).toHaveBeenCalledOnce();expect(app.saved).toHaveBeenCalledOnce();expect(app.busy).toHaveBeenLastCalledWith(false);
});
it('cancels a held worker and releases the gate only after its result settles', async () => {
  const app = await fixture('Synthetic review body');let finish!: () => void;
  app.renderer.convertDocx.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; });return new Blob([new Uint8Array(app.bytes)]); });
  render(<WordReviewControls gate={app.gate} renderer={app.renderer} rounds={[app.round]} disabled={false} onSaved={app.saved} onBusyChange={app.busy} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download Word review copy' }));await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Word review export' }));expect(app.gate.acquire()).toBeNull();
  await act(async () => { finish(); });await waitFor(() => expect(screen.getByRole('button', { name: 'Download Word review copy' })).toBeEnabled());
  expect(app.deliver).not.toHaveBeenCalled();expect((await readReviewRound(app.round.id))?.wordHandoffs).toBeUndefined();
  const release = app.gate.acquire();expect(release).not.toBeNull();release?.();
});
