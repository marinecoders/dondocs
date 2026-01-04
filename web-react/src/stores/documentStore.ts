import { create } from 'zustand';
import type { Reference, Enclosure, Paragraph, CopyTo, DocumentData, DocumentMode } from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';

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
  ssic: '5216',
  serial: '001',
  date: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
  // Addressing
  from: 'Commanding Officer, 1st Battalion, 6th Marines',
  to: 'Commanding General, 2d Marine Division',
  via: '',
  subject: 'SAMPLE NAVAL LETTER FOR DEMONSTRATION',
  // Signature
  sigFirst: 'John',
  sigMiddle: 'M',
  sigLast: 'DOE',
  sigRank: 'Lieutenant Colonel',
  sigTitle: 'Commanding Officer',
  byDirection: false,
  byDirectionAuthority: '',
  // Classification
  classLevel: 'unclassified',
  pocEmail: 'john.doe@usmc.mil',
  // Hyperlinks - default to OFF (no hyperlinks)
  includeHyperlinks: false,
};

export const useDocumentStore = create<DocumentState>((set) => ({
  documentMode: 'compliant',
  docType: 'naval_letter',
  formData: { ...DEFAULT_FORM_DATA },
  references: [],
  enclosures: [],
  paragraphs: [
    { text: 'This is a sample naval letter demonstrating the LIBO-SECURED correspondence generator. The system generates properly formatted military correspondence in accordance with SECNAV M-5216.5 (DON Correspondence Manual).', level: 0 },
    { text: 'The letter format includes all required elements such as letterhead, SSIC, serial number, date, From/To/Via addressing, subject line, and signature block.', level: 0 },
  ],
  copyTos: [],

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
    references: [],
    enclosures: [],
    paragraphs: [{ text: '', level: 0 }],
    copyTos: [],
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
}));
