/**
 * Regression (audit critical #6): the ErrorBoundary's recovery operated on
 * the wrong localStorage key. Its UI says "auto-saved draft", but it
 * read/cleared STORAGE_KEYS.DOCUMENT (the manual Save/Load key) while the
 * thing that rehydrates at startup — and can crash-loop the app — is the
 * auto-saved session under DOCUMENT_SESSION. So "Copy saved draft" copied
 * nothing, and "Reset and reload" left the crashing session in place →
 * infinite crash loop. Recovery now targets the auto-saved session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { STORAGE_KEYS } from '@/lib/constants';
import { useDocumentStore, getSavedSession } from '@/stores/documentStore';

describe('ErrorBoundary recovery key (critical #6)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('the recovery keys are distinct and both defined', () => {
    expect(STORAGE_KEYS.DOCUMENT).toBe('dondocs-document');
    expect(STORAGE_KEYS.DOCUMENT_SESSION).toBe('dondocs-document-session');
    expect(STORAGE_KEYS.DOCUMENT).not.toBe(STORAGE_KEYS.DOCUMENT_SESSION);
  });

  it('the auto-saved session lands under DOCUMENT_SESSION, not DOCUMENT', () => {
    vi.useFakeTimers();
    useDocumentStore.setState({ formData: { subject: 'RECOVERY MARKER' } as never });
    vi.advanceTimersByTime(3000); // past the 2s autosave debounce
    vi.useRealTimers();

    // What ErrorBoundary now reads (DOCUMENT_SESSION via getSavedSession) —
    // populated. The old key it used to read (DOCUMENT) — empty.
    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT_SESSION)).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBeNull();
    expect(getSavedSession()?.formData?.subject).toBe('RECOVERY MARKER');
  });
});
