import type { DocumentSnapshot } from '@/stores/historyStore';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { documentTextFields, type DocumentTextField, type FieldPath } from './documentFields';
import { referenceStartIndex } from './endorsement';
import { referenceLetterAt } from './referenceLetters';
import { maskProtectedRanges, protectedCodeRanges } from './protectedCodeRanges';

export type ReferenceSource = Pick<DocumentSnapshot,
  'documentMode' | 'documentCategory' | 'docType' | 'formData' | 'references' | 'paragraphs' | 'copyTos' | 'distributions'>;
export interface Citation { start: number; end: number; letter: string }
export interface CitationScan { citations: Citation[]; issues: string[] }
export interface ReferenceChange {
  readonly references: ReferenceSource['references'];
  readonly order: readonly number[];
  readonly changes: readonly { label: string; before: string; after: string }[];
  readonly blockers: readonly string[];
  readonly notes: readonly string[];
  readonly advisories: readonly string[];
  readonly changed: boolean;
  readonly patch: Partial<ReferenceSource>;
}

/** Only explicit, parenthesized ref/reference clauses are editable. A bare (a)
 * is also a paragraph designator, so it is never evidence of a citation. */
export function scanReferenceCitations(text: string): CitationScan {
  const citations: Citation[] = [];
  const issues: string[] = [];
  const protectedSpans = protectedCodeRanges(text);
  const outsideCode = maskProtectedRanges(text, protectedSpans);
  for (const match of outsideCode.matchAll(/"[^"]*(?:"|$)|“[^”]*(?:”|$)|‘(?:[^’]|’(?=[\p{L}\p{M}\p{N}_]))*(?:’|$)|(?:https?:\/\/|mailto:)\S+|(?:^|\n)\s*>[^\n]*/giu)) {
    protectedSpans.push([match.index, match.index + match[0].length]);
  }
  for (const match of outsideCode.matchAll(/(?<![\p{L}\p{M}\p{N}_])'(?:[^']|'(?=[\p{L}\p{M}\p{N}_]))*(?:'|$)/gu)) protectedSpans.push([match.index, match.index + match[0].length]);
  const prefix = /\b(?:references?|refs?\.?)\s*(?=\(|[a-z])/gi;
  for (const match of text.matchAll(prefix)) {
    let cursor = match.index + match[0].length;
    const first = /^\(\s*([a-z][a-z0-9]*)\s*\)/i.exec(text.slice(cursor));
    if (!first) {
      if (text[cursor] === '(' || /^[a-z](?:\d+)?(?:\s|[.,;:]|$)/i.test(text.slice(cursor))) {
        issues.push('Use explicit citations such as reference (a); review this unsupported citation clause.');
      }
      continue;
    }
    let token: RegExpExecArray | null = first;
    while (token) {
      const start = cursor + token[0].indexOf(token[1]);
      if (protectedSpans.some(([from, to]) => match.index >= from && match.index < to || start >= from && start < to)) {
        issues.push('A citation occurs in quoted text, code, or a URL. Review it manually before changing reference letters.');
      } else citations.push({ start, end: start + token[1].length, letter: token[1].toLowerCase() });
      cursor += token[0].length;
      const suffix = text.slice(cursor);
      if (/^\s*(?:[-–—]|through\b|to\b)\s*(?:\(|[a-z](?:\d+)?\b)/i.test(suffix)) {
        issues.push('A reference range needs manual review. Expand it into individual citations before changing reference letters.');
        break;
      }
      const separator = /^(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|&)\s+)(?=\()/i.exec(suffix);
      if (!separator) {
        if (/^\s*(?:(?:[,;]|and\b|or\b|&)\s*(?:\(|[a-z](?:\d+)?\b)|\([a-z][a-z0-9]*\))/i.test(suffix)) {
          issues.push('A reference list has unsupported separators or unparenthesized labels. Use explicit individual citations before changing reference letters.');
        }
        break;
      }
      cursor += separator[0].length;
      token = /^\(\s*([a-z][a-z0-9]*)\s*\)/i.exec(text.slice(cursor));
      if (!token) issues.push('A reference list contains an unsupported label. Review it before changing reference letters.');
    }
  }
  return { citations, issues: [...new Set(issues)] };
}

function canTrackReferenceCitations(source: ReferenceSource): boolean {
  return source.documentCategory === 'correspondence'
    && !['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(source.docType)
    && Object.hasOwn(DOC_TYPE_CONFIG, source.docType);
}

export function canReviewReferenceOrder(source: ReferenceSource): boolean {
  return canTrackReferenceCitations(source)
    && (source.documentMode === 'custom' || DOC_TYPE_CONFIG[source.docType].compliance.allowReferences);
}

function citationFields(source: ReferenceSource): readonly DocumentTextField[] {
  // Reference titles and URLs identify external sources, not citations to this
  // letter's list. Unknown legacy fields are inspected but never transformed.
  return documentTextFields(source, 'draft').filter(field => field.path[0] !== 'references'
    && (field.role === 'text' || field.role === 'unknown')).map(field =>
      field.path[0] === 'formData' && field.path[1] === 'via' ? { ...field, label: 'Via' } : field);
}
function bodyField(field: DocumentTextField): boolean {
  return field.path[0] === 'paragraphs' && ['text', 'header'].includes(String(field.path[2]));
}
function editableField(field: DocumentTextField): boolean {
  return field.role === 'text' && (bodyField(field)
    || field.path[0] === 'copyTos' && field.path[2] === 'text'
    || field.path[0] === 'distributions' && field.path[2] === 'text'
    || field.path[0] === 'formData' && field.path[1] === 'via');
}
function inherited(letter: string, offset: number): boolean {
  return /^[a-z]$/.test(letter) && letter.charCodeAt(0) - 97 < offset;
}
function replaceAtPath<T extends object>(source: T, path: FieldPath, text: string): T {
  const result = (Array.isArray(source) ? [...source] : { ...source }) as T;
  const input = source as Record<string | number, unknown>;
  const output = result as Record<string | number, unknown>;
  const [key, ...rest] = path;
  output[key] = rest.length ? replaceAtPath(input[key] as object, rest, text) : text;
  return result;
}

/** Reletter retained source indices and rewrite every supported occurrence in
 * one patch. A blocker makes the whole operation unavailable, never partial. */
export function planReferenceChange(source: ReferenceSource, order: readonly number[],
  offset = referenceStartIndex(source.docType, source.formData.startingReferenceLetter)): ReferenceChange {
  const blockers: string[] = [];
  if (new Set(order).size !== order.length || order.some(index => !Number.isInteger(index) || !source.references[index])) {
    blockers.push('The reference selection is invalid. Review the current list again.');
  }
  const references = order.flatMap((index, position) => source.references[index]
    ? [{ ...source.references[index], letter: referenceLetterAt(position + offset) }] : []);
  const mapping = new Map(order.map((index, position) => [source.references[index]?.letter.toLowerCase(), references[position]?.letter]));
  const oldLabels = source.references.map(ref => ref.letter.toLowerCase());
  if (new Set(oldLabels).size !== oldLabels.length || oldLabels.some(letter => !/^[a-z][a-z0-9]*$/.test(letter))) {
    blockers.push('Reference labels are duplicated or unsupported. Correct the list before changing its order.');
  }
  const changed = references.length !== source.references.length || order.some((index, position) => index !== position)
    || references.some((ref, index) => ref.letter !== source.references[index]?.letter);
  const changes: { label: string; before: string; after: string }[] = [];
  const advisories: string[] = [];
  let patch: Partial<ReferenceSource> = { references };
  // Hidden formal lists remain part of the draft. A later type/mode switch
  // must restore the same citation targets, including endorsement offsets.
  if (changed && canTrackReferenceCitations(source)) {
    const oldOffset = referenceStartIndex(source.docType, source.formData.startingReferenceLetter);
    for (const field of citationFields(source)) {
      const scan = scanReferenceCitations(field.text);
      blockers.push(...scan.issues.map(issue => `${field.label}: ${issue}`));
      for (const marker of field.text.matchAll(/\(\s*([a-z][a-z0-9]*)\s*\)/gi)) {
        const start = marker.index + marker[0].indexOf(marker[1]);
        if (scan.citations.some(citation => citation.start === start)) continue;
        const before = field.text.slice(0, marker.index);
        if (/(?:paragraphs?|paras?\.?|subparagraphs?|sections?|enclosures?|portions?)\s*$/i.test(before)) continue;
        if (/(?:https?:\/\/|mailto:)\S*$/i.test(before)) continue;
        const label = marker[1].toLowerCase();
        if (inherited(label, oldOffset) && references.some(ref => ref.letter === label)) {
          blockers.push(`${field.label}: bare (${marker[1]}) may cite an inherited reference that would overlap the new local sequence. Identify its target before changing reference letters.`);
        }
        if (oldLabels.includes(marker[1].toLowerCase()) || /^(?:[a-z]{1,2}|a\d+)$/i.test(marker[1]) && !inherited(marker[1].toLowerCase(), oldOffset)) {
          advisories.push(`${field.label}: bare (${marker[1]}) is not rewritten. Check whether it cites a reference. If it does, write an explicit reference (${marker[1]}) citation and review again.`);
        }
      }
      let after = field.text;
      for (const citation of [...scan.citations].reverse()) {
        const local = oldLabels.includes(citation.letter);
        const next = mapping.get(citation.letter);
        if (!local && inherited(citation.letter, oldOffset)) {
          if (references.some(ref => ref.letter === citation.letter)) blockers.push(`${field.label}: inherited reference (${citation.letter}) would overlap the new local sequence. Keep inherited and local letters separate.`);
          continue;
        }
        if (!local) { blockers.push(`${field.label}: reference (${citation.letter}) is not in this list. Identify its target before changing reference letters.`); continue; }
        if (!next) { blockers.push(`${field.label}: reference (${citation.letter}) is still cited. Remove or replace that citation before deleting its reference.`); continue; }
        if (next === citation.letter) continue;
        if (!editableField(field)) { blockers.push(`${field.label}: a citation is outside the supported body, Via, Copy to, or distribution fields. Review it manually before changing reference letters.`); continue; }
        const replacement = field.text.slice(citation.start, citation.end) === citation.letter.toUpperCase() ? next.toUpperCase() : next;
        after = after.slice(0, citation.start) + replacement + after.slice(citation.end);
      }
      if (after !== field.text) {
        changes.push({ label: field.label, before: field.text, after });
        const current = { ...source, ...patch };
        const updated = replaceAtPath(current, field.path, after);
        const root = field.path[0] as keyof ReferenceSource;
        patch = { ...patch, [root]: updated[root] };
      }
    }
  }
  return { references, order: [...order], changes, blockers: [...new Set(blockers)], notes: [], advisories: [...new Set(advisories)], changed, patch };
}

/** First appearances are read in body order, heading before paragraph text.
 * Routing annotations do not determine order; uncited sources remain at end. */
export function planFirstCitationOrder(source: ReferenceSource): ReferenceChange {
  const order: number[] = [];
  const blockers: string[] = [];
  const offset = referenceStartIndex(source.docType, source.formData.startingReferenceLetter);
  const fields = citationFields(source).filter(bodyField).sort((a, b) => Number(a.path[1]) - Number(b.path[1])
    || (a.path[2] === 'header' ? -1 : b.path[2] === 'header' ? 1 : 0));
  for (const field of fields) {
    const scan = scanReferenceCitations(field.text);
    blockers.push(...scan.issues.map(issue => `${field.label}: ${issue}`));
    for (const citation of scan.citations) {
      const index = source.references.findIndex(ref => ref.letter.toLowerCase() === citation.letter);
      if (index < 0) {
        if (!inherited(citation.letter, offset)) blockers.push(`${field.label}: reference (${citation.letter}) is not in this list. Identify its target first.`);
      } else if (!order.includes(index)) order.push(index);
    }
  }
  const uncited = source.references.map((_, index) => index).filter(index => !order.includes(index));
  const plan = planReferenceChange(source, [...order, ...uncited]);
  if (!canReviewReferenceOrder(source)) blockers.push('First-citation review is available for correspondence types that use references.');
  return { ...plan, blockers: [...new Set([...blockers, ...plan.blockers])],
    notes: uncited.length ? [`Not cited in the body: ${uncited.map(index => `(${source.references[index].letter})`).join(', ')}. These stay at the end in their current relative order; review whether they belong.`] : [] };
}
