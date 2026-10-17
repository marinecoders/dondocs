import { create } from 'zustand';

/**
 * Bridges Contents, the optional sidebar outline, and search to FormPanel.
 * FormPanel publishes the visible section and registers a navigation handler.
 * Routing through a store avoids prop-drilling between the two subtrees.
 * Not persisted.
 */

let jumpHandler: ((id: string) => void) | null = null;

interface EditorOutlineState {
  /** The section currently displayed by FormPanel. */
  activeId: string | null;
  pendingJump: { documentId: string; sectionId: string } | null;
  requestJump: (documentId: string, sectionId: string) => void;
  clearPendingJump: () => void;
  setActiveId: (id: string | null) => void;
  /** FormPanel registers the function that selects and focuses a section. */
  registerJump: (fn: ((id: string) => void) | null) => void;
  /** The sidebar calls this to jump the form to a section. */
  jump: (id: string) => void;
}

export const useEditorOutlineStore = create<EditorOutlineState>((set, get) => ({
  activeId: null,
  pendingJump: null,
  requestJump: (documentId, sectionId) => set({ pendingJump: { documentId, sectionId } }),
  clearPendingJump: () => set({ pendingJump: null }),
  setActiveId: (id) => set((s) => (s.activeId === id ? s : { activeId: id })),
  registerJump: (fn) => {
    jumpHandler = fn;
  },
  jump: (id) => {
    jumpHandler?.(id);
    // Keep the optional outline in sync with the section selector.
    get().setActiveId(id);
  },
}));
