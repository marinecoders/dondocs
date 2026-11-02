import type { FormInstance } from '@/services/forms/model';
import { create } from 'zustand';
import type { FormSession } from './formStore';
import type { Reference, Enclosure, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode, DocumentCategory, FormType, EndItem, PublicationTableRow } from '@/types/document';

// Snapshot of document state (only the data parts, not actions)
export interface DocumentSnapshot {
  genericForm?: FormInstance;
  documentMode: DocumentMode;
  documentCategory?: DocumentCategory;
  formType?: FormType;
  forms?: FormSession;
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
  endItems: EndItem[];
  publicationTables: Record<string, PublicationTableRow[]>;
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

  if (a.enclosures.some((e, i) => e.file?.data !== b.enclosures[i]?.file?.data)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Create a clean copy of the snapshot (without non-serializable data)
function cloneSnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
  return {
    genericForm: snapshot.genericForm ? structuredClone(snapshot.genericForm) : undefined,
    documentMode: snapshot.documentMode,
    documentCategory: snapshot.documentCategory,
    formType: snapshot.formType,
    forms: snapshot.forms ? structuredClone(snapshot.forms) : undefined,
    docType: snapshot.docType,
    formData: { ...snapshot.formData, ...(snapshot.formData.sl3 ? { sl3: structuredClone(snapshot.formData.sl3) } : {}) },
    references: snapshot.references.map(r => ({ ...r })),
    // Immutable file buffers can be shared by reference across undo states.
    enclosures: snapshot.enclosures.map(e => ({ ...e })),
    paragraphs: snapshot.paragraphs.map(p => ({ ...p })),
    copyTos: snapshot.copyTos.map(c => ({ ...c })),
    distributions: (snapshot.distributions || []).map(d => ({ ...d })),
    endItems: (snapshot.endItems || []).map(e => ({ ...e })),
    publicationTables: Object.fromEntries(
      Object.entries(snapshot.publicationTables || {}).map(([key, rows]) => [key, rows.map(r => ({ ...r, values: { ...r.values } }))]),
    ),
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
