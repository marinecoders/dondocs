import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReferenceChangePreview } from '@/components/editor/ReferenceChangePreview';
import { applyReferenceChange, reviewReferenceChange } from '@/lib/applyReferenceChange';
import { resumeSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, resetCurrentDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { freshParagraphs } from '@/lib/paragraphIdentity';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resumeSessionSaves();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ references: [{ letter: 'a', title: 'Alpha', url: 'https://example.com/a' }, { letter: 'b', title: 'Bravo', url: 'https://example.com/b' }],
    formData: { via: 'Office w/ref (b)', subject: 'Current typing' },
    paragraphs: freshParagraphs([{ text: 'Use reference (b), then reference (a).', level: 0 }]), copyTos: [{ text: 'Office w/ref (b)' }], distributions: [] });
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('reviewed reference changes', () => {
  it('previews list and affected fields without mutation, then applies one atomic edit', () => {
    const proposal = reviewReferenceChange();
    const before = useDocumentStore.getState().getSnapshot();
    const onApplied = vi.fn();
    render(<ReferenceChangePreview proposal={proposal} onClose={vi.fn()} onApplied={onApplied} />);
    expect(screen.getByText('Current references')).toBeVisible();
    expect(screen.getByText('Proposed references')).toBeVisible();
    expect(screen.getByText('Use reference (b), then reference (a).')).toBeVisible();
    expect(screen.getByText('Use reference (a), then reference (b).')).toBeVisible();
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    const observed: string[] = [];
    const unsubscribe = useDocumentStore.subscribe(s => observed.push(`${s.references[0].title}: ${s.paragraphs[0].text}`));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    unsubscribe();
    expect(observed).toEqual(['Bravo: Use reference (a), then reference (b).']);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(useDocumentStore.getState().formData).toEqual({ subject: 'Current typing', via: 'Office w/ref (a)' });
    expect(useDocumentStore.getState().references[0].url).toBe('https://example.com/b');
    expect(applyReferenceChange(proposal)).toBe(false);
  });
  it('gives list, body and ancillary updates exactly one Undo/Redo without losing preceding typing', async () => {
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyReferenceChange(reviewReferenceChange())).toBe(true);
    const after = useDocumentStore.getState().getSnapshot();
    await act(() => vi.advanceTimersByTimeAsync(500));
    const scope = captureDocumentScope();
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(changeDocumentHistory('redo', scope)).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(after);
  });
  it.each(['typing', 'reset', 'switch'] as const)('rejects a preview after %s without touching content or history', action => {
    const proposal = reviewReferenceChange();
    if (action === 'typing') useDocumentStore.getState().updateParagraph(0, { text: 'Later typing' });
    if (action === 'reset') resetCurrentDocument();
    if (action === 'switch') useDocumentsStore.getState().newDocument();
    const before = useDocumentStore.getState().getSnapshot();
    const history = useHistoryStore.getState();
    expect(applyReferenceChange(proposal)).toBe(false);
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(useHistoryStore.getState()).toBe(history);
  });
  it('disables Apply and explains when the preview becomes stale', () => {
    render(<ReferenceChangePreview proposal={reviewReferenceChange()} onClose={vi.fn()} onApplied={vi.fn()} />);
    act(() => useDocumentStore.getState().setField('subject', 'New subject'));
    expect(screen.getByRole('alert')).toHaveTextContent('draft changed');
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  });
  it('shows actionable blockers without an Apply control', () => {
    useDocumentStore.getState().updateParagraph(0, { text: 'Use references (b) through (a).' });
    render(<ReferenceChangePreview proposal={reviewReferenceChange([1, 0])} onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Expand it into individual citations');
    expect(screen.queryByRole('button', { name: 'Apply changes' })).toBeNull();
  });
  it('does not apply a forged proposal or a proposal without an active owner', () => {
    const issued = reviewReferenceChange();
    expect(applyReferenceChange({ ...issued })).toBe(false);
    useDocumentsStore.setState({ currentId: null });
    expect(applyReferenceChange(reviewReferenceChange())).toBe(false);
  });
});

it('requires deliberate review of bare markers and resets acknowledgment for another proposal', () => {
  useDocumentStore.getState().updateParagraph(0, { text: 'Use reference (b). Check (a), (x), and "(b)"; paragraph (b) stays literal.' });
  const proposal = reviewReferenceChange([1, 0]);
  expect(applyReferenceChange(proposal)).toBe(false);
  const view = render(<ReferenceChangePreview proposal={proposal} onClose={vi.fn()} onApplied={vi.fn()} />);
  expect(screen.getByText(/bare \(x\) is not rewritten/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
  const next = reviewReferenceChange([1, 0]);
  view.rerender(<ReferenceChangePreview proposal={next} onClose={vi.fn()} onApplied={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  expect(applyReferenceChange(next, true)).toBe(true);
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Use reference (a). Check (a), (x), and "(b)"; paragraph (b) stays literal.');
});
