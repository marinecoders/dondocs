import { create } from 'zustand';
import { format, parse, isValid } from 'date-fns';
import type { Reference, Enclosure, FileRef, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode, DocumentCategory, FormType } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { loadAttachment, persistAttachment } from '@/lib/attachments';
import { useHistoryStore } from './historyStore';
import type { DocumentSnapshot } from './historyStore';
import { useUIStore } from './uiStore';
import { debug } from '@/lib/debug';
import { TIMING, STORAGE_KEYS} from '@/lib/constants';
import { compressedParse, compressedStringify } from '@/lib/compressedStorage';
import { referenceStartIndex } from '@/lib/endorsement';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { normalizeLevels, migratePortionMarkings } from '@/lib/paragraphUtils';

// Session persistence keys
const SESSION_STORAGE_KEY = STORAGE_KEYS.DOCUMENT_SESSION;
const SESSION_TIMESTAMP_KEY = 'dondocs-session-timestamp';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Serializable session data (excludes file ArrayBuffers)
export interface SerializedSession {
  documentMode: DocumentMode;
  documentCategory: DocumentCategory;
  docType: string;
  formType: FormType;
  formData: Partial<DocumentData>;
  references: Reference[];
  // `file` bytes live in the attachments store; `fileRef` is the durable handle
  // that rehydrates them on load. `hasFile` stays for legacy sessions written
  // before fileRef existed (they had bytes in memory but nothing to recover).
  enclosures: Array<Omit<Enclosure, 'file'> & { hasFile?: boolean; fileRef?: FileRef }>;
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
  timestamp: number;
}

// Military date format per SECNAV M-5216.5: "4 Jan 26" (day month 2-digit year)
const formatMilitaryDate = (date: Date): string => format(date, 'd MMM yy');

// Spelled date format for business letters: "January 4, 2026"
const formatSpelledDate = (date: Date): string => format(date, 'MMMM d, yyyy');

// Parse a date string that could be in either format
const parseDateString = (dateString: string): Date | null => {
  if (!dateString?.trim()) return null;

  const formats = [
    'd MMM yy',         // Military: 4 Jan 26
    'dd MMM yy',        // Military: 04 Jan 26
    'MMMM d, yyyy',     // Spelled: January 4, 2026
    'd MMMM yyyy',      // Alternate: 4 January 2026
    'MM/dd/yyyy',       // US: 01/04/2026
    'yyyy-MM-dd',       // ISO: 2026-01-04
  ];

  for (const fmt of formats) {
    try {
      const parsed = parse(dateString.trim(), fmt, new Date());
      if (isValid(parsed) && parsed.getFullYear() > 1900 && parsed.getFullYear() < 2100) {
        return parsed;
      }
    } catch {
      // Continue to next format
    }
  }

  // Try native Date as fallback
  const native = new Date(dateString);
  if (isValid(native) && native.getFullYear() > 1900 && native.getFullYear() < 2100) {
    return native;
  }

  return null;
};

// Convert date string to the specified format
const convertDateFormat = (dateString: string, targetFormat: 'military' | 'spelled'): string => {
  const date = parseDateString(dateString);
  if (!date) return dateString; // Return original if can't parse
  return targetFormat === 'spelled' ? formatSpelledDate(date) : formatMilitaryDate(date);
};

export interface DocumentState {
  // Document data
  documentMode: DocumentMode;
  documentCategory: DocumentCategory;
  docType: string;
  formType: FormType;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];

  // Actions - Form
  setDocumentMode: (mode: DocumentMode) => void;
  setDocumentCategory: (category: DocumentCategory) => void;
  setDocType: (type: string) => void;
  setFormType: (type: FormType) => void;
  setField: <K extends keyof DocumentData>(key: K, value: DocumentData[K]) => void;
  setFormData: (data: Partial<DocumentData>) => void;
  resetForm: () => void;

  // Actions - References
  addReference: (title: string, url?: string) => void;
  updateReference: (index: number, updates: Partial<Reference>) => void;
  removeReference: (index: number) => void;
  reorderReferences: (fromIndex: number, toIndex: number) => void;

  // Actions - Enclosures
  addEnclosure: (title: string, file?: Enclosure['file'], fileRef?: FileRef) => void;
  updateEnclosure: (index: number, updates: Partial<Enclosure>) => void;
  removeEnclosure: (index: number) => void;
  reorderEnclosures: (fromIndex: number, toIndex: number) => void;

  // Actions - Paragraphs
  addParagraph: (text: string, level: number, afterIndex?: number) => void;
  /** Insert several paragraphs (a split paste) after `afterIndex` in one edit. */
  insertParagraphs: (afterIndex: number, texts: string[], level: number) => void;
  updateParagraph: (index: number, updates: Partial<Paragraph>) => void;
  removeParagraph: (index: number) => void;
  reorderParagraphs: (fromIndex: number, toIndex: number) => void;
  indentParagraph: (index: number) => void;
  outdentParagraph: (index: number) => void;

  // Actions - Copy To
  addCopyTo: (text: string) => void;
  updateCopyTo: (index: number, text: string) => void;
  removeCopyTo: (index: number) => void;

  // Actions - Distribution
  addDistribution: (text: string) => void;
  updateDistribution: (index: number, text: string) => void;
  removeDistribution: (index: number) => void;

  // Bulk Actions
  clearParagraphs: () => void;
  clearReferences: () => void;
  clearEnclosures: () => void;
  clearCopyTos: () => void;
  clearAll: () => void;
  clearFieldsExceptLetterhead: () => void;
  loadTemplate: (data: {
    paragraphs?: Paragraph[];
    references?: Reference[];
    enclosures?: Enclosure[];
    copyTos?: CopyTo[];
    formData?: Partial<DocumentData>;
  }) => void;

  // History (Undo/Redo)
  applySnapshot: (snapshot: DocumentSnapshot) => void;
  getSnapshot: () => DocumentSnapshot;
}

// `offset` shifts the sequence so an endorsement can continue the basic
// letter's lettering (Ch 9 ¶3) — it is 0 for every non-endorsement.
const letterAt = (index: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  return alphabet[index] || `a${index - 26}`;
};

const getNextReferenceLetter = (refs: Reference[], offset = 0): string =>
  letterAt(refs.length + offset);

const reLetterReferences = (refs: Reference[], offset = 0): Reference[] =>
  refs.map((ref, index) => ({ ...ref, letter: letterAt(index + offset) }));

// Example form data for first-time visitors (one-time mode / no profile selected)
const EXAMPLE_FORM_DATA: Partial<DocumentData> = {
  docType: 'naval_letter',
  fontSize: '12pt',
  fontFamily: 'times',
  pageNumbering: 'none',
  // Letterhead - Example unit info for demo
  department: 'usmc',
  unitLine1: '1ST BATTALION, 6TH MARINES',
  unitLine2: '2D MARINE DIVISION, II MEF',
  unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
  sealType: 'dow',
  letterheadColor: 'blue',
  // Document identification
  ssic: '1000',
  serial: '0123',
  date: formatMilitaryDate(new Date()),
  // Addressing
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  to: '[RECIPIENT]',
  via: '',
  subject: '[SUBJECT]',
  // Signature
  sigFirst: 'John',
  sigMiddle: 'A',
  sigLast: 'DOE',
  sigRank: 'Lieutenant Colonel',
  sigTitle: 'Commanding Officer',
  officeCode: 'S-3',
  byDirection: false,
  byDirectionAuthority: '',
  // Classification
  classLevel: 'unclassified',
  customClassification: '',
  pocEmail: 'john.doe@usmc.mil',
  // Hyperlinks - default to OFF (no hyperlinks)
  includeHyperlinks: false,
  // Subject underline - default to OFF
  underlineSubject: false,
  // Business letter fields
  salutation: 'Dear Sir or Madam:',
  complimentaryClose: 'Sincerely,',
};

// Example references for demo document (empty for clean start)
const EXAMPLE_REFERENCES: Reference[] = [];

// Example paragraphs for demo document (short and simple)
const EXAMPLE_PARAGRAPHS: Paragraph[] = [
  { text: '[Your content here. Click "Templates" to load a pre-built letter format.]', level: 0 },
];

// Default enclosures (empty - user adds as needed)
const DEFAULT_ENCLOSURES: Enclosure[] = [];

// Use example data as initial defaults (will be overwritten if profile is selected)
const DEFAULT_FORM_DATA = EXAMPLE_FORM_DATA;
const DEFAULT_REFERENCES = EXAMPLE_REFERENCES;
const DEFAULT_PARAGRAPHS = EXAMPLE_PARAGRAPHS;

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documentMode: 'compliant',
  documentCategory: 'correspondence',
  docType: 'naval_letter',
  formType: 'navmc_10274',
  formData: { ...DEFAULT_FORM_DATA },
  references: [...DEFAULT_REFERENCES],
  enclosures: [...DEFAULT_ENCLOSURES],
  paragraphs: [...DEFAULT_PARAGRAPHS],
  copyTos: [
    { text: 'G-3/5' },
    { text: 'G-4' },
    { text: 'Regimental S-3' },
  ],
  distributions: [],

  setDocumentCategory: (category) => {
    useUIStore.getState().setValidationVisible(false);
    set({ documentCategory: category });
  },

  setFormType: (type) => {
    useUIStore.getState().setValidationVisible(false);
    set({ formType: type });
  },

  setDocumentMode: (mode) => set((state) => {
    if (mode === 'compliant') {
      // Apply compliant formatting from doc type config
      const config = DOC_TYPE_CONFIG[state.docType] || DOC_TYPE_CONFIG.naval_letter;
      // Font size: keep current if within allowed range, otherwise snap to default
      const allowedSizes = config.regulations.fontSizeOptions || [config.regulations.fontSize];
      const currentSize = state.formData.fontSize || '12pt';
      const newFontSize = allowedSizes.includes(currentSize) ? currentSize : config.regulations.fontSize;
      // Font family: enforce if required (Ch 12 exec docs), otherwise keep user's choice
      const newFontFamily = config.regulations.fontFamilyRequired
        ? config.regulations.fontFamily
        : (state.formData.fontFamily || config.regulations.fontFamily);
      return {
        documentMode: mode,
        formData: {
          ...state.formData,
          fontSize: newFontSize,
          fontFamily: newFontFamily,
        },
      };
    }
    return { documentMode: mode };
  }),

  setDocType: (type) => {
    useUIStore.getState().setValidationVisible(false);
    set((state) => {
    const config = DOC_TYPE_CONFIG[type] || DOC_TYPE_CONFIG.naval_letter;
    // In compliant mode, always apply the regulation fonts and date format
    if (state.documentMode === 'compliant') {
      // Convert date to the appropriate format for this document type
      const newDateFormat = config.compliance.dateFormat;
      const convertedDate = state.formData.date
        ? convertDateFormat(state.formData.date, newDateFormat)
        : formatMilitaryDate(new Date());
      // Font size: keep current if within allowed range, otherwise snap to default
      const allowedSizes = config.regulations.fontSizeOptions || [config.regulations.fontSize];
      const currentSize = state.formData.fontSize || '12pt';
      const newFontSize = allowedSizes.includes(currentSize) ? currentSize : config.regulations.fontSize;
      // Font family: enforce if required (Ch 12 exec docs), otherwise keep user's choice
      const newFontFamily = config.regulations.fontFamilyRequired
        ? config.regulations.fontFamily
        : (state.formData.fontFamily || config.regulations.fontFamily);

      return {
        docType: type,
        formData: {
          ...state.formData,
          docType: type,
          fontSize: newFontSize,
          fontFamily: newFontFamily,
          date: convertedDate,
        },
        // Only endorsements continue a sequence, so switching type re-letters:
        // leaving one resets to (a), entering one applies the saved start.
        references: reLetterReferences(
          state.references,
          referenceStartIndex(type, state.formData.startingReferenceLetter)
        ),
      };
    }
    return {
      docType: type,
      formData: { ...state.formData, docType: type },
      references: reLetterReferences(
        state.references,
        referenceStartIndex(type, state.formData.startingReferenceLetter)
      ),
    };
    });
  },

  setField: (key, value) => set((state) => {
    const formData = { ...state.formData, [key]: value };
    // The start letter shifts every reference after it, so re-letter in the
    // same commit — otherwise the rows keep the previous sequence on screen.
    if (key === 'startingReferenceLetter') {
      return {
        formData,
        references: reLetterReferences(
          state.references,
          referenceStartIndex(state.docType, formData.startingReferenceLetter)
        ),
      };
    }
    return { formData };
  }),

  setFormData: (data) => set((state) => ({
    formData: { ...state.formData, ...data },
  })),

  resetForm: () => {
    useUIStore.getState().setValidationVisible(false);
    set({
    documentMode: 'compliant',
    docType: 'naval_letter',
    formData: { ...DEFAULT_FORM_DATA },
    references: [...DEFAULT_REFERENCES],
    enclosures: [...DEFAULT_ENCLOSURES],
    paragraphs: [...DEFAULT_PARAGRAPHS],
    copyTos: [
      { text: 'G-3/5' },
      { text: 'G-4' },
      { text: 'Regimental S-3' },
    ],
    distributions: [],
    });
  },

  // References
  addReference: (title, url) => set((state) => ({
    references: [
      ...state.references,
      {
        letter: getNextReferenceLetter(
          state.references,
          referenceStartIndex(state.docType, state.formData.startingReferenceLetter)
        ),
        title,
        url: url || '',
      },
    ],
  })),

  updateReference: (index, updates) => set((state) => ({
    references: state.references.map((ref, i) => (i === index ? { ...ref, ...updates } : ref)),
  })),

  removeReference: (index) => set((state) => ({
    references: reLetterReferences(
      state.references.filter((_, i) => i !== index),
      referenceStartIndex(state.docType, state.formData.startingReferenceLetter)
    ),
  })),

  reorderReferences: (fromIndex, toIndex) => set((state) => {
    const newRefs = [...state.references];
    const [moved] = newRefs.splice(fromIndex, 1);
    newRefs.splice(toIndex, 0, moved);
    return {
      references: reLetterReferences(
        newRefs,
        referenceStartIndex(state.docType, state.formData.startingReferenceLetter)
      ),
    };
  }),

  // Enclosures
  addEnclosure: (title, file, fileRef) => set((state) => ({
    enclosures: [...state.enclosures, { title, file, fileRef }],
  })),

  updateEnclosure: (index, updates) => set((state) => ({
    enclosures: state.enclosures.map((enc, i) => (i === index ? { ...enc, ...updates } : enc)),
  })),

  removeEnclosure: (index) => set((state) => ({
    enclosures: state.enclosures.filter((_, i) => i !== index),
  })),

  reorderEnclosures: (fromIndex, toIndex) => set((state) => {
    const newEncls = [...state.enclosures];
    const [moved] = newEncls.splice(fromIndex, 1);
    newEncls.splice(toIndex, 0, moved);
    return { enclosures: newEncls };
  }),

  // Paragraphs
  addParagraph: (text, level, afterIndex) => set((state) => {
    const newPara = { text, level };
    if (afterIndex !== undefined) {
      const newParas = [...state.paragraphs];
      newParas.splice(afterIndex + 1, 0, newPara);
      return { paragraphs: newParas };
    }
    return { paragraphs: [...state.paragraphs, newPara] };
  }),

  // Bulk insert (split paste): one edit, so it's a single undo step and a single
  // Recents/preview sync. Levels are normalized in case afterIndex leaves a gap.
  insertParagraphs: (afterIndex, texts, level) => set((state) => {
    if (texts.length === 0) return {};
    const newParas = [...state.paragraphs];
    newParas.splice(afterIndex + 1, 0, ...texts.map((text) => ({ text, level })));
    return { paragraphs: normalizeLevels(newParas) };
  }),

  updateParagraph: (index, updates) => set((state) => ({
    paragraphs: state.paragraphs.map((p, i) => (i === index ? { ...p, ...updates } : p)),
  })),

  // Removing a paragraph can leave a following sub-paragraph stranded too deep
  // under its new predecessor, so re-normalize the nesting after the filter.
  removeParagraph: (index) => set((state) => ({
    paragraphs: normalizeLevels(state.paragraphs.filter((_, i) => i !== index)),
  })),

  // Subtree-aware move: a paragraph travels with its sub-paragraphs so dragging
  // (or Alt+↑/↓ on) a parent never strands its children under a new parent.
  reorderParagraphs: (fromIndex, toIndex) => set((state) => {
    const paras = state.paragraphs;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 || fromIndex >= paras.length ||
      toIndex < 0 || toIndex >= paras.length
    ) {
      return {};
    }

    // The moved unit is the paragraph plus its contiguous deeper-level
    // descendants, so a parent carries its whole subtree.
    const baseLevel = paras[fromIndex].level;
    let blockEnd = fromIndex + 1;
    while (blockEnd < paras.length && paras[blockEnd].level > baseLevel) blockEnd++;

    // Keyboard "move down" on a parent targets its own first child; reinterpret
    // that as the sibling just past the whole block. Any other drop inside the
    // block is a no-op — you can't reorder a subtree into itself.
    let effTo = toIndex;
    if (toIndex >= fromIndex && toIndex < blockEnd) {
      if (blockEnd >= paras.length) return {};
      effTo = blockEnd;
    }

    const block = paras.slice(fromIndex, blockEnd);
    const rest = [...paras.slice(0, fromIndex), ...paras.slice(blockEnd)];
    const target = paras[effTo];
    const targetInRest = rest.indexOf(target);

    let insertAt: number;
    if (effTo < fromIndex) {
      // Moving up: land immediately before the target.
      insertAt = targetInRest;
    } else {
      // Moving down: land after the target and its own subtree, so the block is
      // never wedged between another parent and its children.
      let end = targetInRest + 1;
      const targetLevel = target.level;
      while (end < rest.length && rest[end].level > targetLevel) end++;
      insertAt = end;
    }

    const next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
    // Repair any illegal nesting the move exposed (e.g. a top-level block landing
    // between a parent and its children).
    return { paragraphs: normalizeLevels(next) };
  }),

  // Indent is capped one level deeper than the paragraph directly above:
  // bumping the level then normalizing makes an over-indent a no-op instead of
  // producing an illegal (but still-compiling) two-level jump.
  indentParagraph: (index) => set((state) => ({
    paragraphs: normalizeLevels(
      state.paragraphs.map((p, i) => (i === index ? { ...p, level: p.level + 1 } : p))
    ),
  })),

  // Outdenting a parent pulls its now-too-deep sub-paragraphs up with it so the
  // outline stays legal.
  outdentParagraph: (index) => set((state) => ({
    paragraphs: normalizeLevels(
      state.paragraphs.map((p, i) => (i === index ? { ...p, level: Math.max(p.level - 1, 0) } : p))
    ),
  })),

  // Copy To
  addCopyTo: (text) => set((state) => ({
    copyTos: [...state.copyTos, { text }],
  })),

  updateCopyTo: (index, text) => set((state) => ({
    copyTos: state.copyTos.map((ct, i) => (i === index ? { text } : ct)),
  })),

  removeCopyTo: (index) => set((state) => ({
    copyTos: state.copyTos.filter((_, i) => i !== index),
  })),

  // Distribution
  addDistribution: (text) => set((state) => ({
    distributions: [...state.distributions, { text }],
  })),

  updateDistribution: (index, text) => set((state) => ({
    distributions: state.distributions.map((d, i) => (i === index ? { text } : d)),
  })),

  removeDistribution: (index) => set((state) => ({
    distributions: state.distributions.filter((_, i) => i !== index),
  })),

  // Bulk Actions
  clearParagraphs: () => {
    debug.log('Store', 'Clearing all paragraphs');
    set({ paragraphs: [{ text: '', level: 0 }] });
  },

  clearReferences: () => {
    debug.log('Store', 'Clearing all references');
    set({ references: [] });
  },

  clearEnclosures: () => {
    debug.log('Store', 'Clearing all enclosures');
    set({ enclosures: [] });
  },

  clearCopyTos: () => {
    debug.log('Store', 'Clearing all copy-tos');
    set({ copyTos: [] });
  },

  clearAll: () => {
    debug.log('Store', 'Clearing all document content');
    set({
      paragraphs: [{ text: '', level: 0 }],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    });
  },

  clearFieldsExceptLetterhead: () => {
    debug.log('Store', 'Clearing all fields except letterhead');
    useUIStore.getState().setValidationVisible(false);
    set((state) => {
      // Preserve letterhead fields and font settings
      const preservedFields = {
        unitLine1: state.formData.unitLine1,
        unitLine2: state.formData.unitLine2,
        unitAddress: state.formData.unitAddress,
        department: state.formData.department,
        sealType: state.formData.sealType,
        letterheadColor: state.formData.letterheadColor,
        fontSize: state.formData.fontSize,
        fontFamily: state.formData.fontFamily,
        docType: state.formData.docType,
      };
      return {
        formData: {
          ...preservedFields,
          // Document identification - set empty strings for LaTeX compatibility
          ssic: '',
          serial: '',
          date: formatMilitaryDate(new Date()),
          // Addressing - empty strings
          from: '',
          to: '',
          via: '',
          subject: '',
          // Signature - empty strings
          sigFirst: '',
          sigMiddle: '',
          sigLast: '',
          sigRank: '',
          sigTitle: '',
          officeCode: '',
          byDirection: false,
          byDirectionAuthority: '',
          signatureType: 'none',
          signatureImage: undefined,
          // Classification
          classLevel: 'unclassified',
          customClassification: '',
          pocEmail: '',
          // Other settings
          pageNumbering: 'none',
          includeHyperlinks: false,
          underlineSubject: false,
          inReplyTo: false,
          inReplyToText: '',
          // Business letter fields
          salutation: 'Dear Sir or Madam:',
          complimentaryClose: 'Sincerely,',
          // Executive memo fields
          memorandumFor: '',
          attnLine: '',
          throughLine: '',
          coordination: '',
          preparedBy: '',
        },
        paragraphs: [{ text: '', level: 0 }],
        references: [],
        enclosures: [],
        copyTos: [],
        distributions: [],
      };
    });
  },

  loadTemplate: (data) => {
    debug.log('Store', 'Loading template', {
      paragraphs: data.paragraphs?.length,
      references: data.references?.length,
      enclosures: data.enclosures?.length,
      copyTos: data.copyTos?.length,
    });
    useUIStore.getState().setValidationVisible(false);
    set((state) => {
      const formData = data.formData ? { ...state.formData, ...data.formData } : state.formData;
      return {
        paragraphs: data.paragraphs ? migratePortionMarkings(data.paragraphs) : state.paragraphs,
        // Re-letter against the incoming start so a loaded endorsement keeps
        // the sequence it was saved with.
        references: data.references
          ? reLetterReferences(
              data.references,
              referenceStartIndex(state.docType, formData.startingReferenceLetter)
            )
          : state.references,
        enclosures: data.enclosures ?? state.enclosures,
        copyTos: data.copyTos ?? state.copyTos,
        formData,
      };
    });
  },

  // History (Undo/Redo)
  applySnapshot: (snapshot) => set((state) => {
    // Re-graft live enclosure file bytes. History snapshots omit `file` (too
    // large to keep 50 copies of), so a wholesale replace would destroy attached
    // PDFs on every undo/redo. Match same-index-same-title first, then any unused
    // same-title enclosure.
    const used = new Set<number>();
    const enclosures = snapshot.enclosures.map((e, i) => {
      if (e.file) return e;
      const cur = state.enclosures;
      const match =
        cur[i]?.title === e.title && cur[i]?.file && !used.has(i)
          ? i
          : cur.findIndex((c, j) => !used.has(j) && c.title === e.title && !!c.file);
      if (match >= 0) {
        used.add(match);
        return { ...e, file: cur[match].file };
      }
      return e;
    });
    return {
      documentMode: snapshot.documentMode,
      docType: snapshot.docType,
      formData: snapshot.formData,
      references: snapshot.references,
      enclosures,
      paragraphs: snapshot.paragraphs,
      copyTos: snapshot.copyTos,
      distributions: snapshot.distributions || [],
    };
  }),

  getSnapshot: (): DocumentSnapshot => {
    const state = get();
    return {
      documentMode: state.documentMode,
      docType: state.docType,
      formData: state.formData,
      references: state.references,
      enclosures: state.enclosures,
      paragraphs: state.paragraphs,
      copyTos: state.copyTos,
      distributions: state.distributions,
    };
  },
}));

// Subscribe to document changes and save snapshots
// Debounce to avoid saving on every keystroke
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionSaveTimeout: ReturnType<typeof setTimeout> | null = null;

// While the session-restore prompt is on screen, mount-time store writes would
// autosave over the session the user is about to restore. restoreSession()
// re-reads localStorage at click time, so saves are suspended until they decide.
let sessionSavesSuspended = false;
export function suspendSessionSaves(): void {
  sessionSavesSuspended = true;
}
export function resumeSessionSaves(): void {
  sessionSavesSuspended = false;
}

useDocumentStore.subscribe((state: DocumentState) => {
  // Debounce snapshot saving
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    try {
      const snapshot: DocumentSnapshot = {
        documentMode: state.documentMode,
        docType: state.docType,
        formData: state.formData,
        references: state.references,
        enclosures: state.enclosures,
        paragraphs: state.paragraphs,
        copyTos: state.copyTos,
        distributions: state.distributions,
      };
      useHistoryStore.getState().saveSnapshot(snapshot);
      debug.log('Store', 'Snapshot saved to history');
    } catch (err) {
      debug.error('Store', 'Failed to save snapshot to history', err);
    }
  }, TIMING.HISTORY_SNAPSHOT_DEBOUNCE);

  // Also persist to localStorage for session restore (debounced more). Skipped
  // while suspended; see suspendSessionSaves for the race this prevents.
  if (sessionSaveTimeout) {
    clearTimeout(sessionSaveTimeout);
  }

  if (!sessionSavesSuspended) {
    sessionSaveTimeout = setTimeout(() => {
      if (!sessionSavesSuspended) saveSessionToStorage(state);
    }, 2000); // 2 second debounce for localStorage
  }
});

// Flush the pending debounced session save when the page is hidden or unloaded so
// the last edits aren't lost. localStorage.setItem is synchronous, so it commits
// before teardown. No-op if the debounce already fired.
function flushSessionSave(): void {
  if (sessionSaveTimeout && !sessionSavesSuspended) {
    clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = null;
    saveSessionToStorage(useDocumentStore.getState());
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSessionSave();
  });
  window.addEventListener('pagehide', flushSessionSave);
}

/**
 * Saves the current document state to localStorage for session restore.
 * Excludes non-serializable data like file ArrayBuffers.
 */
function saveSessionToStorage(state: DocumentState): void {
  try {
    // Create serializable session (excluding file data)
    const session: SerializedSession = {
      documentMode: state.documentMode,
      documentCategory: state.documentCategory,
      docType: state.docType,
      formType: state.formType,
      formData: {
        ...state.formData,
        // Exclude signature image from session storage
        signatureImage: undefined,
      },
      references: state.references,
      enclosures: state.enclosures.map(enc => ({
        title: enc.title,
        pageStyle: enc.pageStyle,
        hasCoverPage: enc.hasCoverPage,
        coverPageDescription: enc.coverPageDescription,
        hasFile: !!enc.file,
        fileRef: enc.fileRef,
      })),
      paragraphs: state.paragraphs,
      copyTos: state.copyTos,
      distributions: state.distributions,
      timestamp: Date.now(),
    };

    // Compressed write, prefixed so the read path can tell it from legacy
    // plain-JSON sessions.
    localStorage.setItem(SESSION_STORAGE_KEY, compressedStringify(session));
    localStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
    debug.log('Store', 'Session saved to localStorage');
  } catch (err) {
    debug.error('Store', 'Failed to save session to localStorage', err);
  }
}

/**
 * Checks if there's a valid saved session that can be restored.
 */
export function hasSavedSession(): boolean {
  try {
    const sessionData = localStorage.getItem(SESSION_STORAGE_KEY);
    const timestamp = localStorage.getItem(SESSION_TIMESTAMP_KEY);

    if (!sessionData || !timestamp) {
      return false;
    }

    // Check if session is too old
    const sessionAge = Date.now() - parseInt(timestamp, 10);
    if (sessionAge > SESSION_MAX_AGE) {
      // Clear old session
      clearSavedSession();
      return false;
    }

    // compressedParse handles both the gz:-prefixed compressed form and legacy
    // plain-JSON sessions.
    const session = compressedParse<SerializedSession>(sessionData);

    // Meaningful content, not just default empty state.
    const hasContent =
      (session.paragraphs && session.paragraphs.length > 0 && session.paragraphs.some(p => p.text.trim() !== '')) ||
      (session.references && session.references.length > 0) ||
      (session.formData?.subject && session.formData.subject.trim() !== '');

    return !!hasContent;
  } catch {
    return false;
  }
}

/**
 * Gets the saved session data.
 */
export function getSavedSession(): SerializedSession | null {
  try {
    const sessionData = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionData) return null;
    return compressedParse<SerializedSession>(sessionData);
  } catch {
    return null;
  }
}

/**
 * Restores a saved session to the document store.
 */
export function restoreSession(): boolean {
  try {
    const session = getSavedSession();
    if (!session) return false;

    // Canonicalize unitAddress on read so legacy sessions with the 1-comma form
    // "STREET, CITY STATE ZIP" render correctly on the letterhead.
    const restoredFormData = session.formData?.unitAddress
      ? { ...session.formData, unitAddress: canonicalizeUnitAddress(session.formData.unitAddress) }
      : session.formData;

    useDocumentStore.setState({
      documentMode: session.documentMode,
      documentCategory: session.documentCategory || 'correspondence',
      docType: session.docType,
      formType: session.formType || 'navmc_10274',
      formData: restoredFormData,
      references: session.references,
      enclosures: session.enclosures.map(enc => ({
        title: enc.title,
        pageStyle: enc.pageStyle,
        hasCoverPage: enc.hasCoverPage,
        coverPageDescription: enc.coverPageDescription,
        fileRef: enc.fileRef,
        // Bytes are streamed back in asynchronously below (rehydrateEnclosureFiles).
        file: undefined,
      })),
      paragraphs: migratePortionMarkings(session.paragraphs),
      copyTos: session.copyTos,
      distributions: session.distributions || [],
    });

    void rehydrateEnclosureFiles();
    debug.log('Store', 'Session restored from localStorage');
    return true;
  } catch (err) {
    debug.error('Store', 'Failed to restore session', err);
    return false;
  }
}

/**
 * Returns the current document state as a serializable session for sharing.
 * Excludes file data and signature images.
 */
export function getSerializedSessionForShare(): SerializedSession {
  return serializeSession(useDocumentStore.getState());
}

/**
 * Serializes a given document state (not necessarily the live one) into a
 * shareable session, so the registry can snapshot a previous state, e.g. to
 * preserve a correspondence document the instant the user flips to the Forms tab.
 */
export function serializeSession(state: DocumentState): SerializedSession {
  return {
    documentMode: state.documentMode,
    documentCategory: state.documentCategory,
    docType: state.docType,
    formType: state.formType,
    formData: {
      ...state.formData,
      signatureImage: undefined,
      // Bytes live in the attachments store; keep only basicLetterFileRef so the
      // serialized session stays light and JSON-safe (rehydrated on load).
      basicLetterFile: undefined,
    },
    references: state.references,
    enclosures: state.enclosures.map(enc => ({
      title: enc.title,
      pageStyle: enc.pageStyle,
      hasCoverPage: enc.hasCoverPage,
      coverPageDescription: enc.coverPageDescription,
      hasFile: !!enc.file,
      fileRef: enc.fileRef,
    })),
    paragraphs: state.paragraphs,
    copyTos: state.copyTos,
    distributions: state.distributions,
    timestamp: Date.now(),
  };
}

/**
 * Applies a shared-session payload (e.g. from a decrypted share link) to the document store.
 * Enclosure file data is not included in shares; titles and metadata are restored.
 */
export function loadSharedSession(session: SerializedSession): void {
  // Canonicalize unitAddress on read (see restoreSession for rationale).
  const sharedFormData = session.formData?.unitAddress
    ? { ...session.formData, unitAddress: canonicalizeUnitAddress(session.formData.unitAddress) }
    : (session.formData ?? {});

  useDocumentStore.setState({
    documentMode: session.documentMode,
    documentCategory: session.documentCategory ?? 'correspondence',
    docType: session.docType,
    formType: session.formType ?? 'navmc_10274',
    formData: sharedFormData,
    references: session.references ?? [],
    enclosures: (session.enclosures ?? []).map(enc => ({
      title: enc.title,
      pageStyle: enc.pageStyle,
      hasCoverPage: enc.hasCoverPage,
      coverPageDescription: enc.coverPageDescription,
      fileRef: enc.fileRef,
      // Bytes are streamed back in asynchronously below (rehydrateEnclosureFiles).
      file: undefined,
    })),
    paragraphs: migratePortionMarkings(session.paragraphs ?? []),
    copyTos: session.copyTos ?? [],
    distributions: session.distributions ?? [],
  });
  void rehydrateEnclosureFiles();
  debug.log('Store', 'Shared session applied');
}

/**
 * Streams persisted enclosure bytes back into the live document. A restored
 * session carries a `fileRef` per attached enclosure but no `file` (the bytes
 * live in the IndexedDB attachments store, not the session JSON); this fetches
 * each and grafts it back in.
 *
 * Matched by `fileRef.id`, never by index, and only fills an enclosure whose
 * `file` is still empty — so a user who edited/reordered/removed enclosures
 * between load and hydrate is never clobbered. Fully best-effort: any failure is
 * swallowed, leaving the enclosure in the pre-existing "re-attach" state.
 *
 * Returns once every referenced blob has been resolved, so callers that must
 * export (which reads `file.data`) can await a complete document.
 */
export async function rehydrateEnclosureFiles(): Promise<void> {
  // The endorsement's basic-letter PDF is stored the same way as an enclosure
  // file (bytes in the attachments store, only the ref serialized), so reload it
  // here too. Done first, before the enclosure early-return, so a basic letter
  // is rehydrated even on an endorsement that has no enclosures.
  const blRef = useDocumentStore.getState().formData.basicLetterFileRef;
  if (blRef && !useDocumentStore.getState().formData.basicLetterFile) {
    try {
      const data = await loadAttachment(blRef.id);
      if (data && !useDocumentStore.getState().formData.basicLetterFile) {
        useDocumentStore.setState((state) => ({
          formData: {
            ...state.formData,
            basicLetterFile: { name: blRef.name, size: blRef.size || data.byteLength, data },
          },
        }));
      }
    } catch (err) {
      debug.error('Store', 'Failed to rehydrate basic-letter file', err);
    }
  }

  const pending = useDocumentStore
    .getState()
    .enclosures.filter((e) => e.fileRef && !e.file)
    .map((e) => e.fileRef!.id);
  if (pending.length === 0) return;

  const wanted = new Set(pending);
  const loaded = new Map<string, { name: string; size: number; data: ArrayBuffer }>();
  await Promise.all(
    [...wanted].map(async (id) => {
      try {
        const data = await loadAttachment(id);
        if (data) {
          // Prefer the ref's own name/size (survives even if two enclosures share bytes).
          const ref = useDocumentStore.getState().enclosures.find((e) => e.fileRef?.id === id)?.fileRef;
          loaded.set(id, { name: ref?.name ?? '', size: ref?.size ?? data.byteLength, data });
        }
      } catch (err) {
        debug.error('Store', 'Failed to rehydrate enclosure file', err);
      }
    })
  );
  if (loaded.size === 0) return;

  useDocumentStore.setState((state) => ({
    enclosures: state.enclosures.map((e) => {
      if (e.file || !e.fileRef) return e; // don't overwrite live edits
      const got = loaded.get(e.fileRef.id);
      return got ? { ...e, file: got } : e;
    }),
  }));
  debug.log('Store', 'Enclosure files rehydrated', { count: loaded.size });
}

/**
 * Persists any enclosure that carries live bytes but no durable `fileRef` — the
 * case for a draft imported from JSON, whose file bytes arrived inline. Gives
 * each a `fileRef` so it survives a reload and rides along in a full backup,
 * matching the persist-on-attach path. Matched by array index against the live
 * state at write time so an intervening edit is never clobbered.
 */
export async function persistUnsavedEnclosures(): Promise<void> {
  const snapshot = useDocumentStore.getState().enclosures;
  const work = snapshot
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.file && !e.fileRef);
  if (work.length === 0) return;

  for (const { e, index } of work) {
    if (!e.file) continue;
    try {
      const ref = await persistAttachment(
        { name: e.file.name, size: e.file.size, type: '' },
        e.file.data
      );
      useDocumentStore.setState((state) => {
        const cur = state.enclosures[index];
        // Only stamp the ref if this slot still holds the same, still-unref'd file.
        if (!cur?.file || cur.fileRef || cur.file !== e.file) return {};
        const enclosures = state.enclosures.slice();
        enclosures[index] = { ...cur, fileRef: ref };
        return { enclosures };
      });
    } catch (err) {
      debug.error('Store', 'Failed to persist imported enclosure', err);
    }
  }
}

/**
 * Clears the saved session from localStorage.
 */
export function clearSavedSession(): void {
  // Guarded like every sibling helper: with site data blocked, removeItem
  // throws SecurityError — and this runs mid-delete (reopenAfterRemoval),
  // where an escaped throw would strand the store half-deleted.
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(SESSION_TIMESTAMP_KEY);
  } catch {
    return;
  }
  debug.log('Store', 'Saved session cleared');
}

/**
 * Gets a human-readable description of when the session was saved.
 */
export function getSessionAge(): string {
  try {
    const timestamp = localStorage.getItem(SESSION_TIMESTAMP_KEY);
    if (!timestamp) return '';

    const age = Date.now() - parseInt(timestamp, 10);
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);
    const days = Math.floor(age / 86400000);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  } catch {
    return '';
  }
}
