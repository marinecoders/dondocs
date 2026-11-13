import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FormattingCheck } from '@/components/editor/FormattingCheck';
import { applyFormattingFix } from '@/lib/applyFormattingFix';
import { formattingFindings } from '@/lib/formattingFindings';
import { resumeSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, resetCurrentDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resumeSessionSaves();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setFormData({ date: '2026-11-12', sigFirst: ' J . ', sigMiddle: ' R . ', subject: 'Leave this alone' });
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('formatting fix preview, targeting and history', () => {
  it('shows the exact proposal before changing anything, and leaves other content intact', () => {
    const before = useDocumentStore.getState().getSnapshot();
    render(<FormattingCheck section="addressing" />);
    expect(screen.getByText('Current')).toBeVisible();
    expect(screen.getByText('“2026-11-12”')).toBeVisible();
    expect(screen.getByText('Proposed')).toBeVisible();
    expect(screen.getByText('“12 Nov 26”')).toBeVisible();
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);

    fireEvent.click(screen.getByRole('button', { name: 'Apply date formatting fix' }));
    expect(useDocumentStore.getState().getSnapshot()).toEqual({ ...before, formData: { ...before.formData, date: '12 Nov 26' } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Use Undo');
  });

  it('Undo restores only the fix even when a preceding edit is still debounced', async () => {
    render(<FormattingCheck section="addressing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply date formatting fix' }));
    // Exercise the ordinary capture after the explicit before/after captures.
    await act(() => vi.advanceTimersByTimeAsync(500));
    const scope = captureDocumentScope();
    act(() => { expect(changeDocumentHistory('undo', scope)).toBe('applied'); });
    expect(useDocumentStore.getState().formData).toMatchObject({ date: '2026-11-12', subject: 'Leave this alone' });
    expect(screen.getByRole('button', { name: 'Apply date formatting fix' })).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => { expect(changeDocumentHistory('redo', scope)).toBe('applied'); });
    expect(useDocumentStore.getState().formData.date).toBe('12 Nov 26');
  });

  it('keeps keyboard focus at the result after the Apply button disappears', () => {
    render(<FormattingCheck section="addressing" />);
    const button = screen.getByRole('button', { name: 'Apply date formatting fix' });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('does not carry success feedback into a replacement activation of the same draft', () => {
    render(<FormattingCheck section="addressing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply date formatting fix' }));
    expect(screen.getByRole('status')).toHaveTextContent('formatting applied');
    const id = useDocumentsStore.getState().currentId;
    act(() => {
      expect(resetCurrentDocument()).toBe('applied');
      useDocumentStore.getState().setField('date', '12 Nov 26');
    });
    expect(useDocumentsStore.getState().currentId).toBe(id);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives rapid adjacent fixes separate immediate Undo steps and preserves later typing', () => {
    render(<FormattingCheck section="signature" />);
    const scope = captureDocumentScope();
    fireEvent.click(screen.getByRole('button', { name: 'Apply first name initial formatting fix' }));
    expect(useDocumentStore.getState().formData.sigMiddle).toBe(' R . ');
    fireEvent.click(screen.getByRole('button', { name: 'Apply middle initial formatting fix' }));
    act(() => { useDocumentStore.getState().setField('subject', 'Later typing'); });
    act(() => { changeDocumentHistory('undo', scope); });
    expect(useDocumentStore.getState().formData).toMatchObject({ subject: 'Leave this alone', sigFirst: 'J.', sigMiddle: 'R.' });
    act(() => { changeDocumentHistory('undo', scope); });
    expect(useDocumentStore.getState().formData).toMatchObject({ sigFirst: 'J.', sigMiddle: ' R . ' });
    act(() => { changeDocumentHistory('undo', scope); });
    expect(useDocumentStore.getState().formData).toMatchObject({ sigFirst: ' J . ', sigMiddle: ' R . ' });
  });

  it('displays ambiguous dates for review without an Apply control or mutation', () => {
    useDocumentStore.getState().setField('date', '03/04/2026');
    render(<FormattingCheck section="addressing" />);
    expect(screen.getByText('Date: review date')).toBeVisible();
    expect(screen.queryByText('Proposed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const finding = formattingFindings(useDocumentStore.getState(), 'addressing')[0];
    expect(applyFormattingFix(finding, 'addressing', captureDocumentScope())).toBe(false);
    expect(useDocumentStore.getState().formData.date).toBe('03/04/2026');
  });

  it('rejects a stale proposal without recording history', () => {
    const scope = captureDocumentScope();
    const finding = formattingFindings(useDocumentStore.getState(), 'addressing')[0];
    useDocumentStore.getState().setField('date', '2026-12-13');
    const history = useHistoryStore.getState();
    expect(applyFormattingFix(finding, 'addressing', scope)).toBe(false);
    expect(useDocumentStore.getState().formData.date).toBe('2026-12-13');
    expect(useHistoryStore.getState()).toBe(history);
  });

  it('rejects a proposal when a document type change requires a different date style', () => {
    const scope = captureDocumentScope();
    const finding = formattingFindings(useDocumentStore.getState(), 'addressing')[0];
    useDocumentStore.getState().setDocType('business_letter');
    const before = useDocumentStore.getState().getSnapshot();
    const history = useHistoryStore.getState();
    expect(applyFormattingFix(finding, 'addressing', scope)).toBe(false);
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(useHistoryStore.getState()).toBe(history);
  });

  it('does not create a second edit when Apply is invoked twice for the same proposal', () => {
    const scope = captureDocumentScope();
    const finding = formattingFindings(useDocumentStore.getState(), 'addressing')[0];
    expect(applyFormattingFix(finding, 'addressing', scope)).toBe(true);
    const history = useHistoryStore.getState();
    expect(applyFormattingFix(finding, 'addressing', scope)).toBe(false);
    expect(useHistoryStore.getState()).toBe(history);
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(useDocumentStore.getState().formData.date).toBe(finding.before);
  });

  it('rejects a proposal retained across a document switch even when the value matches', () => {
    const scope = captureDocumentScope();
    const finding = formattingFindings(useDocumentStore.getState(), 'addressing')[0];
    useDocumentsStore.getState().newDocument();
    useDocumentStore.getState().setField('date', finding.before);
    const history = useHistoryStore.getState();
    expect(applyFormattingFix(finding, 'addressing', scope)).toBe(false);
    expect(useDocumentStore.getState().formData.date).toBe(finding.before);
    expect(useHistoryStore.getState()).toBe(history);
  });
});
