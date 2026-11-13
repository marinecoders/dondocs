/**
 * Component tests for <ImportLetterModal>.
 *
 * Covers file failures, keyboard access, and the pasted-text review flow.
 * Parsing is mocked here; the shared text pipeline has its own tests.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, render, screen, fireEvent } from '@testing-library/react';

// Mock the import pipeline so no PDF/DOCX engine loads; isDocxFile stays real
// so the message branches by extension.
vi.mock('@/lib/importLetter', () => ({
  parseLetterFile: vi.fn(),
  parseLetterText: vi.fn(),
  hasParsedContent: vi.fn(),
  applyParsedLetter: vi.fn(),
  isDocxFile: (f: File) =>
    /\.docx$/i.test(f.name) ||
    f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  isLegacyDocFile: (f: File) => /\.doc$/i.test(f.name) || f.type === 'application/msword',
}));

import { ImportLetterModal } from '@/components/modals/ImportLetterModal';
import { useUIStore } from '@/stores/uiStore';
import { parseLetterFile, parseLetterText, hasParsedContent, applyParsedLetter, type ParsedImport } from '@/lib/importLetter';

const mockParse = vi.mocked(parseLetterFile);
const mockParseText = vi.mocked(parseLetterText);
const mockHasContent = vi.mocked(hasParsedContent);
const mockApply = vi.mocked(applyParsedLetter);

// The dialog (and its file input) render through a Radix portal on document.body,
// not inside the render container.
function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.resetAllMocks();
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

  it('rejects a legacy .doc up front with a re-save hint (no parse attempted)', async () => {
    render(<ImportLetterModal />);
    selectFile(new File(['x'], 'memo.doc', { type: 'application/msword' }));

    expect(await screen.findByText(/Legacy Word .* can.t be imported/i)).toBeTruthy();
    expect(await screen.findByText(/save as .*docx/i)).toBeTruthy();
    expect(mockParse).not.toHaveBeenCalled();
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

it('allows keyboard users to reach and select the native upload control', async () => {
  const user = userEvent.setup();
  render(<ImportLetterModal />);
  const input = screen.getByLabelText('Choose a PDF or Word file');
  // Radix autofocus should select the first available control, including file inputs.
  expect(input).toHaveFocus();
  await user.tab();
  await user.tab({ shift: true });
  expect(input).toHaveFocus();
});

describe('ImportLetterModal — pasted letter text', () => {
  const text = 'From: Example sender\nTo: Example recipient\nSubj: SAMPLE LETTER\n\n1. Sample body.\n\nA. B. EXAMPLE';
  const result: ParsedImport = {
    parsed: {
      from: 'Example sender', to: 'Example recipient', subject: 'SAMPLE LETTER',
      paragraphs: [{ text: 'Sample body.', level: 0 }],
      references: [], enclosures: [], copyTos: [],
      signature: { first: 'A', middle: 'B', last: 'EXAMPLE' },
    },
    detection: { docType: 'naval_letter', confidence: 'high', reason: 'Has From / To / Subj addressing.' },
    classification: { classLevel: 'unclassified', found: false, reason: '' },
  };

  beforeEach(() => {
    mockParseText.mockReturnValue(result);
    mockHasContent.mockReturnValue(true);
    mockApply.mockReturnValue('applied');
  });

  function pasteLetter(value = text) {
    fireEvent.click(screen.getByRole('button', { name: 'Paste letter text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste letter text' }), { target: { value } });
  }

  it('focuses the text entry and requires non-whitespace text before reading', () => {
    render(<ImportLetterModal />);
    pasteLetter(' \n\t ');
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Read letter' })).toBeDisabled();
    expect(mockParseText).not.toHaveBeenCalled();
  });

  it('shows recognized fields in the existing review before writing to the editor', () => {
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));

    expect(mockParseText).toHaveBeenCalledWith(text);
    expect(mockParse).not.toHaveBeenCalled();
    expect(screen.getByText('Example sender')).toBeInTheDocument();
    expect(screen.getByText('Example recipient')).toBeInTheDocument();
    expect(screen.getByText('SAMPLE LETTER')).toBeInTheDocument();
    expect(screen.getByText('A. B. EXAMPLE')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Document type' })).toBeInTheDocument();
    expect(mockApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Import into editor' }));
    expect(mockApply).toHaveBeenCalledWith(result.parsed, 'naval_letter', result.classification);
    expect(useUIStore.getState().importLetterModalOpen).toBe(false);
  });

  it('carries classification into review and honors the document type the user confirms', async () => {
    const marked = { ...result, classification: { ...result.classification, found: true, reason: 'Marked UNCLASSIFIED.' } };
    mockParseText.mockReturnValue(marked);
    const user = userEvent.setup();
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    expect(screen.getByText('UNCLASSIFIED', { exact: true })).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Document type' }));
    await user.click(screen.getByRole('option', { name: /^Business Letter$/ }));
    await user.click(screen.getByRole('button', { name: 'Import into editor' }));
    expect(mockApply).toHaveBeenCalledWith(result.parsed, 'business_letter', marked.classification);
  });

  it('keeps the pasted text when returning from review, and re-reads corrections', () => {
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit pasted text' }));

    const input = screen.getByRole('textbox', { name: 'Paste letter text' });
    expect(input).toHaveValue(text);
    const corrected = text.replace('SAMPLE LETTER', 'CORRECTED LETTER');
    fireEvent.change(input, { target: { value: corrected } });
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    expect(mockParseText).toHaveBeenLastCalledWith(corrected);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('ignores an old file read that %ss after closing and starting a pasted import', async (outcome) => {
    let finish!: () => void;
    mockParse.mockReturnValue(new Promise<ParsedImport>((resolve, reject) => {
      finish = () => outcome === 'resolve' ? resolve(result) : reject(new Error('old file failed'));
    }));
    render(<ImportLetterModal />);
    selectFile(new File(['sample'], 'old-letter.pdf', { type: 'application/pdf' }));
    expect(screen.getByText('Reading the letter…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    act(() => useUIStore.getState().setImportLetterModalOpen(true));
    pasteLetter();

    await act(async () => finish());
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue(text);
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it.each(['paste', 'review'] as const)('starts fresh after the store closes the dialog during %s', (step) => {
    render(<ImportLetterModal />);
    pasteLetter();
    if (step === 'review') fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    act(() => useUIStore.getState().closeAllModals());
    act(() => useUIStore.getState().setImportLetterModalOpen(true));

    fireEvent.click(screen.getByRole('button', { name: 'Paste letter text' }));
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue('');
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('warns in review when addressing was recognized but the body was not', () => {
    mockParseText.mockReturnValue({ ...result, parsed: { ...result.parsed, paragraphs: [] } });
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/no body paragraphs were recognized/i);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pasted text' }));
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue(text);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('retains unrecognized input and offers an inline correction', () => {
    mockHasContent.mockReturnValue(false);
    render(<ImportLetterModal />);
    pasteLetter('unrecognized text');
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't recognize letter fields/i);
    const input = screen.getByRole('textbox', { name: 'Paste letter text' });
    expect(input).toHaveValue('unrecognized text');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mockApply).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: text } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mockHasContent.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    expect(screen.getByText('SAMPLE LETTER')).toBeInTheDocument();
  });

  it('preserves text if parsing fails or opening the document is blocked', () => {
    mockParseText.mockImplementationOnce(() => { throw new Error('parse failed'); });
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/letter text could not be read/i);
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue(text);

    fireEvent.click(screen.getByRole('button', { name: 'Read letter' }));
    mockApply.mockReturnValue('safety-copy-failed');
    fireEvent.click(screen.getByRole('button', { name: 'Import into editor' }));
    expect(screen.getByText(/could not be opened in the editor/i)).toBeInTheDocument();
    expect(useUIStore.getState().importLetterModalOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pasted text' }));
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue(text);
  });

  it('discards the pasted draft on close and starts fresh when reopened', () => {
    render(<ImportLetterModal />);
    pasteLetter();
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    act(() => useUIStore.getState().setImportLetterModalOpen(true));
    fireEvent.click(screen.getByRole('button', { name: 'Paste letter text' }));
    expect(screen.getByRole('textbox', { name: 'Paste letter text' })).toHaveValue('');
    expect(mockApply).not.toHaveBeenCalled();
  });
});
