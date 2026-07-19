/**
 * Component tests for <ImportLetterModal>.
 *
 * These lock in that a *failed* import surfaces the error phase (not a silent
 * failure or a crash): a thrown read error, and a file with no recognizable
 * text, both land on the themed error message with a way to pick another file.
 * The heavy readers (pandoc/pdf.js) are mocked out — this is about the modal's
 * failure wiring, not extraction.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the import pipeline so no PDF/DOCX engine loads; isDocxFile stays real
// so the message branches by extension.
vi.mock('@/lib/importLetter', () => ({
  parseLetterFile: vi.fn(),
  hasParsedContent: vi.fn(),
  applyParsedLetter: vi.fn(),
  isDocxFile: (f: File) =>
    /\.docx$/i.test(f.name) ||
    f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}));

import { ImportLetterModal } from '@/components/modals/ImportLetterModal';
import { useUIStore } from '@/stores/uiStore';
import { parseLetterFile, hasParsedContent } from '@/lib/importLetter';

const mockParse = vi.mocked(parseLetterFile);
const mockHasContent = vi.mocked(hasParsedContent);

// The dialog (and its file input) render through a Radix portal on document.body,
// not inside the render container.
function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ importLetterModalOpen: true });
});

describe('ImportLetterModal — failed imports reach the error phase', () => {
  it('shows a PDF-specific error when the read throws', async () => {
    mockParse.mockRejectedValue(new Error('bad pdf'));
    render(<ImportLetterModal />);
    selectFile(new File(['x'], 'letter.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(/This PDF could not be read/i)).toBeTruthy();
    // And offers a way to recover.
    expect(screen.getByRole('button', { name: /choose a different file/i })).toBeTruthy();
  });

  it('shows a Word-specific error (engine hint) when a DOCX read throws', async () => {
    mockParse.mockRejectedValue(new Error('pandoc failed'));
    render(<ImportLetterModal />);
    selectFile(new File(['x'], 'letter.docx'));

    expect(await screen.findByText(/Word document could not be read/i)).toBeTruthy();
    expect(await screen.findByText(/document engine could not start/i)).toBeTruthy();
  });

  it('shows a "no text" error when nothing parseable was found', async () => {
    mockParse.mockResolvedValue({
      parsed: { references: [], enclosures: [], copyTos: [], paragraphs: [] },
      detection: { docType: 'naval_letter', confidence: 'low', reason: '' },
      classification: { classLevel: 'unclassified', found: false, reason: '' },
    });
    mockHasContent.mockReturnValue(false);
    render(<ImportLetterModal />);
    selectFile(new File(['x'], 'blank.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(/Couldn't find letter text in this PDF/i)).toBeTruthy();
  });

  it('recovers to the file picker after an error', async () => {
    mockParse.mockRejectedValue(new Error('bad'));
    render(<ImportLetterModal />);
    selectFile(new File(['x'], 'letter.pdf', { type: 'application/pdf' }));

    const back = await screen.findByRole('button', { name: /choose a different file/i });
    fireEvent.click(back);
    // Back to idle: the drop target prompt is shown again.
    expect(await screen.findByText(/Choose a PDF or Word file to import/i)).toBeTruthy();
  });
});
