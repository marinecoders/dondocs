import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MechanicalCorrectionPreview, MechanicalCorrections } from '@/components/editor/MechanicalCorrections';
import { applyMechanicalCorrections, reviewMechanicalCorrections } from '@/lib/applyMechanicalCorrections';
import { resumeSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, resetCurrentDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { freshParagraphs } from '@/lib/paragraphIdentity';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resumeSessionSaves();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ docType: 'naval_letter', documentCategory: 'correspondence', documentMode: 'compliant',
    paragraphs: freshParagraphs([{ text: 'Due 05 Nov 2026; return 06 Dec 2026.', level: 0 }, { text: 'Training 1 Jan 2026.', level: 1 }]),
    references: [{ letter: 'a', title: 'Alpha ( notal )', url: 'https://example.com/a' }, { letter: 'b', title: 'Bravo (notal)', url: 'https://example.com/b' }] });
});
afterEach(async () => { await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });
const ids = (proposal: ReturnType<typeof reviewMechanicalCorrections>) => proposal.findings.filter(item => item.after !== undefined).map(item => item.id);

describe('mechanical correction preview and transactions', () => {
  it('previews independent occurrences, allows selection, and leaves unselected content unchanged', () => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    const before = useDocumentStore.getState().getSnapshot();
    const onApplied = vi.fn();
    render(<MechanicalCorrectionPreview proposal={proposal} audience="military" onClose={vi.fn()} onApplied={onApplied} />);
    expect(screen.getByText('“5 November 2026”')).toBeVisible();
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paragraph 1, date 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paragraph 2, date 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 correction' }));
    expect(onApplied).toHaveBeenCalledOnce();
    expect(useDocumentStore.getState().paragraphs.map(p => p.text)).toEqual(['Due 5 November 2026; return 06 Dec 2026.', 'Training 1 Jan 2026.']);
  });
  it('publishes all selected spans atomically, handles length shifts, and uses one Undo/Redo', async () => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    const before = useDocumentStore.getState().getSnapshot();
    const paragraphIds = before.paragraphs.map(paragraph => paragraph.id);
    expect(paragraphIds.every(Boolean)).toBe(true);
    expect(new Set(paragraphIds).size).toBe(2);
    const observed: string[][] = [];
    const unsubscribe = useDocumentStore.subscribe(state => observed.push(state.paragraphs.map(p => p.text)));
    expect(applyMechanicalCorrections(proposal, ids(proposal), 'military')).toBe(true);
    unsubscribe();
    expect(observed).toEqual([['Due 5 November 2026; return 6 December 2026.', 'Training 1 January 2026.']]);
    const after = useDocumentStore.getState().getSnapshot();
    expect(after.paragraphs.map(paragraph => paragraph.id)).toEqual(paragraphIds);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(after);
  });
  it('normalizes selected NOTAL titles without changing source letters, order, URLs or body', () => {
    const proposal = reviewMechanicalCorrections('references', null);
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyMechanicalCorrections(proposal, [ids(proposal)[1]], null)).toBe(true);
    expect(useDocumentStore.getState().getSnapshot()).toEqual({ ...before,
      references: [before.references[0], { ...before.references[1], title: 'Bravo (NOTAL)' }] });
  });
  it.each(['typing', 'move', 'reset', 'switch', 'reference-title', 'reference-url'] as const)('rejects all selected changes after %s without a partial edit or history entry', action => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    if (action === 'typing') useDocumentStore.getState().updateParagraph(0, { text: 'Later typing ' + useDocumentStore.getState().paragraphs[0].text });
    if (action === 'move') useDocumentStore.getState().reorderParagraphs(1, 0);
    if (action === 'reset') resetCurrentDocument();
    if (action === 'switch') useDocumentsStore.getState().newDocument();
    if (action === 'reference-title') useDocumentStore.getState().updateReference(0, { title: 'New title' });
    if (action === 'reference-url') useDocumentStore.getState().updateReference(0, { url: 'https://example.com/replaced' });
    const before = useDocumentStore.getState().getSnapshot();
    const history = useHistoryStore.getState();
    expect(applyMechanicalCorrections(proposal, ids(proposal), 'military')).toBe(false);
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(useHistoryStore.getState()).toBe(history);
  });
  it('rejects an old NOTAL proposal after references reorder', () => {
    const proposal = reviewMechanicalCorrections('references', null);
    useDocumentStore.getState().reorderReferences(1, 0);
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyMechanicalCorrections(proposal, ids(proposal), null)).toBe(false);
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
  it('rejects an audience change, duplicate or unknown selections and forged/repeated proposals', () => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    const selected = ids(proposal);
    for (const selectedIds of [[], ['missing'], [selected[0], selected[0]]]) expect(applyMechanicalCorrections(proposal, selectedIds, 'military')).toBe(false);
    expect(applyMechanicalCorrections(proposal, selected, 'civilian')).toBe(false);
    expect(applyMechanicalCorrections({ ...proposal }, selected, 'military')).toBe(false);
    expect(applyMechanicalCorrections(proposal, selected, 'military')).toBe(true);
    expect(applyMechanicalCorrections(proposal, selected, 'military')).toBe(false);
  });
  it('keeps invalid and short years advisory without Apply', () => {
    useDocumentStore.getState().updateParagraph(0, { text: 'Due 5 Nov 26 or 31 Apr 2026.' });
    useDocumentStore.getState().removeParagraph(1);
    const proposal = reviewMechanicalCorrections('body', 'military');
    render(<MechanicalCorrectionPreview proposal={proposal} audience="military" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getAllByText(/manual review/)).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull();
    expect(applyMechanicalCorrections(proposal, proposal.findings.map(item => item.id), 'military')).toBe(false);
  });
  it('makes changed drafts and changed audience choices visibly stale', () => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    const view = render(<MechanicalCorrectionPreview proposal={proposal} audience="military" onClose={vi.fn()} onApplied={vi.fn()} />);
    view.rerender(<MechanicalCorrectionPreview proposal={proposal} audience="civilian" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('audience choice changed');
    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
    view.rerender(<MechanicalCorrectionPreview proposal={proposal} audience="military" onClose={vi.fn()} onApplied={vi.fn()} />);
    act(() => useDocumentStore.getState().updateParagraph(0, { text: 'Later' }));
    expect(screen.getByRole('button', { name: /^Apply/ })).toBeDisabled();
  });
  it('does not carry a selection into a different preview', () => {
    const proposal = reviewMechanicalCorrections('body', 'military');
    const view = render(<MechanicalCorrectionPreview proposal={proposal} audience="military" onClose={vi.fn()} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paragraph 1, date 1' }));
    expect(screen.getByRole('button', { name: 'Apply 2 corrections' })).toBeVisible();
    const next = reviewMechanicalCorrections('body', 'civilian');
    view.rerender(<MechanicalCorrectionPreview proposal={next} audience="civilian" onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Apply 3 corrections' })).toBeVisible();
  });
  it('requires explicit audience selection in the panel', () => {
    render(<MechanicalCorrections section="body" />);
    expect(screen.getByRole('combobox', { name: 'Body date audience' })).toHaveTextContent('Choose the audience');
    expect(screen.getByRole('button', { name: 'Review body date formatting' })).toBeDisabled();
  });
});
