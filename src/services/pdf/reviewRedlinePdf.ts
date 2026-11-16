import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { compareText, type TextSegment } from '@/lib/textChanges';
import { REVIEW_FONT, assertRedlineGlyphs, drawReviewUnicodeLine } from './reviewUnicodeLine';
import type { reviewDecisionSummaryPdfContent } from '@/lib/reviewDecisionSummary';

export type RedlineContent = ReturnType<typeof reviewDecisionSummaryPdfContent>;
export interface RedlineRun { text: string; style?: 'delete' | 'insert' }
export interface RedlineMark { start: number; end: number; style: 'delete' | 'insert' }
export interface RedlineBlock { text: string; runs?: RedlineRun[]; role: 'title' | 'heading' | 'label' | 'text'; tone?: 'insert' | 'delete' | 'move' }
export interface RedlineLine extends RedlineBlock { x: number; y: number; size: number; width: number; marks: RedlineMark[] }
export const REDLINE_LIMITS = { characters: 2_000_000, lineCharacters: 1_024, pages: 250, bytes: 40_000_000, rasterPixels: 60_000_000 } as const;
const PAGE = { width: 612, height: 792, margin: 42, top: 734, bottom: 58 };


/** Reuse the bounded word comparison, expanding changed marks to full graphemes. */
export function inlineRedlineRuns(before: string, after: string): RedlineRun[] {
  const diff = compareText(before, after);
  const wholeCharacters = (text: string, segments: TextSegment[]) => {
    let offset = 0;
    const changed = segments.flatMap(part => { const start = offset;offset += part.text.length;return part.changed ? [{ start, end: offset }] : []; });
    const result: TextSegment[] = [];let active = 0;
    for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      while (active < changed.length && changed[active].end <= index) active++;
      const value = active < changed.length && changed[active].start < index + segment.length;
      if (result.at(-1)?.changed === value) result.at(-1)!.text += segment;else result.push({ text: segment, changed: value });
    }
    return result;
  };
  const left = wholeCharacters(before, diff.before), right = wholeCharacters(after, diff.after), runs: RedlineRun[] = [];
  let a = 0, b = 0, ai = 0, bi = 0;
  while (a < left.length || b < right.length) {
    if (left[a]?.changed) { runs.push({ text: left[a].text, style: 'delete' });a++;ai = 0;continue; }
    if (right[b]?.changed) { runs.push({ text: right[b].text, style: 'insert' });b++;bi = 0;continue; }
    if (!left[a] || !right[b]) return [{ text: before, style: 'delete' }, { text: after, style: 'insert' }];
    const count = Math.min(left[a].text.length - ai, right[b].text.length - bi);
    const text = left[a].text.slice(ai, ai + count);
    if (text !== right[b].text.slice(bi, bi + count)) return [{ text: before, style: 'delete' }, { text: after, style: 'insert' }];
    runs.push({ text });ai += count;bi += count;
    if (ai === left[a].text.length) { a++;ai = 0; }if (bi === right[b].text.length) { b++;bi = 0; }
  }
  return runs;
}

export function redlineBlocks(data: RedlineContent): RedlineBlock[] {
  const blocks: RedlineBlock[] = [];
  const add = (text: string, role: RedlineBlock['role'] = 'text', tone?: RedlineBlock['tone']) => blocks.push({ text, role, ...(tone ? { tone } : {}) });
  add('REVIEW COPY - Proposed edits and decisions', 'title');
  add(data.roundLabel, 'heading');
  add(`Captured: ${data.capturedAt}\nRound state: ${data.roundStatus}\nBaseline SHA-256: ${data.baselineDigest}\nCaptured draft SHA-256: ${data.currentDigest}`);
  add('Review derivative. Clean PDF output is separate. Reviewer labels are self-entered, not verified identities. This is not approval evidence. Only captured local feedback is included; later edits and unimported returns are excluded. Attached images and PDF contents are not reproduced.');
  add('Legend', 'heading');
  add('Struck text = deletion. Underlined text = insertion. Inline redlines compare reviewed baseline to reviewer intent; the captured current draft is shown separately.\n[-] DELETE / BEFORE: reviewed text removed or replaced.\n[+] INSERT / PROPOSED: reviewer text, not necessarily accepted.\n[=] CURRENT: captured draft value.\n[>] MOVE: stable paragraph identities change position; automatic numbering is separate.\nSplit / join: exact captured paragraph restructuring.\nACCEPTED, REJECTED, OPEN and CONFLICTING are decision states; color is supplementary. Accepted results are historical.');
  add(`Accepted: ${data.counts.accepted} | Rejected: ${data.counts.rejected} | Open: ${data.counts.open} | Conflicting: ${data.counts.conflicting}`);
  for (const text of [...data.customMarkings, ...data.notices]) add(text);
  add('Suggested edits and retained decisions', 'heading');
  if (!data.items.length) add('No suggested edits retained for this round.');
  data.items.forEach((item, i) => {
    add(`Item ${i + 1}: ${item.label}`, 'heading');
    add(`${item.status.toUpperCase()}${item.acceptedCurrentChanged ? ' - accepted earlier; current draft changed' : ''} | ${item.category} | Reviewer: ${item.author}`, 'label');
    add(`Source: ${item.origin.kind}${item.origin.rule ? ` / ${item.origin.rule}` : ''}`);
    if (item.origin.context) add(item.origin.context);
    for (const change of item.changes) {
      const move = change.kind === 'move-paragraph';
      const action = move ? 'MOVE' : change.kind === 'split-paragraph' ? 'SPLIT' : change.kind === 'join-paragraphs' ? 'JOIN' : !change.baseline ? 'INSERT' : !change.proposed ? 'DELETE' : 'REPLACE';
      add(`${move ? '[>] ' : ''}${action} - ${change.label}`, 'label', move ? 'move' : undefined);
      if (change.reconciliation && change.reconciliation !== 'unchanged') add(`Reconciliation at capture: ${change.reconciliation.replaceAll('-', ' ')}`);
      if (!move) {
        add(change.kind === 'split-paragraph' ? 'SPLIT boundary: the paragraph break below is proposed.' : change.kind === 'join-paragraphs' ? 'JOIN boundary: the reviewed paragraph break is removed.' : 'Inline redline - strike = deletion; underline = insertion', 'label');
        const runs = inlineRedlineRuns(change.baseline, change.proposed).map(run =>
          (change.kind === 'split-paragraph' || change.kind === 'join-paragraphs') && run.style
            ? { ...run, text: run.text.replace(/\n\n/g, ' [PARAGRAPH BREAK] \n\n') } : run);
        if (change.context !== undefined && change.range) {
          runs.unshift({ text: change.context.slice(0, change.range.start) });runs.push({ text: change.context.slice(change.range.end) });
        }
        blocks.push({ text: runs.map(run => run.text).join(''), role: 'text', runs });
      }
      if (change.context !== undefined) { add('Reviewed paragraph context', 'label');add(change.context); }
      add(move ? '[>] BEFORE - Reviewed paragraph order' : '[-] DELETE / BEFORE - Reviewed baseline', 'label', move ? 'move' : 'delete');add(change.baseline || '(Empty)', 'text', move ? 'move' : 'delete');
      add('[=] CURRENT - Captured current value', 'label');add(change.current ?? '(Target unavailable or structurally changed; no match inferred)');
      add(move ? '[>] PROPOSED - Reviewer paragraph order' : '[+] INSERT / PROPOSED - Reviewer proposal', 'label', move ? 'move' : 'insert');add(change.proposed || '(Empty)', 'text', move ? 'move' : 'insert');
      if (move) add('Movement shows paragraph order, not deleted/reinserted identities or automatic renumbering.', 'text', 'move');
      if (change.accepted !== undefined) { add('ACCEPTED result at decision', 'label');add(change.accepted || '(Empty)'); }
    }
    add('Retained decision history', 'label');
    if (!item.history.length) add('No decision recorded.');
    for (const entry of item.history) {
      add(`${entry.action.toUpperCase()} - ${entry.at}`);
      for (const resolution of entry.resolutions) { if (resolution.context !== undefined) { add('Retained resolution paragraph context', 'label');add(resolution.context); } add('Current before manual resolution', 'label');add(resolution.before || '(Empty)');add('Accepted manual resolution', 'label');add(resolution.accepted || '(Empty)'); }
    }
  });
  add('Baseline to captured draft comparison', 'heading');
  add('Stable paragraph identities align across positions. Movement and text changes are separate from automatic numbering. Other repeated rows may be positional. This comparison records current work, not a decision on an open proposal.');
  if (!data.comparison.length) add('No field or body differences.');
  for (const change of data.comparison) { add(change.field, 'label');add('[-] BEFORE', 'label', 'delete');add(change.before || '(Empty)', 'text', 'delete');add('[=] CURRENT', 'label');add(change.after || '(Empty)'); }
  add('Captured discussions', 'heading');
  if (!data.discussions.length) add('No discussions retained.');
  for (const thread of data.discussions) {
    add(`${thread.version}: ${thread.target}`, 'label');add(`${thread.status} | ${thread.category}`);
    if (thread.context !== undefined) { add('Retained comment context', 'label');add(thread.context); }
    if (thread.current !== undefined) { add('Target in captured version', 'label');add(thread.current); }
    for (const message of thread.messages) { add(`${message.author} - ${message.createdAt}${message.editedAt ? ` / edited ${message.editedAt}` : ''}`, 'label');add(message.text); }
  }
  if (blocks.reduce((sum, b) => sum + b.text.length, 0) > REDLINE_LIMITS.characters) throw new Error('This redline exceeds the 2 million character review limit. Export a smaller review round.');
  return blocks;
}

/** Keep every source character, whitespace and complete grapheme across wrapping. */
export function wrapRedlineText(text: string, width: number, measure: (text: string) => number): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const directional = text.split('\n').flatMap(paragraph => {
    const groups: string[] = [];let previous: boolean | undefined;
    for (const { segment } of segmenter.segment(paragraph)) {
      const strong = /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(segment);
      const rtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(segment);
      if (!groups.length || strong && previous !== undefined && rtl !== previous) groups.push('');
      groups[groups.length - 1] += segment;if (strong) previous = rtl;
    }
    return groups.length ? groups : [''];
  });
  return directional.flatMap(paragraph => {
    if (!paragraph) return [''];
    const result: string[] = [];
    let line = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      // Zero-advance text can grow forever without reaching the width limit.
      // Bound each shaping input before canvas measures it; keep the exact text
      // in the source and offer the existing lossless HTML export instead.
      if (line.length + segment.length > REDLINE_LIMITS.lineCharacters) throw new Error('A line exceeds the PDF character shaping limit. Use the decision summary HTML to preserve this text.');
      if (measure(segment) > width) throw new Error('A character cluster is too wide for this PDF. Shorten the affected value.');
      if (line && measure(line + segment) > width) {
        const spaces = Array.from(line.matchAll(/\s+/g));
        const last = spaces.at(-1), at = last ? last.index! + last[0].length : 0;
        if (at > 0) { result.push(line.slice(0, at));line = line.slice(at); }
        if (line && measure(line + segment) > width) { result.push(line);line = ''; }
      }
      line += segment;
    }
    result.push(line);return result;
  });
}

export function layoutRedline(blocks: RedlineBlock[], measure: (text: string, size: number) => number): RedlineLine[][] {
  const pages: RedlineLine[][] = [[]];let y = PAGE.top;
  for (const block of blocks) {
    const size = block.role === 'title' ? 17 : block.role === 'heading' ? 13 : 10;
    const leading = size + 5;
    const lines = wrapRedlineText(block.text, PAGE.width - PAGE.margin * 2 - 10, text => measure(text, size));
    // Keep a section heading and at least its following line together.
    if (y - (block.role === 'heading' || block.role === 'label' ? leading * 2 : leading) < PAGE.bottom) { pages.push([]);y = PAGE.top; }
    let offset = 0;
    for (const text of lines) {
      if (y - leading < PAGE.bottom) { pages.push([]);y = PAGE.top; }
      if (pages.length > REDLINE_LIMITS.pages) throw new Error('This redline exceeds 250 pages. Export a smaller review round.');
      let runOffset = 0;
      const marks = (block.runs ?? []).flatMap(run => {
        const start = runOffset;runOffset += run.text.length;
        return run.style && start < offset + text.length && runOffset > offset ? [{ start: Math.max(start - offset, 0), end: Math.min(runOffset - offset, text.length), style: run.style }] : [];
      });
      pages.at(-1)!.push({ ...block, text, x: PAGE.margin + 5, y, size, width: measure(text, size), marks });y -= leading;
      offset += text.length;if (block.text[offset] === '\n') offset++;
    }
    y -= block.role === 'heading' ? 8 : 5;
  }
  return pages;
}

/** Browser shaping embeds readable script appearances and searchable grapheme
 * mappings. No network fonts, source-document rendering state or live recapture. */
export async function generateReviewRedlinePdf(data: RedlineContent, cancelled: () => boolean = () => false): Promise<Uint8Array> {
  const assertActive = () => { if (cancelled()) throw new Error('Redline PDF preparation cancelled.'); };
  assertActive();
  const blocks = redlineBlocks(data);
  if (blocks.some(block => Array.from(block.text).some(char => {
    const point = char.codePointAt(0)!;return point < 32 && point !== 10 || point >= 127 && point <= 159;
  }))) throw new Error('This review contains control characters that cannot be rendered faithfully in this PDF. Use the decision summary HTML to retain this text.');
  await document.fonts.ready;assertActive();
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot render the redline PDF. Use a browser with canvas support.');
  const measure = (text: string, size: number) => { context.font = `${size * 2}px ${REVIEW_FONT}`;return context.measureText(text).width / 2; };
  const pdf = await PDFDocument.create();
  pdf.setTitle(`REVIEW COPY - ${data.roundLabel}`);pdf.setSubject('Captured proposed edits, paragraph movement, decisions and discussions');pdf.setCreator('DonDocs');pdf.setLanguage('en');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const widths = new Map(Array.from({ length: 95 }, (_, i) => [String.fromCharCode(i + 32), font.widthOfTextAtSize(String.fromCharCode(i + 32), 1)]));
  const advance = (text: string, size: number) => Array.from(text).reduce((sum, char) => sum + widths.get(char)!, 0) * size;
  const pages = layoutRedline(blocks, (text, size) => /^[\x20-\x7e]*$/.test(text) ? advance(text, size) : measure(text, size));
  assertActive();
  // Reject page overflow before paying for per-grapheme canvas readbacks.
  await assertRedlineGlyphs(blocks.map(block => block.text).join('\n'), canvas, context, cancelled);
  assertActive();
  const colors = { insert: rgb(0, .28, .15), delete: rgb(.55, .08, .08), move: rgb(.1, .2, .5) };
  let rasterPixels = 0;
  for (const [index, lines] of pages.entries()) {
    assertActive();
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    page.drawText('REVIEW COPY - Review derivative', { x: PAGE.margin, y: 766, size: 9, font });
    page.drawText(`Page ${index + 1} of ${pages.length}`, { x: 472, y: 30, size: 9, font });
    // Markings can themselves contain Unicode and are rendered by the same path.
    for (const [n, line] of [...lines, { text: data.marking, role: 'text' as const, x: PAGE.margin, y: 30, size: 8, width: measure(data.marking, 8), marks: [] }].entries()) {
      assertActive();
      if (!line.text) continue;
      // WinAnsi is intentionally limited to ASCII here; other text uses browser shaping.
      if (/^[\x20-\x7e]*$/.test(line.text)) {
        page.drawText(line.text, { x: line.x, y: line.y, size: line.size, font, color: 'tone' in line && line.tone ? colors[line.tone] : rgb(.09, .12, .16) });
        for (const mark of line.marks) {
          const y = line.y + (mark.style === 'delete' ? line.size * .3 : -2);
          page.drawLine({ start: { x: line.x + advance(line.text.slice(0, mark.start), line.size), y }, end: { x: line.x + advance(line.text.slice(0, mark.end), line.size), y }, thickness: .8, color: colors[mark.style] });
        }
        continue;
      }
      rasterPixels += Math.ceil((line.width + 8) * 2) * Math.ceil(line.size * 5);
      if (rasterPixels > REDLINE_LIMITS.rasterPixels) throw new Error('This review contains too much rendered Unicode text for one PDF. Export a smaller review round.');
      await drawReviewUnicodeLine(pdf, page, line.text, line.x, line.y, line.size, canvas, context, `ReviewLine${n}`, line.marks);
    }
    // Yield between pages so cancellation and document switches can invalidate export.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assertActive();const bytes = await pdf.save();assertActive();
  if (bytes.byteLength > REDLINE_LIMITS.bytes) throw new Error('This redline exceeds the 40 MB PDF limit. Export a smaller review round.');
  return bytes;
}
