import { hasReviewComments, type ReviewComments } from '@/lib/reviewComments';
import { persistSignature, resolveSignature } from '@/lib/signatureAssets';
import { withAttachmentStaging } from '@/lib/attachments';
import { projectSharedSession, serializeDocumentSnapshot } from '@/lib/documentSerialization';
import { manualFrontMatterSchema } from '@/data/techpub/manualFrontMatter';
import { sl4Schema } from '@/data/techpub/sl4';
import { sl3Schema } from '@/data/techpub/sl3';
import { type FormInstance } from '@/services/forms/model';
import { withoutTableFootnote } from '@/lib/tableFootnotes';
import { create } from 'zustand';
import { parseSavedSession } from '@/lib/savedSession';
import { supportsReviewComments } from '@/lib/reviewCommentTargets';
import { format, parse, isValid } from 'date-fns';
import type { Reference, Enclosure, FileRef, Paragraph, CopyTo, Distribution, DocumentData, DocumentMode, DocumentCategory, FormType,
  EndItem, PublicationTableRow,
} from '@/types/document';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { loadAttachment, persistAttachment } from '@/lib/attachments';
import { useHistoryStore } from './historyStore';
import type { DocumentSnapshot } from './historyStore';
import { useUIStore } from './uiStore';
import { debug } from '@/lib/debug';
import { STORAGE_KEYS} from '@/lib/constants';
import { compressedParse, compressedStringify } from '@/lib/compressedStorage';
import { referenceStartIndex } from '@/lib/endorsement';
import { referenceLetterAt, reLetterReferences } from '@/lib/referenceLetters';
import { canTrackReferenceCitations, planReferenceChange, type ReferenceChange } from '@/lib/referenceCitations';
import { showAppAlert } from './alertStore';
import { canonicalizeUnitAddress } from '@/lib/unitAddress';
import { normalizeLevels, migratePortionMarkings } from '@/lib/paragraphUtils';
import { ensureParagraphIds, freshParagraphs, newParagraphId, paragraphCommentIds } from '@/lib/paragraphIdentity';
import { serializeForm, loadFormSession, prepareFormSession, type FormSession } from './formStore';

export { referenceLetterAt } from '@/lib/referenceLetters';

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
  genericForm?: FormInstance;
  formData: Partial<DocumentData>;
  reviewComments?: ReviewComments;
  references: Reference[];
  endItems?: EndItem[];
  publicationTables?: Record<string, PublicationTableRow[]>;
  // `file` bytes live in the attachments store; `fileRef` is the durable handle
  // that rehydrates them on load. `hasFile` stays for legacy sessions written
  // before fileRef existed (they had bytes in memory but nothing to recover).
  enclosures: Array<Omit<Enclosure, 'file'> & { hasFile?: boolean; fileRef?: FileRef }>;
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
  timestamp: number;
  forms?: FormSession;
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
  genericForm?: FormInstance;
  formData: Partial<DocumentData>;
  reviewComments?: ReviewComments;
  references: Reference[];
  endItems: EndItem[];
  publicationTables: Record<string, PublicationTableRow[]>;
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

  // Actions - Publication tables and end items
  addTableRow: (tableKey: string) => void;
  updateTableRow: (tableKey: string, index: number, values: Record<string, string>) => void;
  removeTableRow: (tableKey: string, index: number) => void;
  setTableRowDetails: (tableKey: string, index: number, details: Pick<PublicationTableRow, 'identificationException' | 'openPurchase'>) => void;
  setTableRowLevel: (tableKey: string, index: number, level: number) => void;
  addEndItem: () => void;
  updateEndItem: (index: number, updates: Partial<EndItem>) => void;
  removeEndItem: (index: number) => void;

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
  removeTableFootnote: (index: number, noteIndex: number) => void;
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
  applySnapshot: (snapshot: DocumentSnapshot, owns?: () => boolean) => void;
  getSnapshot: () => DocumentSnapshot;
}

// `offset` shifts the sequence so an endorsement can continue the basic
// letter's lettering (Ch 9 ¶3) — it is 0 for every non-endorsement.
const getNextReferenceLetter = (refs: Reference[], offset = 0): string =>
  referenceLetterAt(refs.length + offset);

function safeReferencePatch(plan: ReferenceChange): Partial<DocumentState> | null {
  if (plan.blockers.length || plan.advisories.length) {
    showAppAlert({ title: 'Review reference citations', message: [...plan.blockers, ...plan.advisories].join('\n\n') });
    return null;
  }
  return plan.patch;
}

// Example form data for first-time visitors (one-time mode / no profile selected)
const EXAMPLE_FORM_DATA: Partial<DocumentData> = {
  docType: 'naval_letter',
  fontSize: '12pt',
  fontFamily: 'times',
  pageNumbering: 'simple',
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
  acting: false,
  actingTitle: '',
  seniorActing: false,
  juniorActing: false,
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
  includeEndorsementSubject: false,
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

function publicationFont(docType: string, mode: DocumentMode, data: Partial<DocumentData>): Partial<DocumentData> {
  if (data.manualFrontMatter !== undefined) data = { ...data, manualFrontMatter: manualFrontMatterSchema.parse(data.manualFrontMatter) };
  if (docType === 'tm_ietm_front_matter') return { ...data, fontFamily: 'times', fontSize: '10pt', signatureType: 'digital' };
  if (data.sl3 !== undefined) data = { ...data, sl3: sl3Schema.parse(data.sl3) };
  if (data.sl4 !== undefined) data = { ...data, sl4: sl4Schema.parse(data.sl4) };
  return (['i_type', 'sl3', 'sl4'].includes(docType)) && mode === 'compliant'
    ? { ...data, fontFamily: 'times', fontSize: ['sl3', 'sl4'].includes(docType) ? '10pt' : '12pt' } : data;
}

function documentTypeState(state: Pick<DocumentState, 'documentMode' | 'formData' | 'references'>, type: string) {
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
          ...(type === 'tm_ietm_front_matter' ? { signatureType: 'digital' as const } : {}),
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
      formData: publicationFont(type, state.documentMode, { ...state.formData, docType: type }),
      references: reLetterReferences(
        state.references,
        referenceStartIndex(type, state.formData.startingReferenceLetter)
      ),
    };
}

const enclosureResources = new WeakMap<Enclosure, object>();
const hydratedFiles = new WeakMap<NonNullable<Enclosure['file']>, FileRef>();

/** Identify bytes materialized from this exact saved handle. */
export function isHydratedFile(file: Enclosure['file'], reference: FileRef | undefined): boolean {
  return !!file && !!reference && hydratedFiles.get(file) === reference;
}

/** A row keeps its upload target across title and layout edits, but not file replacement. */
export function enclosureResource(enclosure: Enclosure): object {
  let resource = enclosureResources.get(enclosure);
  if (!resource) {
    resource = {};
    enclosureResources.set(enclosure, resource);
  }
  return resource;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documentMode: 'compliant',
  documentCategory: 'correspondence',
  docType: 'naval_letter',
  formType: 'navmc_10274',
  genericForm: undefined,
  formData: { ...DEFAULT_FORM_DATA },
  references: [...DEFAULT_REFERENCES],
  endItems: [],
  publicationTables: {},
  enclosures: [...DEFAULT_ENCLOSURES],
  paragraphs: freshParagraphs(DEFAULT_PARAGRAPHS),
  copyTos: [
    { text: 'G-3/5' },
    { text: 'G-4' },
    { text: 'Regimental S-3' },
  ],
  distributions: [],

  setDocumentCategory: (category) => {
    useUIStore.getState().setValidationVisible(false);
    const leavingForm = get().genericForm && category !== 'forms';
    set(state => ({ documentCategory: category, genericForm: leavingForm ? undefined : state.genericForm }));
    if (leavingForm) resetDocumentHistory();
  },

  setFormType: (type) => {
    useUIStore.getState().setValidationVisible(false);
    const activeForm = get().genericForm;
    const leavingForm = activeForm && activeForm.definition.formId !== type;
    set(state => ({ formType: type, genericForm: leavingForm ? undefined : state.genericForm }));
    if (leavingForm) resetDocumentHistory();
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
          ...(state.docType === 'tm_ietm_front_matter' ? { signatureType: 'digital' as const } : {}),
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
      const plan = planReferenceChange(state, state.references.map((_, index) => index),
        referenceStartIndex(type, state.formData.startingReferenceLetter));
      // Publication citation syntax is opaque to ordinary letter corrections.
      // Permit a same-label transition, but never silently renumber its prose.
      if (plan.changed && !canTrackReferenceCitations(state)) {
        showAppAlert({ title: 'Review reference citations', message: 'Changing this document type would renumber references whose citations cannot be updated automatically. Switch first to a correspondence format that keeps the current reference letters, then review the new starting letter.' });
        return state;
      }
      const patch = safeReferencePatch(plan);
      if (!patch) return state;
      const next = documentTypeState(state, type);
      return { ...next, ...patch, formData: { ...next.formData, ...(patch.formData ? { via: patch.formData.via } : {}) } };
    });
  },

  setField: (key, value) => set((state) => {
    const formData = { ...state.formData, [key]: value };
    if (key === 'publicationType' && value !== 'MI') {
      formData.miUrgency = 'normal';
      formData.miCompletionDate = '';
    }
    if ((['i_type', 'sl3', 'sl4'].includes(state.docType)) && state.documentMode === 'compliant') {
      formData.fontFamily = 'times';
      formData.fontSize = ['sl3', 'sl4'].includes(state.docType) ? '10pt' : '12pt';
    }
    // The start letter shifts every reference after it, so re-letter in the
    // same commit — otherwise the rows keep the previous sequence on screen.
    if (key === 'startingReferenceLetter') {
      const patch = safeReferencePatch(planReferenceChange(state, state.references.map((_, index) => index),
        referenceStartIndex(state.docType, formData.startingReferenceLetter)));
      return patch ? { ...patch, formData: { ...formData, ...(patch.formData ? { via: patch.formData.via } : {}) } } : state;
    }
    if (state.docType === 'tm_ietm_front_matter') {
      formData.fontFamily = 'times';
      formData.fontSize = '10pt';
      formData.signatureType = 'digital';
    }
    return { formData };
  }),

  setFormData: (data) => set((state) => {
    const formData = publicationFont(state.docType, state.documentMode, { ...state.formData, ...data });
    if (data.startingReferenceLetter !== undefined) {
      const candidate = { ...state, formData: { ...formData, startingReferenceLetter: state.formData.startingReferenceLetter } };
      const patch = safeReferencePatch(planReferenceChange(candidate, state.references.map((_, index) => index),
        referenceStartIndex(state.docType, formData.startingReferenceLetter)));
      return patch ? { ...patch, formData: { ...formData, ...(patch.formData ? { via: patch.formData.via } : {}) } } : state;
    }
    return { formData };
  }),

  resetForm: () => {
    useUIStore.getState().setValidationVisible(false);
    set({
    reviewComments: undefined,
    documentMode: 'compliant',
    docType: 'naval_letter',
    formData: { ...DEFAULT_FORM_DATA },
    references: [...DEFAULT_REFERENCES],
    endItems: [],
    publicationTables: {},
    genericForm: undefined,
    enclosures: [...DEFAULT_ENCLOSURES],
    paragraphs: freshParagraphs(DEFAULT_PARAGRAPHS),
    copyTos: [
      { text: 'G-3/5' },
      { text: 'G-4' },
      { text: 'Regimental S-3' },
    ],
    distributions: [],
    });
  },

  // Publication tables and end items
  addTableRow: (tableKey) => set((state) => ({
    publicationTables: {
      ...state.publicationTables,
      [tableKey]: [...(state.publicationTables[tableKey] ?? []), { values: {} }],
    },
  })),

  updateTableRow: (tableKey, index, values) => set((state) => ({
    publicationTables: {
      ...state.publicationTables,
      [tableKey]: (state.publicationTables[tableKey] ?? []).map((row, i) =>
        i === index ? { ...row, values: { ...row.values, ...values } } : row
      ),
    },
  })),

  setTableRowDetails: (tableKey, index, details) => set((state) => ({
    publicationTables: { ...state.publicationTables, [tableKey]: (state.publicationTables[tableKey] ?? []).map((row, i) => i === index ? { ...row, ...details } : row) },
  })),

  setTableRowLevel: (tableKey, index, level) => set((state) => ({
    publicationTables: {
      ...state.publicationTables,
      [tableKey]: (state.publicationTables[tableKey] ?? []).map((row, i) =>
        i === index ? { ...row, level: Math.max(0, level) } : row
      ),
    },
  })),

  removeTableRow: (tableKey, index) => set((state) => ({
    publicationTables: {
      ...state.publicationTables,
      [tableKey]: (state.publicationTables[tableKey] ?? []).filter((_, i) => i !== index),
    },
  })),

  addEndItem: () => set((state) => ({
    endItems: [...state.endItems, { nsn: '', tamcn: '', id: '', model: '' }],
  })),

  updateEndItem: (index, updates) => set((state) => ({
    endItems: state.endItems.map((item, i) => (i === index ? { ...item, ...updates } : item)),
  })),

  removeEndItem: (index) => set((state) => ({
    endItems: state.endItems.filter((_, i) => i !== index),
  })),

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

  removeReference: (index) => set((state) => {
    if (!Number.isInteger(index) || index < 0 || index >= state.references.length) return state;
    return safeReferencePatch(planReferenceChange(state, state.references.map((_, i) => i).filter(i => i !== index))) ?? state;
  }),

  reorderReferences: (fromIndex, toIndex) => set((state) => {
    if (![fromIndex, toIndex].every(index => Number.isInteger(index) && index >= 0 && index < state.references.length)) return state;
    const order = state.references.map((_, index) => index);
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);
    return safeReferencePatch(planReferenceChange(state, order)) ?? state;
  }),

  // Enclosures
  addEnclosure: (title, file, fileRef) => set((state) => ({
    enclosures: [...state.enclosures, { title, file, fileRef }],
  })),

  updateEnclosure: (index, updates) => set((state) => ({
    enclosures: state.enclosures.map((enc, i) => {
      if (i !== index) return enc;
      const updated = { ...enc, ...updates };
      if (isApplyingAssets() || (!('file' in updates) && !('fileRef' in updates))) {
        enclosureResources.set(updated, enclosureResource(enc));
      }
      return updated;
    }),
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
    const newPara = { id: newParagraphId(), text, level };
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
    newParas.splice(afterIndex + 1, 0, ...texts.map((text) => ({ id: newParagraphId(), text, level })));
    return { paragraphs: normalizeLevels(newParas) };
  }),

  removeTableFootnote: (index, noteIndex) => set((state) => withoutTableFootnote(state.paragraphs, state.publicationTables, index, noteIndex)),

  updateParagraph: (index, updates) => set((state) => ({
    paragraphs: state.paragraphs.map((p, i) => (i === index ? { ...p, ...updates, id: p.id ?? newParagraphId() } : p)),
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
    set({ paragraphs: freshParagraphs([{ text: '', level: 0 }]) });
  },

  clearReferences: () => {
    debug.log('Store', 'Clearing all references');
    set(state => safeReferencePatch(planReferenceChange(state, [])) ?? state);
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
      paragraphs: freshParagraphs([{ text: '', level: 0 }]),
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
          acting: false,
          actingTitle: '',
          seniorActing: false,
          juniorActing: false,
          byDirection: false,
          byDirectionAuthority: '',
          signatureType: 'none',
          signatureImage: undefined,
          // Classification
          classLevel: 'unclassified',
          customClassification: '',
          pocEmail: '',
          // Other settings
          pageNumbering: 'simple',
          includeHyperlinks: false,
          underlineSubject: false,
          includeEndorsementSubject: false,
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
        paragraphs: freshParagraphs([{ text: '', level: 0 }]),
        references: [],
        enclosures: [],
        copyTos: [],
        distributions: [],
        // A publication's end items and table rows are document content like
        // the paragraphs above. Left behind, the previous publication's parts
        // lists reappeared under the next one's headings.
        endItems: [],
        publicationTables: {},
        genericForm: undefined,
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
      const formData = publicationFont(state.docType, state.documentMode, {
        ...state.formData,
        ...(data.formData ? {
          appendEndorsement: false,
          endorsementFrom: undefined, endorsementTo: undefined, endorsementBody: undefined,
          endorsementSigFirst: undefined, endorsementSigMiddle: undefined, endorsementSigLast: undefined,
          endorsementSerial: undefined, endorsementDate: undefined,
          ...data.formData,
          additionalEndorsements: data.formData.additionalEndorsements ?? [],
        } : {}),
      });
      // A template describes a document; it never carries an uploaded basic
      // letter. Without this, spreading the old formData stapled the previous
      // document's letter onto whatever loads next. Keyed on the REF, not the
      // bytes: this same path restores saved drafts, whose sessions serialize
      // basicLetterFileRef with the bytes stripped — those must keep their ref
      // (rehydrate brings the bytes back). Only an incoming formData with no
      // ref at all means "no letter belongs here".
      if (data.formData && !('basicLetterFileRef' in data.formData)) {
        delete formData.basicLetterFile;
        delete formData.basicLetterFileRef;
      }
      return {
        paragraphs: data.paragraphs ? freshParagraphs(migratePortionMarkings(data.paragraphs)) : state.paragraphs,
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
  applySnapshot: (snapshot, owns = () => true) => {
    if (!owns()) return;
    if (snapshot.documentCategory === 'forms' && !snapshot.genericForm) loadFormSession(snapshot.formType!, snapshot.forms);
    set((state) => {
    // A durable handle identifies the bytes. Never borrow a same-title file
    // from a different revision; missing bytes are hydrated after installation.
    // Legacy snapshots without handles retain the title-based fallback.
    const used = new Set<number>();
    const enclosures = snapshot.enclosures.map((e, i) => {
      if (e.file) return e;
      const cur = state.enclosures;
      const ref = e.fileRef;
      if (ref) {
        const file = cur.find(enclosure => enclosure.fileRef?.id === ref.id && enclosure.file)?.file;
        return file ? { ...e, file: { name: ref.name, size: ref.size || file.data.byteLength, data: file.data } } : e;
      }
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
      documentCategory: snapshot.documentCategory ?? state.documentCategory,
      formType: snapshot.formType ?? state.formType,
      documentMode: snapshot.documentMode,
      docType: snapshot.docType,
      formData: publicationFont(snapshot.docType, snapshot.documentMode, snapshot.formData),
      reviewComments: snapshot.reviewComments ? structuredClone(snapshot.reviewComments) : undefined,
      references: snapshot.references,
      enclosures,
      paragraphs: ensureParagraphIds(snapshot.paragraphs, paragraphCommentIds(snapshot.reviewComments)),
      copyTos: snapshot.copyTos,
      distributions: snapshot.distributions || [],
      endItems: snapshot.endItems ?? [],
      publicationTables: snapshot.publicationTables ?? {},
      genericForm: snapshot.genericForm,
    };
    });
    void rehydrateEnclosureFiles(owns);
  },

  getSnapshot: (): DocumentSnapshot => {
    const state = get();
    return {
      documentMode: state.documentMode,
      documentCategory: state.documentCategory,
      formType: state.formType,
      forms: state.documentCategory === 'forms' && !state.genericForm ? serializeForm(state.formType) : undefined,
      docType: state.docType,
      formData: state.formData,
      ...(state.reviewComments ? { reviewComments: state.reviewComments } : {}),
      references: state.references,
      enclosures: state.enclosures,
      paragraphs: state.paragraphs,
      copyTos: state.copyTos,
      distributions: state.distributions,
      endItems: state.endItems,
      publicationTables: state.publicationTables,
      genericForm: state.genericForm,
    };
  },
}));

// Recovery remains suspended while the startup prompt is awaiting a decision.
let sessionSavesSuspended = false;
export const areSessionSavesSuspended = () => sessionSavesSuspended;
export function suspendSessionSaves(): void { sessionSavesSuspended = true; }
export function resumeSessionSaves(): void { sessionSavesSuspended = false; }

/**
 * Saves the current document state to localStorage for session restore.
 * Excludes non-serializable data like file ArrayBuffers.
 */
export function saveSessionToStorage(state: DocumentState): void {
  try {
    // Create serializable session (excluding file data)
    const session = serializeSession(state);

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
      hasReviewComments(session) ||
      session.genericForm ||
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

// Suppress category-transition autosaves while replacing a whole session.
let applyingSession = false;
let applyingAssets = false;
export const isApplyingAssets = () => applyingAssets;
/** Hydration changes bytes and handles without becoming a user edit. */
export function mutateSessionAssets(update: () => void): void {
  const previous = applyingAssets;
  applyingAssets = true;
  try { update(); } finally { applyingAssets = previous; }
}
const replacementListeners = new Set<(phase: 'before' | 'after') => void>();
/** The workspace observes replacements without a reverse store dependency. */
export function observeSessionReplacement(listener: (phase: 'before' | 'after') => void): () => void {
  replacementListeners.add(listener);
  return () => { replacementListeners.delete(listener); };
}
export const isApplyingSession = () => applyingSession;
export function resetDocumentHistory(): void {
  if (applyingSession) return;
  if (replacementListeners.size) {
    for (const listener of replacementListeners) listener('after');
    return;
  }
  useHistoryStore.getState().clearHistory();
  useHistoryStore.getState().saveSnapshot(useDocumentStore.getState().getSnapshot());
}

export function replaceSessionState(update: () => void): void {
  const wasApplying = applyingSession;
  applyingSession = true;
  try {
    if (!wasApplying) for (const listener of replacementListeners) listener('before');
    update();
  } finally {
    applyingSession = wasApplying;
    // A failed replacement may have changed state; bind history to what remains.
    if (!wasApplying) resetDocumentHistory();
  }
}

export function restoreSession(): boolean {
  try {
    const session = getSavedSession();
    if (!session) return false;

    loadSharedSession(session);
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
  return projectSharedSession(getSerializedSession());
}

export function getSerializedSession(): SerializedSession {
  return serializeSession(useDocumentStore.getState());
}

/**
 * Serializes a given document state (not necessarily the live one) into a
 * shareable session, so the registry can snapshot a previous state, e.g. to
 * preserve a correspondence document the instant the user flips to the Forms tab.
 */
export function serializeSession(state: DocumentState): SerializedSession {
  return serializeDocumentSnapshot({
    ...state,
    forms: state.documentCategory === 'forms' && !state.genericForm ? serializeForm(state.formType) : undefined,
  }, Date.now());
}

/** Build a blank document without changing the active workspace. */
export function createBlankSession(formType?: FormType, docType = 'naval_letter'): SerializedSession {
  const category = formType ? 'forms' : 'correspondence';
  const configured = documentTypeState({ documentMode: 'compliant', formData: structuredClone(DEFAULT_FORM_DATA), references: structuredClone(DEFAULT_REFERENCES) }, docType);
  return {
    documentMode: 'compliant', documentCategory: category, docType,
    formType: formType ?? 'navmc_10274',
    formData: category === 'forms' ? {} : configured.formData,
    references: category === 'forms' ? [] : configured.references,
    enclosures: category === 'forms' ? [] : structuredClone(DEFAULT_ENCLOSURES),
    paragraphs: category === 'forms' ? [] : freshParagraphs(structuredClone(DEFAULT_PARAGRAPHS)),
    copyTos: category === 'forms' ? [] : [{ text: 'G-3/5' }, { text: 'G-4' }, { text: 'Regimental S-3' }],
    distributions: [], endItems: [], publicationTables: {}, timestamp: Date.now(),
    ...(category === 'forms' ? { forms: prepareFormSession(formType!) } : {}),
  };
}

export function prepareSessionState(value: unknown, preserveNativeText = false): DocumentSnapshot {
  const session = parseSavedSession(value);
  if (preserveNativeText && !supportsReviewComments(session)) throw new Error('Only native correspondence can retain review baseline text.');
  const fields = new Map(Object.entries(session.formData));
  for (const [key, fallback] of Object.entries(DEFAULT_FORM_DATA)) {
    const supplied = fields.get(key);
    if (supplied !== undefined && ['string', 'number', 'boolean'].includes(typeof fallback) && typeof supplied !== typeof fallback) {
      throw new Error(`Invalid saved field: ${key}`);
    }
  }
  const formData = !preserveNativeText && session.formData.unitAddress
    ? { ...session.formData, unitAddress: canonicalizeUnitAddress(session.formData.unitAddress) }
    : session.formData;
  return {
    documentMode: session.documentMode,
    documentCategory: session.documentCategory,
    docType: session.docType,
    formType: session.formType,
    formData: preserveNativeText ? formData : publicationFont(session.docType, session.documentMode, formData),
    ...(session.reviewComments ? { reviewComments: session.reviewComments } : {}),
    references: session.references,
    endItems: session.endItems ?? [], publicationTables: session.publicationTables ?? {},
    genericForm: session.genericForm,
    ...(session.documentCategory === 'forms' && !session.genericForm ? { forms: prepareFormSession(session.formType, session.forms) } : {}),
    enclosures: session.enclosures.map(({ hasFile: _hasFile, ...enclosure }) => enclosure),
    paragraphs: preserveNativeText ? session.paragraphs : migratePortionMarkings(session.paragraphs),
    copyTos: session.copyTos, distributions: session.distributions,
  };
}

/** Internal adapter: callers prepare before entering the replacement boundary. */
export function installSessionState(snapshot: DocumentSnapshot): void {
  const { forms, ...document } = snapshot;
  document.reviewComments = snapshot.reviewComments ? structuredClone(snapshot.reviewComments) : undefined;
  if (snapshot.documentCategory === 'forms' && !snapshot.genericForm) loadFormSession(snapshot.formType!, forms);
  useDocumentStore.setState(document);
}

/** Internal compatibility adapter. Workspace routes use the owner. */
export function loadSharedSession(session: SerializedSession, owns: () => boolean = () => true): void {
  const prepared = prepareSessionState(session);
  if (!owns()) return;
  replaceSessionState(() => installSessionState(prepared));
  void rehydrateEnclosureFiles(owns);
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
export async function rehydrateEnclosureFiles(owns: () => boolean): Promise<void> {
  if (!owns()) return;
  const original = useDocumentStore.getState();
  const signature = original.formData.signatureImage;
  // A complete signature is already hydrated. Republishing an equivalent
  // clone changes formData identity and restarts the live-preview effect.
  if (signature && (!signature.fileRef || !signature.data)) {
    try {
      await withAttachmentStaging(async () => {
        const resolved = signature.fileRef ? await resolveSignature(signature) : await persistSignature(signature);
        if (owns() && resolved && useDocumentStore.getState().formData.signatureImage === signature) {
          mutateSessionAssets(() => useDocumentStore.setState(state => ({ formData: { ...state.formData, signatureImage: resolved } })));
        }
      });
    } catch (error) { debug.warn('Store', 'Signature image remains available for recovery', error); }
  }
  if (!owns()) return;
  const basicReference = original.formData.basicLetterFileRef;
  const basicLetter = basicReference ? { ...basicReference } : undefined;
  const enclosures = original.enclosures.filter(enclosure => enclosure.fileRef && !enclosure.file)
    .map(enclosure => ({ reference: enclosure.fileRef!, ...enclosure.fileRef! }));
  if (basicReference && basicLetter && !original.formData.basicLetterFile) {
    try {
      const data = await loadAttachment(basicLetter.id);
      if (!owns()) return;
      const current = useDocumentStore.getState().formData;
      if (data && !current.basicLetterFile && current.basicLetterFileRef === basicReference && current.basicLetterFileRef?.id === basicLetter.id) {
        const file = { name: basicLetter.name, size: basicLetter.size || data.byteLength, data };
        hydratedFiles.set(file, basicReference);
        mutateSessionAssets(() => useDocumentStore.setState(state => ({ formData: {
          ...state.formData, basicLetterFile: file,
        } })));
      }
    } catch (error) { debug.error('Store', 'Failed to rehydrate basic-letter file', error); }
  }
  if (!owns()) return;
  const loaded = new Map<string, ArrayBuffer>();
  await Promise.all([...new Set(enclosures.map(enclosure => enclosure.id))].map(async id => {
    try { const data = await loadAttachment(id); if (data) loaded.set(id, data); }
    catch (error) { debug.error('Store', 'Failed to rehydrate enclosure file', error); }
  }));
  if (!owns() || !loaded.size) return;
  mutateSessionAssets(() => useDocumentStore.setState(state => ({
    enclosures: state.enclosures.map(enclosure => {
      if (enclosure.file || !enclosure.fileRef) return enclosure;
      const original = enclosures.find(candidate => candidate.reference === enclosure.fileRef && candidate.id === enclosure.fileRef?.id);
      if (!original) return enclosure;
      const data = loaded.get(original.id);
      if (!data) return enclosure;
      const hydrated = { ...enclosure, file: { name: original.name, size: original.size || data.byteLength, data } };
      enclosureResources.set(hydrated, enclosureResource(enclosure));
      return hydrated;
    }),
  })));
}

/** Persist only files captured by this activation; completed blob writes may outlive it. */
export async function persistUnsavedEnclosures(owns: () => boolean): Promise<void> {
  if (!owns()) return;
  const work = useDocumentStore.getState().enclosures.filter(enclosure => enclosure.file && !enclosure.fileRef)
    .map(enclosure => ({ file: enclosure.file!, name: enclosure.file!.name, size: enclosure.file!.size, data: enclosure.file!.data }));
  for (const item of work) {
    if (!owns()) return;
    try {
      const ref = await persistAttachment({ name: item.name, size: item.size, type: '' }, item.data);
      if (!owns()) return;
      mutateSessionAssets(() => useDocumentStore.setState(state => ({
        enclosures: state.enclosures.map(enclosure => {
          if (enclosure.file !== item.file || enclosure.file.name !== item.name || enclosure.file.size !== item.size || enclosure.file.data !== item.data || enclosure.fileRef) return enclosure;
          const stored = { ...enclosure, fileRef: ref };
          enclosureResources.set(stored, enclosureResource(enclosure));
          return stored;
        }),
      })));
    } catch (error) { debug.error('Store', 'Failed to persist imported enclosure', error); }
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
