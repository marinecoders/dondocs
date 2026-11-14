import type { ReviewComments, CommentThread, CommentMessage, CommentAnchor } from './reviewComments';
import type { DocumentSnapshot } from '@/stores/historyStore';
import type { SerializedSession } from '@/stores/documentStore';
import type { FormSession, Navmc11811Data, NavmcForm10274Data } from '@/stores/formStore';
import type { CopyTo, Distribution, DocumentData, EndItem, Enclosure, FileRef, Paragraph, PublicationTableRow, Reference, SignatureImage } from '@/types/document';
import type { FormSignatureBlock } from '@/types/signature';
import type { AdditionalEndorsement } from './appendedEndorsement';
import type { ManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import type { Sl3Data, Sl3Component } from '@/data/techpub/sl3';
import type { Sl4Data, Sl4Part, Sl4Row } from '@/data/techpub/sl4';

export type FieldRule = 'text' | 'document-date' | 'label' | 'control' | 'value' | 'identity' | 'binary' | 'asset' | 'form'
  | { readonly fields: FieldPolicies }
  | { readonly items: FieldRule }
  | { readonly entries: FieldRule }
  | { readonly variants: Readonly<Record<string, FieldPolicies>> };
export interface FieldPolicies { readonly [key: string]: FieldRule }
type PoliciesFor<T> = { readonly [K in keyof T]-?: FieldRule };
const object = (fields: FieldPolicies): FieldRule => ({ fields });
const array = (items: FieldRule): FieldRule => ({ items });
const dictionary = (entries: FieldRule): FieldRule => ({ entries });
export const ASSET_FIELD_POLICIES = {
  id: 'identity', name: 'label', size: 'value', type: 'control', data: 'binary', fileRef: 'asset',
} satisfies PoliciesFor<FileRef & SignatureImage>;

const endItem = { nsn: 'text', tamcn: 'text', id: 'text', model: 'text' } satisfies PoliciesFor<EndItem>;
const note = { id: 'identity', text: 'text', portionMarking: 'control' } satisfies PoliciesFor<Sl3Data['notes'][number]>;
const definition = { id: 'identity', term: 'text', meaning: 'text', portionMarking: 'control' } satisfies PoliciesFor<Sl3Data['definitions'][number]>;
const artworkLabel = { id: 'identity', text: 'text', x: 'value', y: 'value' } satisfies PoliciesFor<Sl3Data['artwork'][number]['labels'][number]>;
const artwork = { figureId: 'identity', lettering: 'control', labels: array(object(artworkLabel)) } satisfies PoliciesFor<Sl3Data['artwork'][number]>;
const component = {
  id: 'identity', portionMarking: 'control', category: 'control', parentId: 'identity',
  nomenclature: 'text', description: 'text', nsn: 'text', tamcn: 'text', idNumber: 'text',
  partNumber: 'text', cage: 'text', unit: 'text', unitOfIssue: 'text', primaryTamcn: 'text',
  configurationRatio: 'text', quantity: 'text', model: 'text', figureReference: 'text',
  figureId: 'identity', noteIds: array('identity'), serialized: 'value',
} satisfies PoliciesFor<Sl3Component>;
const sl3 = {
  orientation: 'control', rowsPerSheet: 'value', illustrationsPerPage: 'value',
  technicalData: 'text', sourceManual: 'text', configurationReference: 'text', fieldingPlanReference: 'text',
  technicalPortion: 'control', sequencingNote: 'text', sequencingPortion: 'control',
  showFigureReference: 'value', showModel: 'value', endItemFigureId: 'identity',
  definitions: array(object(definition)), artwork: array(object(artwork)), notes: array(object(note)),
  components: array(object(component)),
} satisfies PoliciesFor<Sl3Data>;
const part = {
  kind: 'control', id: 'identity', portionMarking: 'control', parentId: 'identity', nomenclature: 'text',
  description: 'text', smr: 'text', nsn: 'text', cage: 'text', partNumber: 'text',
  mandatoryReplacement: 'value', economicReplacement: 'value', unit: 'text', quantityPerApplication: 'text',
  quantityPerEquipment: 'text', maintenancePart: 'value', isKit: 'value',
  relationship: object({ kind: 'control', itemIds: array('identity') } satisfies PoliciesFor<NonNullable<Sl4Part['relationship']>>),
  figureId: 'identity', circuitSymbols: array('text'),
} satisfies PoliciesFor<Sl4Part>;
const heading = { kind: 'control', id: 'identity', text: 'text', majorCombination: 'value', portionMarking: 'control' } satisfies PoliciesFor<Extract<Sl4Row, { kind: 'heading' }>>;
const blank = { kind: 'control', id: 'identity' } satisfies PoliciesFor<Extract<Sl4Row, { kind: 'blank' }>>;
const sl4 = {
  sourceManual: 'text', standaloneRationale: 'text', cutoffDate: 'document-date', contextPortion: 'control',
  definitions: array(object(definition)), artwork: array(object(artwork)),
  rowsPerSheet: 'value', indexRowsPerPanel: 'value', endItemFigureId: 'identity',
  circuitIndex: object({ mode: 'control', reason: 'text' } satisfies PoliciesFor<Sl4Data['circuitIndex']>),
  cages: array(object({ id: 'identity', code: 'text', name: 'text', address: 'text', portionMarking: 'control' } satisfies PoliciesFor<Sl4Data['cages'][number]>)),
  notes: array(object(note)),
  revisions: array(object({ id: 'identity', revision: 'text', date: 'document-date', description: 'text', enteredBy: 'text', portionMarking: 'control' } satisfies PoliciesFor<Sl4Data['revisions'][number]>)),
  rows: array({ variants: { part, heading, blank } satisfies Record<Sl4Row['kind'], FieldPolicies> }),
} satisfies PoliciesFor<Sl4Data>;
const manual = {
  subtype: 'control', service: 'control', maintenanceLevel: 'text', subtitle: 'text',
  shortTitleBasis: 'control', shortTitleApproval: 'text', authorityBasis: 'control', authorityReference: 'text',
  rightsAssessment: 'control', volume: 'text', volumes: 'text', volumeNotice: 'text', supplementNotice: 'text',
  copyrightCredit: 'text', governmentRights: 'text', contentContact: 'text', dfarClause: 'control',
  endItems: array(object({ rowId: 'identity', ...endItem } satisfies PoliciesFor<ManualFrontMatter['endItems'][number]>)),
} satisfies PoliciesFor<ManualFrontMatter>;
const endorsement = {
  id: 'identity', endorsementFrom: 'text', endorsementTo: 'text', endorsementBody: 'text',
  endorsementSigFirst: 'text', endorsementSigMiddle: 'text', endorsementSigLast: 'text',
  endorsementSerial: 'text', endorsementDate: 'document-date',
} satisfies PoliciesFor<AdditionalEndorsement>;

/** Every editable field needs a deliberate text, structure, or exclusion policy. */
export const DOCUMENT_DATA_FIELD_POLICIES = {
  manualFrontMatter: object(manual), publicationSigningDate: 'document-date', publicationClosedDates: 'document-date',
  docType: 'control', fontSize: 'control', fontFamily: 'control', pageNumbering: 'control',
  startingPageNumber: 'value', startingReferenceLetter: 'control', startingEnclosureNumber: 'value',
  department: 'control', unitLine1: 'text', unitLine2: 'text', unitAddress: 'text', sealType: 'control', letterheadColor: 'control',
  ssic: 'text', serial: 'text', date: 'document-date', from: 'text', to: 'text', via: 'text', subject: 'text',
  nomenclature: 'text', sl3: object(sl3), sl4: object(sl4), publicationType: 'control', controllingOffice: 'text',
  miUrgency: 'control', miCompletionDate: 'document-date', shortTitle: 'text', pcn: 'text', supersedure: 'text', exportRestricted: 'value',
  endorsementOrdinal: 'text', basicLetterId: 'text', basicLetterFile: 'asset', basicLetterFileRef: 'asset',
  sigFirst: 'text', sigMiddle: 'text', sigLast: 'text', sigRank: 'text', sigTitle: 'text', officeCode: 'text',
  byDirection: 'value', byDirectionAuthority: 'text', acting: 'value', actingTitle: 'text', seniorActing: 'value', juniorActing: 'value',
  signatureImage: 'asset', signatureType: 'control', appendEndorsement: 'value', additionalEndorsements: array(object(endorsement)),
  endorsementFrom: 'text', endorsementTo: 'text', endorsementBody: 'text', endorsementSigFirst: 'text',
  endorsementSigMiddle: 'text', endorsementSigLast: 'text', endorsementSerial: 'text', endorsementDate: 'document-date',
  classLevel: 'control', customClassification: 'text', classifiedBy: 'text', classificationBasis: 'control',
  derivedFrom: 'text', declassifyOn: 'document-date', classReason: 'text', classifiedPocEmail: 'text',
  cuiControlledBy: 'text', cuiCategory: 'text', cuiDissemination: 'text', cuiDistStatement: 'control', distReason: 'text', distDate: 'document-date', pocEmail: 'text',
  seniorCommandName: 'text', seniorSSIC: 'text', seniorSerial: 'text', seniorDate: 'document-date', seniorSigName: 'text', seniorSigRank: 'text', seniorSigTitle: 'text',
  juniorCommandName: 'text', juniorSSIC: 'text', juniorSerial: 'text', juniorDate: 'document-date', juniorSigName: 'text', juniorSigRank: 'text', juniorSigTitle: 'text', moaSubject: 'text',
  jointSeniorName: 'text', jointSeniorZip: 'text', jointSeniorCode: 'text', jointSeniorFrom: 'text', jointSeniorSigName: 'text', jointSeniorSigTitle: 'text',
  jointJuniorName: 'text', jointJuniorZip: 'text', jointJuniorCode: 'text', jointJuniorSSIC: 'text', jointJuniorSerial: 'text', jointJuniorDate: 'document-date',
  jointJuniorSigName: 'text', jointJuniorSigTitle: 'text', jointJuniorFrom: 'text', jointCommonLocation: 'text', jointTo: 'text', jointSubject: 'text',
  jointMemoSeniorFrom: 'text', jointMemoSeniorSigName: 'text', jointMemoSeniorSigTitle: 'text', jointMemoJuniorFrom: 'text', jointMemoJuniorSigName: 'text', jointMemoJuniorSigTitle: 'text',
  body: 'text', inReplyTo: 'value', inReplyToText: 'text', includeHyperlinks: 'value', showSubjectOnContinuation: 'value',
  includeEndorsementSubject: 'value', underlineSubject: 'value', salutation: 'text', complimentaryClose: 'text',
  memorandumFor: 'text', attnLine: 'text', throughLine: 'text', coordination: 'text', preparedBy: 'text',
} satisfies PoliciesFor<DocumentData>;

const signature = { name: 'text', statement: 'text', style: 'control', image: 'binary', imageRef: 'asset' } satisfies PoliciesFor<FormSignatureBlock>;
export const NAVMC_10274_FIELD_POLICIES = {
  actionNo: 'text', ssicFileNo: 'text', date: 'document-date', from: 'text', via: 'text', orgStation: 'text', to: 'text',
  natureOfAction: 'text', copyTo: 'text', references: 'text', enclosures: 'text', supplementalInfo: 'text',
  proposedAction: 'text', signatureBlocks: array(object(signature)),
} satisfies PoliciesFor<NavmcForm10274Data>;
export const NAVMC_11811_FIELD_POLICIES = {
  lastName: 'text', firstName: 'text', middleName: 'text', edipi: 'text', remarksText: 'text',
  remarksTextRight: 'text', entryDate: 'document-date', box11: 'text', signatureBlocks: array(object(signature)),
} satisfies PoliciesFor<Navmc11811Data>;
const forms = {
  navmc10274: object(NAVMC_10274_FIELD_POLICIES), navmc11811: object(NAVMC_11811_FIELD_POLICIES), includeCoverPage: 'value',
} satisfies PoliciesFor<FormSession>;
const paragraph = {
  id: 'identity',
  referenceId: 'identity', tableFootnotes: array(object({ id: 'identity', text: 'text' } satisfies PoliciesFor<NonNullable<Paragraph['tableFootnotes']>[number]>)), publicationSection: 'control',
  text: 'text', level: 'value', header: 'text', tableKey: 'identity', tableIdentifierMode: 'control', callout: 'control',
  procedure: 'value', appendix: 'value', figure: object({ fileRef: 'asset', name: 'label', type: 'control', width: 'value', height: 'value', portionMarking: 'control' } satisfies PoliciesFor<NonNullable<Paragraph['figure']>>),
  portionMarking: 'control',
} satisfies PoliciesFor<Paragraph>;
const reference = { letter: 'control', title: 'text', url: 'text' } satisfies PoliciesFor<Reference>;
const enclosure = {
  title: 'text', file: 'asset', fileRef: 'asset', pageStyle: 'control', hasCoverPage: 'value', hasFile: 'value', coverPageDescription: 'text',
} satisfies PoliciesFor<Enclosure & { hasFile?: boolean }>;
const tableRow = {
  values: dictionary('text'), level: 'value', identificationException: 'text',
  openPurchase: object({ manufacturer: 'text', address: 'text' } satisfies PoliciesFor<NonNullable<PublicationTableRow['openPurchase']>>),
} satisfies PoliciesFor<PublicationTableRow>;
const commentMessage = { id: 'identity', author: 'text', text: 'text', createdAt: 'value', editedAt: 'value' } satisfies PoliciesFor<CommentMessage>;
const documentAnchor = { kind: 'control' } satisfies PoliciesFor<Extract<CommentAnchor, { kind: 'document' }>>;
const fieldAnchor = { kind: 'control', field: 'control', context: 'text', docType: 'control' } satisfies PoliciesFor<Extract<CommentAnchor, { kind: 'field' }>>;
const paragraphAnchor = { kind: 'control', paragraphId: 'identity', context: 'text', docType: 'control' } satisfies PoliciesFor<Extract<CommentAnchor, { kind: 'paragraph' }>>;
const commentThread = { id: 'identity', anchor: { variants: { document: documentAnchor, field: fieldAnchor, paragraph: paragraphAnchor } }, messages: array(object(commentMessage)), resolved: 'value' } satisfies PoliciesFor<CommentThread>;
const reviewComments = { version: 'value', threads: array(object(commentThread)) } satisfies PoliciesFor<ReviewComments>;
export const DOCUMENT_FIELD_POLICIES = {
  reviewComments: object(reviewComments),
  genericForm: 'form', documentMode: 'control', documentCategory: 'control', formType: 'control', forms: object(forms), timestamp: 'value',
  docType: 'control', formData: object(DOCUMENT_DATA_FIELD_POLICIES),
  references: array(object(reference)), enclosures: array(object(enclosure)), paragraphs: array(object(paragraph)),
  copyTos: array(object({ text: 'text' } satisfies PoliciesFor<CopyTo>)), distributions: array(object({ text: 'text' } satisfies PoliciesFor<Distribution>)),
  endItems: array(object(endItem)), publicationTables: dictionary(array(object(tableRow))),
} satisfies PoliciesFor<DocumentSnapshot & SerializedSession>;

const frozenPolicies = new WeakSet<object>();
function freezePolicies(value: object): void {
  if (frozenPolicies.has(value)) return;
  frozenPolicies.add(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezePolicies(child);
  }
  Object.freeze(value);
}
freezePolicies(DOCUMENT_FIELD_POLICIES);
freezePolicies(ASSET_FIELD_POLICIES);
