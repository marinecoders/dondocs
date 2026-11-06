import type { SerializedSession } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG, DOC_TYPE_LABELS, formTypeLabel } from '@/types/document';
import { getEditorSections, getFormSections } from './editorSections';
import { documentTextFields, type DocumentTextField, type FieldPath } from './documentFields';

export interface SearchField { readonly text: string; readonly sectionId: string; readonly label: string }

// Match the letterhead choices while keeping familiar abbreviations searchable.
const departmentLabels: Record<string, string> = {
  usmc: 'United States Marine Corps (USMC)',
  navy: 'Department of the Navy',
  dod: 'Department of Defense (DoD)',
  dow: 'Department of War (DoW)',
};

function formatCorrespondenceField(key: string, value: string): string {
  if (!value.trim()) return value;
  if (key === 'department') return `Department / Service: ${departmentLabels[value] ?? value}`;
  if (key === 'sealType') return `Seal: ${departmentLabels[value] ?? value}`;
  return value;
}

function builtinSection(formType: string, key: string): string {
  if (key === 'signatureBlocks') return 'signatures';
  if (formType === 'navmc_118_11') return /^(lastName|firstName|middleName|edipi|box11)$/.test(key) ? 'marine' : 'content';
  if (/^(actionNo|ssicFileNo|date)$/.test(key)) return 'header';
  if (/^(from|via|orgStation|to)$/.test(key)) return 'addressing';
  return /^(copyTo|references|enclosures)$/.test(key) ? 'references' : 'content';
}

function manualSection(path: FieldPath): string | undefined {
  if (path[0] !== 'formData') return;
  const key = String(path[1]);
  if (key === 'manualFrontMatter') {
    const nested = String(path[2]);
    if (nested === 'endItems') return 'manual-items';
    if (['contentContact', 'authorityReference', 'authorityBasis'].includes(nested)) return 'manual-authentication';
    if (['rightsAssessment', 'dfarClause', 'supplementNotice', 'volumeNotice', 'copyrightCredit', 'governmentRights'].includes(nested)) return 'manual-notices';
    return 'manual-publication';
  }
  if (/^(class|cui|customClassification|derivedFrom|declassifyOn|pocEmail|distReason|distDate|supersedure)/.test(key)) return 'manual-notices';
  if (/^(unit|sig|controllingOffice)/.test(key)) return 'manual-authentication';
  return 'manual-publication';
}

function correspondenceSection(session: SerializedSession, path: FieldPath, labels: ReadonlyMap<string, string>): string | undefined {
  if (session.docType === 'tm_ietm_front_matter') return manualSection(path);
  const root = String(path[0]);
  if (root === 'formData') {
    const key = String(path[1]);
    if (key === 'sl3') {
      const nested = String(path[2]);
      if (['components', 'orientation', 'rowsPerSheet', 'showFigureReference', 'showModel'].includes(nested)) return 'sl3-inventory';
      if (['artwork', 'endItemFigureId', 'illustrationsPerPage'].includes(nested)) return 'sl3-figures';
      return 'sl3-details';
    }
    if (key === 'sl4') {
      const nested = String(path[2]);
      if (nested === 'cages') return 'sl4-cages';
      if (nested === 'rows' || nested === 'rowsPerSheet') return 'sl4-parts';
      if (nested === 'artwork' || nested === 'endItemFigureId') return 'sl4-figures';
      if (nested === 'circuitIndex' || nested === 'indexRowsPerPanel') return 'sl4-indexes';
      if (nested === 'revisions') return 'sl4-revisions';
      return 'sl4-preface';
    }
    const heading = ['moa', 'joint', 'joint_memo', 'executive', 'addressing', 'cover', 'sl3-cover', 'sl4-cover'].find(id => labels.has(id));
    if (/^(class|cui|customClassification|derivedFrom|declassifyOn|pocEmail)/i.test(key)) return 'classification';
    if (/^(department|unit|seal|letterhead|inReplyTo)/.test(key)) return ['sl4-cover', 'sl3-cover', 'cover', 'letterhead'].find(id => labels.has(id));
    if (key === 'additionalEndorsements' || /^(sig|acting|seniorActing|juniorActing|byDirection|officeCode|complimentaryClose|endorsement(Sig|Body|From|To|Date|Serial))/.test(key)) return labels.has('signature') ? 'signature' : heading;
    if (/^(basicLetter|endorsementOrdinal)/.test(key)) return 'basic';
    if (/^(font|page|starting|docType)/.test(key)) return 'type';
    return key === 'body' ? 'body' : heading;
  }
  if (root === 'endItems') return session.docType === 'sl3' ? 'sl3-cover' : session.docType === 'sl4' ? 'sl4-cover' : 'cover';
  if (root === 'paragraphs') return session.docType === 'sl3' ? 'sl3-figures' : session.docType === 'sl4' ? 'sl4-figures' : 'body';
  return ({ publicationTables: 'tables', references: 'references', enclosures: 'enclosures', copyTos: 'copyto', distributions: 'distribution' } as Record<string, string>)[root];
}

function configuredField(session: SerializedSession, field: DocumentTextField, answered: ReadonlySet<string>): SearchField | undefined {
  const form = session.genericForm!;
  const path = field.path;
  const firstSection = form.definition.sections[0]?.id ?? Object.keys(form.definition.rowGroups)[0] ?? 'type';
  if (path[1] === 'definition' && path[2] === 'label') return { text: field.text, sectionId: firstSection, label: 'Form' };
  const key = path[1] === 'answers' ? path[2] : path[1] === 'definition' && path[2] === 'fields' ? path[3] : undefined;
  if (typeof key === 'string') {
    if (path[1] === 'definition' && answered.has(JSON.stringify(['answers', key]))) return;
    const section = form.definition.sections.find(section => section.fields.includes(key));
    if (!section) return;
    const text = path[1] === 'answers' ? `${form.definition.fields[key].label}: ${field.text}` : `${field.text}:`;
    return { text, sectionId: section.id, label: section.title };
  }
  const groupId = path[1] === 'rows' ? path[2] : path[1] === 'definition' && path[2] === 'rowGroups' ? path[3] : undefined;
  if (typeof groupId !== 'string' || !Object.hasOwn(form.definition.rowGroups, groupId)) return;
  if (path[1] === 'definition' && path[4] === 'columns'
    && answered.has(JSON.stringify(['rows', groupId, path[5]]))) return;
  const group = form.definition.rowGroups[groupId];
  const column = path[1] === 'rows' ? path[5] : undefined;
  const text = typeof column === 'string' ? `${group.columns[column].label}: ${field.text}` : field.text;
  return { text, sectionId: groupId, label: group.title };
}

/** One text inventory, with UI-specific labels and destinations applied afterward. */
export function sessionSearchFields(session: SerializedSession): SearchField[] {
  if (!session || typeof session !== 'object' || typeof session.docType !== 'string') return [];
  let inventory: readonly DocumentTextField[];
  try { inventory = documentTextFields(session, 'search'); }
  catch { return []; } // Unsupported records retain their library title and recovery actions.
  const fields: SearchField[] = [];
  const add = (text: string, sectionId: string | undefined, label: string | undefined) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized && sectionId && label && !normalized.startsWith('data:image/')) {
      fields.push(Object.freeze({ text: normalized, sectionId, label }));
    }
  };
  if (session.documentCategory === 'forms' && session.genericForm) {
    const answered = new Set(inventory.flatMap(field => {
      if (field.path[0] !== 'genericForm') return [];
      if (field.path[1] === 'answers') return [JSON.stringify(['answers', field.path[2]])];
      if (field.path[1] === 'rows') return [JSON.stringify(['rows', field.path[2], field.path[5]])];
      return [];
    }));
    for (const field of inventory) {
      if (field.path[0] !== 'genericForm') continue;
      const item = configuredField(session, field, answered);
      if (item) add(item.text, item.sectionId, item.label);
    }
    return fields;
  }
  const form = session.documentCategory === 'forms';
  const selectedFormType = session.formType ?? 'navmc_10274';
  const config = Object.hasOwn(DOC_TYPE_CONFIG, session.docType) ? DOC_TYPE_CONFIG[session.docType] : DOC_TYPE_CONFIG.naval_letter;
  const sections = form ? getFormSections(selectedFormType) : getEditorSections(config, session.docType);
  const labels = new Map([['type', 'Document type'], ...sections.map(section => [section.id, section.label] as [string, string])]);
  add(form ? formTypeLabel(selectedFormType) : DOC_TYPE_LABELS[session.docType] ?? session.docType, 'type', labels.get('type'));
  for (const field of inventory) {
    if (['docType', 'formType', 'documentMode', 'documentCategory'].includes(String(field.path[0]))) continue;
    const sectionId = form ? field.path[0] === 'forms' ? builtinSection(selectedFormType, String(field.path[2])) : undefined
      : correspondenceSection(session, field.path, labels);
    const text = field.path[0] === 'formData' && field.path.length === 2 ? formatCorrespondenceField(String(field.path[1]), field.text) : field.text;
    add(text, sectionId, sectionId ? labels.get(sectionId) : undefined);
  }
  return fields;
}

export function searchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSearch(text: string, query: string): boolean {
  const lower = text.toLocaleLowerCase();
  return searchTerms(query).every((term) => lower.includes(term));
}

/** Prefer the field containing most query terms; snippets center on the match. */
export function findSearchMatch(fields: SearchField[], query: string): { field: SearchField; snippet: string } | undefined {
  const terms = searchTerms(query);
  if (!terms.length) return;
  const ranked = fields.map((field) => ({ field, score: terms.filter((t) => field.text.toLocaleLowerCase().includes(t)).length }))
    .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  const field = ranked[0]?.field;
  if (!field) return;
  const at = Math.min(...terms.map((t) => field.text.toLocaleLowerCase().indexOf(t)).filter((i) => i >= 0));
  const start = Math.max(0, at - 45);
  const end = Math.min(field.text.length, start + 180);
  return { field, snippet: `${start ? '…' : ''}${field.text.slice(start, end)}${end < field.text.length ? '…' : ''}` };
}
