import { create } from 'zustand';

/**
 * Bridges the section outline (EditorSidebar) to the form scroll it navigates
 * (FormPanel). FormPanel owns the scroll-spy: it publishes the active section and
 * registers a jump handler; the sidebar reads `activeId` and calls `jump(id)`.
 * Routing through a store avoids prop-drilling between the two subtrees.
 * Not persisted.
 */

let jumpHandler: ((id: string) => void) | null = null;

interface EditorOutlineState {
  /** The section currently in view, as computed by FormPanel's scroll-spy. */
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** FormPanel registers the function that actually scrolls its viewport. */
  registerJump: (fn: ((id: string) => void) | null) => void;
  /** The sidebar calls this to jump the form to a section. */
  jump: (id: string) => void;
}

export const useEditorOutlineStore = create<EditorOutlineState>((set, get) => ({
  activeId: null,
  setActiveId: (id) => set((s) => (s.activeId === id ? s : { activeId: id })),
  registerJump: (fn) => {
    jumpHandler = fn;
  },
  jump: (id) => {
    jumpHandler?.(id);
    // Move the rail highlight immediately; scroll-spy reconfirms it afterward.
    get().setActiveId(id);
  },
}));
