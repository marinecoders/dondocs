import { create } from 'zustand';
import type { Reference, Enclosure, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode } from '@/types/document';

// Snapshot of document state (only the data parts, not actions)
export interface DocumentSnapshot {
  documentMode: DocumentMode;
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

interface HistoryState {
  // History stacks
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];

  // Current snapshot for comparison
  currentSnapshot: DocumentSnapshot | null;

  // Max history size
  maxHistorySize: number;

  // Actions
  saveSnapshot: (snapshot: DocumentSnapshot) => void;
  undo: () => DocumentSnapshot | null;
  redo: () => DocumentSnapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

// Deep equality check for snapshots (excluding non-serializable data like ArrayBuffer)
function snapshotsEqual(a: DocumentSnapshot | null, b: DocumentSnapshot | null): boolean {
  if (a === null || b === null) return a === b;

  // Quick checks
  if (a.documentMode !== b.documentMode) return false;
  if (a.docType !== b.docType) return false;
  if (a.paragraphs.length !== b.paragraphs.length) return false;
  if (a.references.length !== b.references.length) return false;
  if (a.enclosures.length !== b.enclosures.length) return false;
  if (a.copyTos.length !== b.copyTos.length) return false;
  if ((a.distributions?.length || 0) !== (b.distributions?.length || 0)) return false;

  // Check formData — compare all populated keys for full change detection
  // (covers showSubjectOnContinuation, includeHyperlinks, classification, etc.)
  const allKeys = new Set([
    ...Object.keys(a.formData),
    ...Object.keys(b.formData),
  ]) as Set<keyof DocumentData>;
  for (const key of allKeys) {
    // Skip signatureImage (non-serializable, large)
    if (key === 'signatureImage') continue;
    if (a.formData[key] !== b.formData[key]) return false;
  }

  // Check paragraphs
  for (let i = 0; i < a.paragraphs.length; i++) {
    if (a.paragraphs[i].text !== b.paragraphs[i].text) return false;
    if (a.paragraphs[i].level !== b.paragraphs[i].level) return false;
    if (a.paragraphs[i].portionMarking !== b.paragraphs[i].portionMarking) return false;
  }

  // Check references
  for (let i = 0; i < a.references.length; i++) {
    if (a.references[i].title !== b.references[i].title) return false;
  }

  // Check copyTos
  for (let i = 0; i < a.copyTos.length; i++) {
    if (a.copyTos[i].text !== b.copyTos[i].text) return false;
  }

  // Check distributions
  const aDist = a.distributions || [];
  const bDist = b.distributions || [];
  for (let i = 0; i < aDist.length; i++) {
    if (aDist[i].text !== bDist[i].text) return false;
  }

  return true;
}

// Create a clean copy of the snapshot (without non-serializable data)
function cloneSnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
  return {
    documentMode: snapshot.documentMode,
    docType: snapshot.docType,
    formData: { ...snapshot.formData },
    references: snapshot.references.map(r => ({ ...r })),
    enclosures: snapshot.enclosures.map(e => ({
      title: e.title,
      pageStyle: e.pageStyle,
      hasCoverPage: e.hasCoverPage,
      coverPageDescription: e.coverPageDescription,
      // Note: We don't store file data in history (too large)
    })),
    paragraphs: snapshot.paragraphs.map(p => ({ ...p })),
    copyTos: snapshot.copyTos.map(c => ({ ...c })),
    distributions: (snapshot.distributions || []).map(d => ({ ...d })),
  };
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  currentSnapshot: null,
  maxHistorySize: 50,

  saveSnapshot: (snapshot) => {
    const state = get();
    const clonedSnapshot = cloneSnapshot(snapshot);

    // Don't save if identical to current
    if (snapshotsEqual(clonedSnapshot, state.currentSnapshot)) {
      return;
    }

    // If we have a current snapshot, push it to past
    if (state.currentSnapshot !== null) {
      const newPast = [...state.past, state.currentSnapshot];

      // Limit history size
      if (newPast.length > state.maxHistorySize) {
        newPast.shift();
      }

      set({
        past: newPast,
        future: [], // Clear future when new action is taken
        currentSnapshot: clonedSnapshot,
      });
    } else {
      // First snapshot
      set({ currentSnapshot: clonedSnapshot });
    }
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return null;

    const newPast = [...state.past];
    const previousSnapshot = newPast.pop()!;

    // Move current to future
    const newFuture = state.currentSnapshot
      ? [state.currentSnapshot, ...state.future]
      : state.future;

    set({
      past: newPast,
      future: newFuture,
      currentSnapshot: previousSnapshot,
    });

    return previousSnapshot;
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return null;

    const newFuture = [...state.future];
    const nextSnapshot = newFuture.shift()!;

    // Move current to past
    const newPast = state.currentSnapshot
      ? [...state.past, state.currentSnapshot]
      : state.past;

    set({
      past: newPast,
      future: newFuture,
      currentSnapshot: nextSnapshot,
    });

    return nextSnapshot;
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clearHistory: () => set({
    past: [],
    future: [],
    currentSnapshot: null,
  }),
}));
