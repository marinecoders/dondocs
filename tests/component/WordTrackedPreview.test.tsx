import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph, wordRun } from '../_helpers/wordImportFixture';
import { ImportLetterModal } from '@/components/modals/ImportLetterModal';
import { useUIStore } from '@/stores/uiStore';
import { getSerializedSession } from '@/stores/documentStore';
import { idbGetAllAttachments, idbGetAllDocuments } from '@/lib/documentsDb';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
installWordXmlDom();
beforeEach(() => useUIStore.setState({ importLetterModalOpen: true }));

it('shows a detected but unmapped Word field edit as original-only before confirmation', async () => {
  const source = await wordImportFixture(`<w:p>${wordRun('From: Training ')}<w:del w:id="1">${wordRun('Chief').replaceAll('w:t', 'w:delText')}</w:del><w:ins w:id="2">${wordRun('Office')}</w:ins></w:p>${wordParagraph('Subj: FIELD REVIEW')}${wordParagraph('1. Keep this body unchanged.')}`);
  const before = getSerializedSession(), documents = await idbGetAllDocuments(), attachments = await idbGetAllAttachments();
  render(<ImportLetterModal />);
  fireEvent.change(screen.getByLabelText('Choose a PDF or Word file'), { target: { files: [new File([source.buffer as ArrayBuffer], 'tracked-field.docx')] } });
  expect(await screen.findByText('Readable tracked paragraphs')).toBeVisible();
  expect(screen.getByText('Readable tracked paragraphs').parentElement).toHaveTextContent('1');
  expect(screen.getByText('Native text proposals').parentElement).toHaveTextContent('0');
  expect(screen.getByLabelText('Word import notices')).toHaveTextContent('mapped letter fields');
  expect(screen.getByLabelText('Word import notices')).toHaveTextContent('were not converted to native proposals');
  expect(screen.getByRole('button', { name: 'Import into editor' })).toBeEnabled();
  expect(getSerializedSession()).toMatchObject({ formData: before.formData, paragraphs: before.paragraphs });
  expect(await idbGetAllDocuments()).toEqual(documents); expect(await idbGetAllAttachments()).toEqual(attachments);
});
