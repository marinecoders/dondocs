// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { WordSourceNotice } from '@/components/editor/WordSourceNotice';
import { parseLetterFile } from '@/lib/importLetter';
import { openWordImport } from '@/lib/importWord';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { suspendSessionSaves } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { triggerDownload } from '@/lib/encoding';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
vi.mock('@/lib/encoding', async original => ({ ...await original<typeof import('@/lib/encoding')>(), triggerDownload: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
installWordXmlDom();

beforeEach(async () => {
  vi.clearAllMocks();suspendSessionSaves();
  await flushDocumentWrites();
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }));
});
afterEach(async () => { await flushDocumentWrites(); });

async function imported(name: string) {
  const bytes = await wordImportFixture(wordParagraph('Public synthetic body without restricted XML text.'));
  const parsed = await parseLetterFile(new File([bytes.buffer as ArrayBuffer], name));
  expect(parsed.word!.source.retainedText).not.toContain('(S)');
  expect(await openWordImport(parsed, 'naval_letter')).toBe('applied');
  render(<WordSourceNotice />);
  return bytes;
}

it('blocks direct original delivery when its retained filename supplies a higher handling marking', async () => {
  await imported('(S) original.docx');
  const button = screen.getByRole('button', { name: 'Download original Word file' });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  await waitFor(() => expect(button).toBeEnabled());
  expect(triggerDownload).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('outside this deployment');
});

it('still delivers the exact benign original after actual reader and IndexedDB checks', async () => {
  const bytes = await imported('original.docx');
  fireEvent.click(screen.getByRole('button', { name: 'Download original Word file' }));
  await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
  const [blob, name] = vi.mocked(triggerDownload).mock.calls[0];
  expect(name).toBe('original.docx');
  if (!(blob instanceof Blob)) throw new Error('Expected the actual original Word Blob.');
  const delivered = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();reader.onload = () => resolve(reader.result as ArrayBuffer);reader.onerror = () => reject(reader.error);reader.readAsArrayBuffer(blob);
  });
  expect(new Uint8Array(delivered)).toEqual(bytes);
  expect(screen.queryByRole('alert')).toBeNull();
});
