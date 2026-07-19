/**
 * Best-effort parser: the text lines of an existing naval letter → the fields
 * DonDocs' editor holds. It reverses the format the app renders — the SECNAV
 * M-5216.5 header block (From/To/Via/Subj/Ref/Encl), the identification symbols
 * (SSIC / serial / date), the numbered-paragraph tree, and the signature name.
 *
 * It is deliberately forgiving and never throws: a letter that doesn't follow
 * the format yields whatever fields were recognizable (often just the body),
 * and the import flow shows the result for review before anything is written.
 * Pure and leaf so it can be exhaustively unit-tested against line fixtures,
 * independent of how those lines were extracted (PDF today, DOCX later).
 */

import type { PortionMarking } from '@/types/document';

export interface ParsedLetter {
  ssic?: string;
  serial?: string;
  date?: string;
  from?: string;
  to?: string;
  via?: string;
  subject?: string;
  /** Reference titles in order; the letter (a),(b)… is re-assigned by the store. */
  references: string[];
  /** Enclosure titles in order; numbering is positional in the store. */
  enclosures: string[];
  /** "Copy to" recipients, one per entry. */
  copyTos: string[];
  paragraphs: { text: string; level: number; portionMarking?: PortionMarking }[];
  signature?: { first: string; middle: string; last: string };
}

// The labels that open a header field. Longer/aliased spellings first so
// "Subject" matches before a naive "Subj" prefix test would.
const HEADER_LABELS: { key: 'from' | 'to' | 'via' | 'subject' | 'ref' | 'encl'; re: RegExp }[] = [
  { key: 'from', re: /^from\s*:/i },
  { key: 'to', re: /^to\s*:/i },
  { key: 'via', re: /^via\s*:/i },
  { key: 'subject', re: /^subj(?:ect)?\s*:/i },
  { key: 'ref', re: /^ref(?:erence)?\s*:/i },
  { key: 'encl', re: /^encl(?:osure)?\s*:/i },
];

// A line that ends the letter body — the trailing blocks the editor holds
// separately (Copy to / Distribution) must not be swept in as paragraphs.
const BODY_TERMINATORS = /^(copy\s*to|distribution|blind\s*copy|bcc)\s*:/i;

/** Strip the "Label:" prefix, returning the value on that line. */
function afterColon(line: string): string {
  const i = line.indexOf(':');
  return i === -1 ? '' : line.slice(i + 1).trim();
}

/** Which header label (if any) this line opens. */
function headerLabelOf(line: string): (typeof HEADER_LABELS)[number]['key'] | null {
  for (const label of HEADER_LABELS) if (label.re.test(line)) return label.key;
  return null;
}

// Paragraph label → SECNAV nesting level (Ch 7 ¶13a): 1. / a. / (1) / (a) / …
// Order matters — (1) must be tested before 1. so a paren item isn't read as
// arabic. `text` is the paragraph with its label stripped.
const PARAGRAPH_LABELS: { level: number; re: RegExp }[] = [
  { level: 3, re: /^\(([a-z])\)\s+(.*)$/ }, // (a)
  { level: 2, re: /^\((\d+)\)\s+(.*)$/ }, // (1)
  { level: 1, re: /^([a-z])\.\s+(.*)$/ }, // a.
  { level: 0, re: /^(\d+)\.\s+(.*)$/ }, // 1.
];

// The body of a naval letter always opens at a top-level arabic paragraph
// ("1."). A "(b)" or "a." at the start of a line inside the header is a Ref/
// Encl list marker, not the body — so only "N." ends the header block.
const BODY_START_RE = /^\d+\.\s+/;

// A portion mark leads the paragraph text after its number label, per SECNAV
// M-5216.5 / DoDM 5200.01: "1.  (S) The text…". Captured so an imported
// classified letter keeps its per-paragraph markings, not just the banner.
const PORTION_MARK_RE = /^\((U|CUI|FOUO|C|S|TS)\)\s+(.*)$/;

/** Peel a leading "(S)" portion mark off paragraph text, if present. */
function splitPortionMark(text: string): { text: string; portionMarking?: PortionMarking } {
  const m = text.match(PORTION_MARK_RE);
  return m ? { portionMarking: m[1] as PortionMarking, text: m[2] } : { text };
}

/** If the line opens a numbered paragraph, its level, text, and portion mark. */
function paragraphStartOf(
  line: string
): { level: number; text: string; portionMarking?: PortionMarking } | null {
  const trimmed = line.trim();
  for (const { level, re } of PARAGRAPH_LABELS) {
    const m = trimmed.match(re);
    if (m) return { level, ...splitPortionMark(m[2]) };
  }
  return null;
}

// Split a Ref/Encl value into its items. The list may run inline
// ("(a) Foo (b) Bar") or across lines, each item marked "(a)" / "(1)".
function splitLabeledItems(raw: string): string[] {
  const items = raw
    .split(/\((?:[a-z]|\d+)\)/i)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return items;
}

// Initials + SURNAME, e.g. "R. L. SMITH" or "P. W. McNALLY" (prefix surnames
// keep their internal capital). Rank/title are never on this line (SECNAV ¶14a).
const SIGNATURE_RE = /^([A-Z])\.\s*(?:([A-Z])\.\s*)?([A-Z][A-Za-z']+)$/;

function parseSignature(line: string): ParsedLetter['signature'] | null {
  const m = line.trim().match(SIGNATURE_RE);
  if (!m) return null;
  // Two-initial form → first, middle, last. One-initial form → first, last.
  return m[2]
    ? { first: m[1], middle: m[2], last: m[3] }
    : { first: m[1], middle: '', last: m[3] };
}

// SSIC: a standalone 4–5 digit code (optionally with a subcode like 5216.5).
const SSIC_RE = /^\d{4,5}(?:\.\d+)?$/;
// Serial: "Ser 1710/024", "Ser 024", or a bare "1710/024".
const SERIAL_RE = /^(?:ser\s+)?(\d+(?:\/\d+)?)$/i;
// Military date "4 Jan 26" / "15 January 2025", or "January 4, 2026".
const DATE_RE =
  /^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/;

/**
 * Parse the identification block (SSIC / serial / date) that sits above the
 * "From:" line. Scans only the pre-header region so a number inside the body
 * can't be mistaken for an SSIC.
 */
function parseIdentification(preHeader: string[]): Pick<ParsedLetter, 'ssic' | 'serial' | 'date'> {
  const out: Pick<ParsedLetter, 'ssic' | 'serial' | 'date'> = {};
  // The block prints top-to-bottom as SSIC, serial, date. Claim the SSIC line
  // first; the next number is the serial *by position*, even when it is itself
  // four digits (DonDocs prints a bare "0042", not "Ser 0042") — which a
  // shape-only test would otherwise reject as another SSIC.
  for (const raw of preHeader) {
    const line = raw.trim();
    if (!line) continue;
    if (!out.ssic && SSIC_RE.test(line)) {
      out.ssic = line;
      continue;
    }
    if (!out.serial) {
      const m = line.match(SERIAL_RE);
      if (m) {
        out.serial = m[1];
        continue;
      }
    }
    if (!out.date && DATE_RE.test(line)) out.date = line;
  }
  return out;
}

export function parseNavalLetter(rawText: string): ParsedLetter {
  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');

  const result: ParsedLetter = { references: [], enclosures: [], copyTos: [], paragraphs: [] };

  // ── 1. Header block (first From:/To:/…: line onward) ──
  // With no recognizable header the whole document is body; bodyStart = 0 and
  // the header loop is skipped, but paragraphs and the signature are still read.
  const firstHeaderIdx = lines.findIndex((l) => headerLabelOf(l) !== null);
  let bodyStart = firstHeaderIdx === -1 ? 0 : lines.length;

  if (firstHeaderIdx !== -1) {
    Object.assign(result, parseIdentification(lines.slice(0, firstHeaderIdx)));

    // Walk the header, accumulating each field's value across continuation lines.
    const fields: Record<string, string[]> = {};
    let current: string | null = null;

    for (let i = firstHeaderIdx; i < lines.length; i++) {
      const line = lines[i];
      const label = headerLabelOf(line);
      if (label) {
        current = label;
        fields[label] = [afterColon(line)];
        continue;
      }
      // The first top-level "N." paragraph ends the header and starts the body.
      // (A "(b)"/"a." line here is a Ref/Encl list item, not the body.)
      if (current && BODY_START_RE.test(line.trim())) {
        bodyStart = i;
        break;
      }
      // Blank lines don't close a field (values may wrap); non-label content
      // continues the current field.
      if (!line.trim()) continue;
      if (current) fields[current].push(line.trim());
    }

    const joinField = (key: string) =>
      (fields[key] ?? []).map((s) => s.trim()).filter(Boolean).join(' ').trim() || undefined;

    result.from = joinField('from');
    result.to = joinField('to');
    result.subject = joinField('subject');
    // Via is one addressee per line — the generator re-adds the "(1)/(2)"
    // numbering, so strip the source's markers and store newline-separated,
    // never a single "(1) X (2) Y" line that would render un-numbered.
    if (fields.via) {
      const vias = splitLabeledItems(fields.via.join(' '));
      result.via = vias.length ? vias.join('\n') : undefined;
    }
    if (fields.ref) result.references = splitLabeledItems(fields.ref.join(' '));
    if (fields.encl) result.enclosures = splitLabeledItems(fields.encl.join(' '));
  }

  // ── 2. Body paragraphs + signature (always, header or not) ──
  result.paragraphs = collectParagraphs(lines, bodyStart);
  result.signature = findSignature(lines, bodyStart) ?? undefined;
  result.copyTos = parseCopyTo(lines);

  return result;
}

// A trailing block that isn't Copy to — ends the copy-to recipient list.
const OTHER_TRAILING_BLOCK = /^(distribution|blind\s*copy|bcc)\s*:/i;

/**
 * Collect the "Copy to" recipients — one per line — from the trailing block,
 * so an imported letter keeps its copy-to list instead of dropping it. The
 * block sits after the signature; entries run until a blank line, the next
 * trailing block (Distribution/BCC), a header label, or EOF.
 */
function parseCopyTo(lines: string[]): string[] {
  const start = lines.findIndex((l) => /^copy\s*to\s*:/i.test(l.trim()));
  if (start === -1) return [];
  const recipients: string[] = [];
  const first = afterColon(lines[start]).trim();
  if (first) recipients.push(first); // "Copy to: Foo" on the label line
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break; // a blank line closes the list
    if (OTHER_TRAILING_BLOCK.test(line) || headerLabelOf(line) || parseSignature(line)) break;
    recipients.push(line);
  }
  return recipients;
}

/**
 * Collect numbered paragraphs from `start` to the signature/terminator/EOF.
 * A line without a label continues the current paragraph (wrapped text);
 * levels are emitted as-is and the store clamps any illegal jump.
 */
function collectParagraphs(lines: string[], start: number): ParsedLetter['paragraphs'] {
  const paras: ParsedLetter['paragraphs'] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (BODY_TERMINATORS.test(line.trim())) break;
    if (parseSignature(line)) break; // reached the signature block
    const p = paragraphStartOf(line);
    if (p) {
      paras.push({ text: p.text.trim(), level: p.level, ...(p.portionMarking && { portionMarking: p.portionMarking }) });
    } else if (line.trim() && paras.length > 0) {
      // Continuation of the paragraph above — rejoin the wrapped line.
      paras[paras.length - 1].text = `${paras[paras.length - 1].text} ${line.trim()}`.trim();
    }
  }
  return paras;
}

/** The last signature-shaped line at/after `bodyStart` (the closing signer). */
function findSignature(lines: string[], bodyStart: number): ParsedLetter['signature'] | null {
  for (let i = lines.length - 1; i >= bodyStart; i--) {
    const sig = parseSignature(lines[i]);
    if (sig) return sig;
  }
  return null;
}
