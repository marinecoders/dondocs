import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { compressedLocalStorage } from '@/lib/compressedStorage';

/**
 * Reusable body-paragraph clauses. People who write structured, repetitive
 * correspondence reuse the same openings, closings, and boilerplate; this is a
 * small personal library of them, seeded with a few SECNAV-standard starters and
 * extendable with the user's own. Persisted to compressed localStorage.
 */
export interface Snippet {
  id: string;
  name: string;
  text: string;
}

// Seeded once; deletions persist (the stored array replaces this on reload).
const DEFAULT_SNIPPETS: Snippet[] = [
  {
    id: 'seed-iaw-opening',
    name: 'IAW reference opening',
    text: 'In accordance with reference (a), the following is submitted.',
  },
  {
    id: 'seed-purpose',
    name: 'Purpose statement',
    text: 'The purpose of this correspondence is to [state purpose].',
  },
  {
    id: 'seed-request-action',
    name: 'Request for action',
    text: 'Request your command review the enclosed and provide comments no later than [date].',
  },
  {
    id: 'seed-cui-handling',
    name: 'CUI handling paragraph',
    text: 'This document contains Controlled Unclassified Information (CUI) and shall be handled, stored, and disseminated in accordance with reference (a).',
  },
  {
    id: 'seed-poc-closing',
    name: 'Point-of-contact closing',
    text: 'The point of contact for this matter is [rank and name], [title], who can be reached at [phone] or [email].',
  },
];

const newSnippetId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `snip_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

interface SnippetsState {
  snippets: Snippet[];
  /** Add a clause; auto-names from the first words when no name is given. */
  addSnippet: (name: string, text: string) => void;
  deleteSnippet: (id: string) => void;
}

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set) => ({
      snippets: DEFAULT_SNIPPETS,

      addSnippet: (name, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const label = name.trim() || `${trimmed.slice(0, 40)}${trimmed.length > 40 ? '…' : ''}`;
        set((s) => ({ snippets: [...s.snippets, { id: newSnippetId(), name: label, text: trimmed }] }));
      },

      deleteSnippet: (id) => set((s) => ({ snippets: s.snippets.filter((sn) => sn.id !== id) })),
    }),
    {
      name: 'dondocs_snippets',
      storage: createJSONStorage(() => compressedLocalStorage),
    }
  )
);
