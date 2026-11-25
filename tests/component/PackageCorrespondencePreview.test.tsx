import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PackageCorrespondenceEditor from '@/components/PackageCorrespondenceEditor';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { createActionPackage, reviseActionPackage } from '@/lib/actionPackages';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';

vi.mock('@/components/pdf/PdfViewer', () => ({ default: () => <div>Rendered PDF</div> }));
afterEach(cleanup);

it('labels the previous PDF while updating and hides it when the replacement fails', async () => {
  const documentId = 'preview-test';
  const member = await capturePackageMember(captureDocumentRevision({ documentId, epoch: 0, editSequence: 0, capturedAt: 1 },
    { ...createBlankSession(), endItems: [], publicationTables: {} }), 'Test letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage('Preview test'), [member]);
  const props = { record, member, documentId, setEditorHost: vi.fn(), navigationError: '', onSave: vi.fn(), onNavigate: vi.fn(), disabled: false };
  const preview = { documentId, url: 'blob:previous-output', busy: true };
  const editor = render(<PackageCorrespondenceEditor {...props} preview={preview} />);
  expect(await screen.findByText('Rendered PDF')).toBeTruthy();
  expect(screen.getByText('Updating preview…')).toBeTruthy();
  editor.rerender(<PackageCorrespondenceEditor {...props} preview={{ ...preview, busy: false, error: 'Preview failed' }} />);
  expect(screen.getByText('Preview failed')).toBeTruthy();
  expect(screen.queryByText('Rendered PDF')).toBeNull();
});
