/**
 * Regression (audit C-10): mount-time store writes (profile letterhead
 * sync, defaults) triggered the 2s-debounced session autosave, which
 * overwrote the saved session BEFORE the user clicked Restore —
 * restoreSession() re-reads localStorage at click time, so anyone who
 * took >2s to read the prompt restored the freshly-overwritten default
 * document. suspendSessionSaves()/resumeSessionSaves() freeze the
 * session autosave while the restore prompt is pending.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useDocumentStore,
  suspendSessionSaves,
  resumeSessionSaves,
} from '@/stores/documentStore';

const KEY = 'dondocs-document-session';

describe('restore race: session saves suspended while prompt pending (C-10)', () => {
  beforeEach(() => {
    localStorage.clear();
    resumeSessionSaves();
    vi.useFakeTimers();
  });

  it('store mutations while suspended do not overwrite the saved session', () => {
    localStorage.setItem(KEY, JSON.stringify({ marker: 'users-saved-work' }));
    suspendSessionSaves();
    // Simulate the mount-time profile-sync write the audit traced.
    useDocumentStore.setState({ formData: { subject: 'fresh default' } as never });
    vi.advanceTimersByTime(5000); // well past the 2s debounce
    expect(localStorage.getItem(KEY)).toContain('users-saved-work');
    resumeSessionSaves();
    vi.useRealTimers();
  });

  it('after resume, autosave works again', () => {
    suspendSessionSaves();
    resumeSessionSaves();
    useDocumentStore.setState({ formData: { subject: 'post-decision edit' } as never });
    vi.advanceTimersByTime(5000);
    // Payload is compressed ('gz:' prefix) — assert the save happened,
    // not its raw content.
    const saved = localStorage.getItem(KEY);
    expect(saved).toBeTruthy();
    vi.useRealTimers();
  });
});
