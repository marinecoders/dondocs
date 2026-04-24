import { create } from 'zustand';
import { format, parse, isValid } from 'date-fns';
import type { Reference, Enclosure, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode, DocumentCategory, FormType } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useHistoryStore } from './historyStore';
import type { DocumentSnapshot } from './historyStore';
import { debug } from '@/lib/debug';
import { TIMING } from '@/lib/constants';
import { compressedParse, compressedStringify } from '@/lib/compressedStorage';

// Session persistence keys
const SESSION_STORAGE_KEY = 'dondocs-document-session';
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
  enclosures: Array<Omit<Enclosure, 'file'> & { hasFile?: boolean }>;
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

interface DocumentState {
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
  addEnclosure: (title: string, file?: Enclosure['file']) => void;
  updateEnclosure: (index: number, updates: Partial<Enclosure>) => void;
  removeEnclosure: (index: number) => void;
  reorderEnclosures: (fromIndex: number, toIndex: number) => void;

  // Actions - Paragraphs
  addParagraph: (text: string, level: number, afterIndex?: number) => void;
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

const getNextReferenceLetter = (refs: Reference[]): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  return alphabet[refs.length] || `a${refs.length - 26}`;
};

const reLetterReferences = (refs: Reference[]): Reference[] => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  return refs.map((ref, index) => ({
    ...ref,
    letter: alphabet[index] || `a${index - 26}`,
  }));
};

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

  setDocumentCategory: (category) => set({ documentCategory: category }),

  setFormType: (type) => set({ formType: type }),

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

  setDocType: (type) => set((state) => {
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
      };
    }
    return { docType: type, formData: { ...state.formData, docType: type } };
  }),

  setField: (key, value) => set((state) => ({
    formData: { ...state.formData, [key]: value },
  })),

  setFormData: (data) => set((state) => ({
    formData: { ...state.formData, ...data },
  })),

  resetForm: () => set({
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
  }),

  // References
  addReference: (title, url) => set((state) => ({
    references: [
      ...state.references,
      { letter: getNextReferenceLetter(state.references), title, url: url || '' },
    ],
  })),

  updateReference: (index, updates) => set((state) => ({
    references: state.references.map((ref, i) => (i === index ? { ...ref, ...updates } : ref)),
  })),

  removeReference: (index) => set((state) => ({
    references: reLetterReferences(state.references.filter((_, i) => i !== index)),
  })),

  reorderReferences: (fromIndex, toIndex) => set((state) => {
    const newRefs = [...state.references];
    const [moved] = newRefs.splice(fromIndex, 1);
    newRefs.splice(toIndex, 0, moved);
    return { references: reLetterReferences(newRefs) };
  }),

  // Enclosures
  addEnclosure: (title, file) => set((state) => ({
    enclosures: [...state.enclosures, { title, file }],
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

  updateParagraph: (index, updates) => set((state) => ({
    paragraphs: state.paragraphs.map((p, i) => (i === index ? { ...p, ...updates } : p)),
  })),

  removeParagraph: (index) => set((state) => ({
    paragraphs: state.paragraphs.filter((_, i) => i !== index),
  })),

  reorderParagraphs: (fromIndex, toIndex) => set((state) => {
    const newParas = [...state.paragraphs];
    const [moved] = newParas.splice(fromIndex, 1);
    newParas.splice(toIndex, 0, moved);
    return { paragraphs: newParas };
  }),

  indentParagraph: (index) => set((state) => ({
    paragraphs: state.paragraphs.map((p, i) =>
      i === index ? { ...p, level: Math.min(p.level + 1, 7) } : p
    ),
  })),

  outdentParagraph: (index) => set((state) => ({
    paragraphs: state.paragraphs.map((p, i) =>
      i === index ? { ...p, level: Math.max(p.level - 1, 0) } : p
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
    set((state) => ({
      paragraphs: data.paragraphs ?? state.paragraphs,
      references: data.references ? reLetterReferences(data.references) : state.references,
      enclosures: data.enclosures ?? state.enclosures,
      copyTos: data.copyTos ?? state.copyTos,
      formData: data.formData ? { ...state.formData, ...data.formData } : state.formData,
    }));
  },

  // History (Undo/Redo)
  applySnapshot: (snapshot) => set({
    documentMode: snapshot.documentMode,
    docType: snapshot.docType,
    formData: snapshot.formData,
    references: snapshot.references,
    enclosures: snapshot.enclosures,
    paragraphs: snapshot.paragraphs,
    copyTos: snapshot.copyTos,
    distributions: snapshot.distributions || [],
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

  // Also persist to localStorage for session restore (debounced more)
  if (sessionSaveTimeout) {
    clearTimeout(sessionSaveTimeout);
  }

  sessionSaveTimeout = setTimeout(() => {
    saveSessionToStorage(state);
  }, 2000); // 2 second debounce for localStorage
});

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
      })),
      paragraphs: state.paragraphs,
      copyTos: state.copyTos,
      distributions: state.distributions,
      timestamp: Date.now(),
    };

    // Compressed write — pako.deflate + base64, prefixed so the read path
    // can distinguish it from legacy plain-JSON sessions. Typical shrink
    // is ~2–3× after base64 expansion, which keeps us well below the
    // per-origin localStorage quota as documents grow.
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

    // Validate session data. compressedParse handles both the new gz:-
    // prefixed compressed form and legacy plain-JSON sessions that were
    // written before compression was enabled.
    const session = compressedParse<SerializedSession>(sessionData);

    // Check if it has meaningful content (not just default empty state)
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

    useDocumentStore.setState({
      documentMode: session.documentMode,
      documentCategory: session.documentCategory || 'correspondence',
      docType: session.docType,
      formType: session.formType || 'navmc_10274',
      formData: session.formData,
      references: session.references,
      enclosures: session.enclosures.map(enc => ({
        title: enc.title,
        pageStyle: enc.pageStyle,
        hasCoverPage: enc.hasCoverPage,
        coverPageDescription: enc.coverPageDescription,
        // File data is not restored - user will need to re-attach
        file: undefined,
      })),
      paragraphs: session.paragraphs,
      copyTos: session.copyTos,
      distributions: session.distributions || [],
    });

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
  const state = useDocumentStore.getState();
  return {
    documentMode: state.documentMode,
    documentCategory: state.documentCategory,
    docType: state.docType,
    formType: state.formType,
    formData: {
      ...state.formData,
      signatureImage: undefined,
    },
    references: state.references,
    enclosures: state.enclosures.map(enc => ({
      title: enc.title,
      pageStyle: enc.pageStyle,
      hasCoverPage: enc.hasCoverPage,
      coverPageDescription: enc.coverPageDescription,
      hasFile: !!enc.file,
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
  useDocumentStore.setState({
    documentMode: session.documentMode,
    documentCategory: session.documentCategory ?? 'correspondence',
    docType: session.docType,
    formType: session.formType ?? 'navmc_10274',
    formData: session.formData ?? {},
    references: session.references ?? [],
    enclosures: (session.enclosures ?? []).map(enc => ({
      title: enc.title,
      pageStyle: enc.pageStyle,
      hasCoverPage: enc.hasCoverPage,
      coverPageDescription: enc.coverPageDescription,
      file: undefined,
    })),
    paragraphs: session.paragraphs ?? [],
    copyTos: session.copyTos ?? [],
    distributions: session.distributions ?? [],
  });
  debug.log('Store', 'Shared session applied');
}

/**
 * Clears the saved session from localStorage.
 */
export function clearSavedSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(SESSION_TIMESTAMP_KEY);
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
