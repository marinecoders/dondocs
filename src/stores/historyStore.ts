import type { DocumentScope } from './documentsStore';
import type { FormInstance } from '@/services/forms/model';
import { create } from 'zustand';
import type { FormSession } from './formStore';
import type { Reference, Enclosure, FileRef, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode, DocumentCategory, FormType, EndItem, PublicationTableRow } from '@/types/document';

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

export interface HistoryEntry extends DocumentSnapshot {
  readonly owner: DocumentScope | null;
}

function sameOwner(a: DocumentScope | null, b: DocumentScope | null): boolean {
  return a === b || !!a && !!b && a.documentId === b.documentId && a.epoch === b.epoch;
}

interface HistoryState {
  owner: DocumentScope | null;
  bindOwner: (owner: DocumentScope | null) => void;
  restoreHistory: (history: Pick<HistoryState, 'past' | 'future' | 'currentSnapshot'>, owner: DocumentScope | null) => void;
  // History stacks
  past: HistoryEntry[];
  future: HistoryEntry[];

  // Current snapshot for comparison
  currentSnapshot: HistoryEntry | null;

  // Max history size
  maxHistorySize: number;

  // Actions
  saveSnapshot: (snapshot: DocumentSnapshot, owner?: DocumentScope | null) => void;
  undo: (owner?: DocumentScope | null) => HistoryEntry | null;
  redo: (owner?: DocumentScope | null) => HistoryEntry | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

function sameAttachment(file: Enclosure['file'], ref: FileRef | undefined, otherFile: Enclosure['file'], otherRef: FileRef | undefined): boolean {
  // A durable handle owns its bytes; hydration may materialize another buffer
  // for the same handle without changing the document.
  if (ref && otherRef) return JSON.stringify(ref) === JSON.stringify(otherRef);
  // Persisting a transient upload adds a handle to the very same file. Until
  // then buffer identity keeps same-name, same-size replacement uploads distinct.
  if (file && otherFile) return file.data === otherFile.data && file.name === otherFile.name && file.size === otherFile.size;
  return !file && !otherFile && !ref && !otherRef;
}

// Compare user content, independently of when persisted bytes are hydrated.
function snapshotsEqual(a: DocumentSnapshot | null, b: DocumentSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.enclosures.length !== b.enclosures.length || a.enclosures.some((enclosure, index) => {
    const other = b.enclosures[index];
    return !sameAttachment(enclosure.file, enclosure.fileRef, other.file, other.fileRef);
  })) return false;
  if (!sameAttachment(a.formData.basicLetterFile, a.formData.basicLetterFileRef, b.formData.basicLetterFile, b.formData.basicLetterFileRef)) return false;
  const content = (snapshot: DocumentSnapshot) => ({
    ...snapshot,
    formData: { ...snapshot.formData, basicLetterFile: undefined, basicLetterFileRef: undefined },
    enclosures: snapshot.enclosures.map(({ file: _file, fileRef: _ref, ...enclosure }) => enclosure),
  });
  return JSON.stringify(content(a)) === JSON.stringify(content(b));
}

// Create a clean copy of the snapshot (without non-serializable data)
function cloneSnapshot(snapshot: DocumentSnapshot, owner: DocumentScope | null): HistoryEntry {
  return {
    owner,
    genericForm: snapshot.genericForm ? structuredClone(snapshot.genericForm) : undefined,
    documentMode: snapshot.documentMode,
    documentCategory: snapshot.documentCategory,
    formType: snapshot.formType,
    forms: snapshot.forms ? structuredClone(snapshot.forms) : undefined,
    docType: snapshot.docType,
    formData: { ...snapshot.formData, ...(snapshot.formData.manualFrontMatter ? { manualFrontMatter: structuredClone(snapshot.formData.manualFrontMatter) } : {}), ...(snapshot.formData.sl4 ? { sl4: structuredClone(snapshot.formData.sl4) } : {}), ...(snapshot.formData.sl3 ? { sl3: structuredClone(snapshot.formData.sl3) } : {}) },
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
  owner: null,
  bindOwner: (owner) => set({ owner, past: [], future: [], currentSnapshot: null }),
  restoreHistory: (history, owner) => set({
    owner,
    past: history.past.map(snapshot => cloneSnapshot(snapshot, owner)),
    future: history.future.map(snapshot => cloneSnapshot(snapshot, owner)),
    currentSnapshot: history.currentSnapshot ? cloneSnapshot(history.currentSnapshot, owner) : null,
  }),
  past: [],
  future: [],
  currentSnapshot: null,
  maxHistorySize: 50,

  saveSnapshot: (snapshot, owner = get().owner) => {
    const state = get();
    if (!sameOwner(owner, state.owner)) return;
    const clonedSnapshot = cloneSnapshot(snapshot, owner);

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

  undo: (owner = get().owner) => {
    const state = get();
    if (!sameOwner(owner, state.owner) || state.past.length === 0
      || !sameOwner(state.past.at(-1)!.owner, owner)
      || state.currentSnapshot && !sameOwner(state.currentSnapshot.owner, owner)) return null;

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

  redo: (owner = get().owner) => {
    const state = get();
    if (!sameOwner(owner, state.owner) || state.future.length === 0
      || !sameOwner(state.future[0].owner, owner)
      || state.currentSnapshot && !sameOwner(state.currentSnapshot.owner, owner)) return null;

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

/** Read-only availability for controls; mutations belong to the workspace owner. */
export function useCanUndo(): boolean { return useHistoryStore(state => state.past.length > 0); }
export function useCanRedo(): boolean { return useHistoryStore(state => state.future.length > 0); }
