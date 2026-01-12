import { create } from 'zustand';
import { format } from 'date-fns';
import type { Reference, Enclosure, Paragraph, CopyTo, DocumentData, DocumentMode } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useHistoryStore } from './historyStore';
import type { DocumentSnapshot } from './historyStore';
import { debug } from '@/lib/debug';
import { TIMING } from '@/lib/constants';

// Military date format per SECNAV M-5216.5: "4 Jan 26" (day month 2-digit year)
const formatMilitaryDate = (date: Date): string => format(date, 'd MMM yy');

interface DocumentState {
  // Document data
  documentMode: DocumentMode;
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];

  // Actions - Form
  setDocumentMode: (mode: DocumentMode) => void;
  setDocType: (type: string) => void;
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

  // Bulk Actions
  clearParagraphs: () => void;
  clearReferences: () => void;
  clearEnclosures: () => void;
  clearCopyTos: () => void;
  clearAll: () => void;
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

const DEFAULT_FORM_DATA: Partial<DocumentData> = {
  docType: 'naval_letter',
  fontSize: '12pt',
  fontFamily: 'courier',
  pageNumbering: 'none',
  // Letterhead - Example unit info
  unitLine1: '1ST BATTALION, 6TH MARINES',
  unitLine2: '2D MARINE DIVISION, II MEF',
  unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
  sealType: 'dod',
  // Document identification
  ssic: '3502',
  serial: '0847',
  date: formatMilitaryDate(new Date()),
  // Addressing
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  to: 'Commanding General, 2d Marine Division',
  via: 'Commanding Officer, 6th Marine Regiment',
  subject: 'AFTER ACTION REPORT FOR EXERCISE STEEL KNIGHT 25-1',
  // Signature
  sigFirst: 'John',
  sigMiddle: 'A',
  sigLast: 'DOE',
  sigRank: 'Lieutenant Colonel',
  sigTitle: 'Commanding Officer',
  officeCode: 'S-3',
  byDirection: true,
  byDirectionAuthority: 'J. A. DOE',
  // Classification
  classLevel: 'unclassified',
  pocEmail: 'john.doe@usmc.mil',
  // Hyperlinks - default to OFF (no hyperlinks)
  includeHyperlinks: false,
};

// Default references for example document
const DEFAULT_REFERENCES: Reference[] = [
  { letter: 'a', title: 'MCO 3502.6A', url: '' },
  { letter: 'b', title: 'MCRP 3-30B.1 Ground Combat Operations', url: '' },
  { letter: 'c', title: '2d MarDiv FRAGO 25-0147 dtd 15 Nov 25', url: '' },
  { letter: 'd', title: 'MCO 3500.27C', url: '' },
];

// Default enclosures for example document (empty - user adds as needed)
const DEFAULT_ENCLOSURES: Enclosure[] = [];

// Default paragraphs for example document (two pages of content)
const DEFAULT_PARAGRAPHS: Paragraph[] = [
  { text: 'Purpose. Per reference (a), this letter provides the after action report for Exercise Steel Knight 25-1, conducted 3-17 December 2025 at Camp Lejeune.', level: 0 },
  { text: 'Background. Exercise Steel Knight 25-1 was a battalion-level combined arms exercise to validate combat readiness of 1st Battalion, 6th Marines per reference (b).', level: 0 },
  { text: 'Execution Summary. The exercise was executed in three phases:', level: 0 },
  { text: 'Phase I (3-6 Dec): Pre-deployment preparation. All companies completed certifications including weapons qualification and communications checks.', level: 1 },
  { text: 'Phase II (7-12 Dec): Force-on-force operations against 2d LAR Battalion. Key events included battalion attack, deliberate defense, and 48-hour sustained ops.', level: 1 },
  { text: 'Phase III (13-17 Dec): Live-fire combined arms training at Range G-10 with mortars, artillery, and close air support.', level: 1 },
  { text: 'Assessment. 1st Battalion, 6th Marines demonstrated high tactical proficiency and combat readiness:', level: 0 },
  { text: 'Tactical Proficiency. Excellent small unit tactics and fire team coordination. Squad leaders showed marked improvement under combat stress.', level: 1 },
  { text: 'Command and Control. Effective communications maintained throughout. TOC successfully tracked all elements during sustained operations.', level: 1 },
  { text: 'Areas for Improvement:', level: 0 },
  { text: 'Night Operations. Several squads had difficulty maintaining dispersion during limited visibility. Recommend emphasis on night land navigation.', level: 1 },
  { text: 'Recommendation. 1st Battalion, 6th Marines is assessed combat ready. Recommend certification for deployment per reference (d).', level: 0 },
  { text: 'Point of Contact. POC is the undersigned or Major J.Q. Smith, S-3, at (910) 451-0001.', level: 0 },
];

export const useDocumentStore = create<DocumentState>((set, get) => ({
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

  setDocumentMode: (mode) => set((state) => {
    if (mode === 'compliant') {
      // Apply compliant formatting from doc type config
      const config = DOC_TYPE_CONFIG[state.docType] || DOC_TYPE_CONFIG.naval_letter;
      return {
        documentMode: mode,
        formData: {
          ...state.formData,
          fontSize: config.regulations.fontSize,
          fontFamily: config.regulations.fontFamily,
        },
      };
    }
    return { documentMode: mode };
  }),

  setDocType: (type) => set((state) => {
    const config = DOC_TYPE_CONFIG[type] || DOC_TYPE_CONFIG.naval_letter;
    // In compliant mode, always apply the regulation fonts
    if (state.documentMode === 'compliant') {
      return {
        docType: type,
        formData: {
          ...DEFAULT_FORM_DATA,
          docType: type,
          fontSize: config.regulations.fontSize,
          fontFamily: config.regulations.fontFamily,
        },
      };
    }
    return { docType: type, formData: { ...DEFAULT_FORM_DATA, docType: type } };
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
    };
  },
}));

// Subscribe to document changes and save snapshots
// Debounce to avoid saving on every keystroke
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

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
      };
      useHistoryStore.getState().saveSnapshot(snapshot);
      debug.log('Store', 'Snapshot saved to history');
    } catch (err) {
      debug.error('Store', 'Failed to save snapshot to history', err);
    }
  }, TIMING.HISTORY_SNAPSHOT_DEBOUNCE);
});
