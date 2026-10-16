import type { SerializedSession } from '@/stores/documentStore';
import { DOC_TYPE_CONFIG, DOC_TYPE_LABELS, FORM_TYPE_LABELS } from '@/types/document';
import { getEditorSections, getFormSections } from './editorSections';

export interface SearchField { text: string; sectionId: string; label: string }

/** Search user-visible text, never image bytes, file handles or internal IDs. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, v]) =>
    /^(id|image|signatureImage|file|fileRef|basicLetterFile|basicLetterFileRef|dataUrl|data|style|type)$/i.test(key) ? [] : strings(v));
}

export function sessionSearchFields(session: SerializedSession): SearchField[] {
  const form = session.documentCategory === 'forms';
  const config = DOC_TYPE_CONFIG[session.docType] ?? DOC_TYPE_CONFIG.naval_letter;
  const sections = form ? getFormSections(session.formType ?? 'navmc_10274') : getEditorSections(config, session.docType);
  const labels = new Map([['type', 'Document type'], ...sections.map((s) => [s.id, s.label] as [string, string])]);
  const fields: SearchField[] = [];
  const add = (sectionId: string, value: unknown) => {
    const label = labels.get(sectionId);
    if (!label) return; // Do not index hidden fields left over from another type.
    for (const raw of strings(value)) {
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text && !text.startsWith('data:image/')) fields.push({ text, sectionId, label });
    }
  };
  add('type', form ? FORM_TYPE_LABELS[session.formType ?? 'navmc_10274'] : DOC_TYPE_LABELS[session.docType]);
  if (form) {
    const data = session.formType === 'navmc_118_11' ? session.forms?.navmc11811 : session.forms?.navmc10274;
    for (const [key, value] of Object.entries(data ?? {})) {
      const section = key === 'signatureBlocks' ? 'signatures'
        : session.formType === 'navmc_118_11'
          ? /^(lastName|firstName|middleName|edipi|box11)$/.test(key) ? 'marine' : 'content'
          : /^(actionNo|ssicFileNo|date)$/.test(key) ? 'header'
            : /^(from|via|orgStation|to)$/.test(key) ? 'addressing'
              : /^(copyTo|references|enclosures)$/.test(key) ? 'references' : 'content';
      add(section, value);
    }
    return fields;
  }
  const heading = ['moa', 'joint', 'joint_memo', 'executive', 'addressing'].find((id) => labels.has(id))!;
  for (const [key, value] of Object.entries(session.formData ?? {})) {
    if (typeof value !== 'string') continue;
    const section = /^(class|cui|customClassification|derivedFrom|declassifyOn|pocEmail)/i.test(key) ? 'classification'
      : /^(department|unit|seal|letterhead|inReplyTo)/.test(key) ? 'letterhead'
        : /^(sig|byDirection|officeCode|complimentaryClose|endorsement(Sig|Body|From|To|Date|Serial))/.test(key) ? (labels.has('signature') ? 'signature' : heading)
          : /^(basicLetter|endorsementOrdinal)/.test(key) ? 'basic'
            : /^(font|page|starting|docType)/.test(key) ? 'type'
              : key === 'body' ? 'body' : heading;
    add(section, value);
  }
  add('body', session.paragraphs);
  add('references', session.references);
  add('enclosures', session.enclosures);
  add('copyto', session.copyTos);
  add('distribution', session.distributions);
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
