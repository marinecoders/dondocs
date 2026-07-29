import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { calculateTextPosition } from './extractFormFields';
import { wrapTextForForm } from './textWrap';
import {
  assertFormConfig,
  type FormConfig,
  type FormFieldConfig,
  type FormRows,
  type FormValues,
} from '@/types/formConfig';

// Generic, config-driven form renderer (issue #28 / tier 3). Where the
// per-form generators hardcode their boxes in TypeScript, this one draws any
// form described by a form.json: load the template pages, place each field's
// value into its box by type. Adding a form is data, not code.

const BLACK = rgb(0, 0, 0);
const FONT_SIZE = 9;
const CHECK_MARK = 'X';
const ELLIPSIS = '…';
// Gap left between a single-line value's baseline and the bottom edge of its
// box, so the text rests ON a fill-in rule with descenders (g, y, p) clearing
// it rather than colliding.
const BASELINE_PAD = 3;

/** Hard horizontal bound: text that cannot fit the box even after the
 *  shrink-to-fit pass is truncated with a visible ellipsis, never drawn
 *  past the box edge. The ellipsis makes the cutoff obvious on the page —
 *  silent truncation on an official form would be worse than overflow. */
function fitToWidth(
  text: string,
  fnt: { widthOfTextAtSize(t: string, s: number): number },
  size: number,
  maxWidth: number
): string {
  if (fnt.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fnt.widthOfTextAtSize(text.slice(0, mid) + ELLIPSIS, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ELLIPSIS : text.slice(0, lo).trimEnd() + ELLIPSIS;
}

/** Character-level fallback for lines the word-wrapper cannot break — an
 *  unbroken run (serial number, URL, EDIPI) wider than the box wraps onto
 *  continuation lines instead of being clipped to one. */
function hardWrap(
  line: string,
  fnt: { widthOfTextAtSize(t: string, s: number): number },
  size: number,
  maxWidth: number
): string[] {
  if (fnt.widthOfTextAtSize(line, size) <= maxWidth) return [line];
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (cur && fnt.widthOfTextAtSize(cur + ch, size) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Fetch a template page's bytes. Injectable so tests can read from disk. */
export type PageLoader = (directory: string, page: string) => Promise<Uint8Array>;

const fetchPage: PageLoader = async (directory, page) => {
  const res = await fetch(`/templates/${directory}/${page}`);
  if (!res.ok) throw new Error(`Failed to load template page ${directory}/${page}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const configCache = new Map<string, FormConfig>();

/** Load and validate a form.json from a template directory (cached). */
export async function loadFormConfig(directory: string): Promise<FormConfig> {
  const cached = configCache.get(directory);
  if (cached) return cached;
  const res = await fetch(`/templates/${directory}/form.json`);
  if (!res.ok) throw new Error(`Failed to load form config ${directory}: ${res.status}`);
  const cfg = assertFormConfig(await res.json(), directory);
  configCache.set(directory, cfg);
  return cfg;
}

/**
 * Render a filled form: template pages with each field's value drawn into its
 * box. Checkbox truthy -> a mark; text/date/choice -> (wrapped) text. Signature
 * fields are left blank — they are signed in Acrobat or by a later signature
 * pass, never faked with typed text.
 */
export async function renderFormPdf(
  config: FormConfig,
  values: FormValues,
  rows: FormRows = {},
  loadPage: PageLoader = fetchPage
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  type Page = ReturnType<typeof doc.addPage>;
  type Font = typeof font;

  const pages: Page[] = [];
  for (const pageFile of config.pages) {
    const bytes = await loadPage(config.directory, pageFile);
    const src = await PDFDocument.load(bytes);
    const [copied] = await doc.copyPages(src, [0]);
    pages.push(doc.addPage(copied));
  }

  const drawField = (
    page: Page,
    key: string,
    field: FormFieldConfig,
    value: string | boolean,
    fnt: Font,
    yOffset = 0
  ) => {
    if (field.type === 'signature') return;
    const box = { ...field.box, top: field.box.top - yOffset };

    if (field.type === 'checkbox' || field.type === 'radio') {
      // A checked box or selected radio option gets a centered mark; both
      // boxes are small. (Choice dropdowns fall through — their selected
      // value prints as text.)
      const size = Math.min(box.height - 2, 10);
      const width = fnt.widthOfTextAtSize(CHECK_MARK, size);
      page.drawText(CHECK_MARK, {
        x: box.left + (box.width - width) / 2,
        y: box.top - box.height + (box.height - size) / 2 + 1,
        size,
        font: fnt,
        color: BLACK,
      });
      return;
    }

    const text = String(value);
    const pos = calculateTextPosition({ name: key, ...box }, { left: 3, top: 3 }, FONT_SIZE);
    if (field.multiline) {
      // Word-wrap first, then hard-wrap any line the word-wrapper could not
      // break (unbroken runs with no spaces) so they flow onto continuation
      // lines instead of clipping at line one.
      const lines = wrapTextForForm(text, pos.maxWidth, fnt, FONT_SIZE)
        .flatMap((line) => hardWrap(line, fnt, FONT_SIZE, pos.maxWidth));
      const maxLines = Math.max(1, Math.floor((box.height - 4) / (FONT_SIZE + 2)));
      const visible = lines.slice(0, maxLines);
      // Dropped lines must be visible as a cutoff, not silently vanish.
      if (lines.length > maxLines && visible.length > 0) {
        visible[visible.length - 1] = `${visible[visible.length - 1]} ${ELLIPSIS}`;
      }
      visible.forEach((line, i) => {
        // The wrapper cannot break a single word wider than the box (a long
        // serial number or URL) — clip such lines at the box edge.
        page.drawText(fitToWidth(line, fnt, FONT_SIZE, pos.maxWidth), {
          x: pos.x, y: pos.y - i * (FONT_SIZE + 2), size: FONT_SIZE, font: fnt, color: BLACK,
        });
      });
    } else {
      // Fit the value to the box on BOTH axes. Height caps the type first: a
      // box shorter than the font's ascent cannot hold 9pt text, and letting
      // it overflow is worse here than shrinking — on an official form, text
      // that spills out of its box reads as the neighbouring field's answer.
      // ~3.5% of harvested boxes are under 7pt tall, so this is not a rare path.
      const ascent = fnt.heightAtSize(1, { descender: false }); // em ratio (~0.718 Helvetica)
      // A short box gets proportionally less breathing room than the flat 3pt.
      const pad = Math.min(BASELINE_PAD, box.height * 0.2);
      let size = Math.max(Math.min(FONT_SIZE, (box.height - pad) / ascent), 1);
      // Then shrink for width, keeping the original 5pt floor — but never
      // climb back above the height cap. Past the floor, fitToWidth ellipsizes.
      const floor = Math.min(5, size);
      while (size > floor && fnt.widthOfTextAtSize(text, size) > pos.maxWidth) size -= 0.5;
      // Sit the value on the box's BOTTOM edge (the printed fill-in rule), the
      // way Acrobat fills a field — not floating mid-box. Adobe field rects are
      // often tall click targets with the visible line at the bottom, so the
      // top-anchored calculateTextPosition() leaves text hovering above it.
      const baselineY = box.top - box.height + pad;
      page.drawText(fitToWidth(text, fnt, size, pos.maxWidth), {
        x: pos.x, y: baselineY, size, font: fnt, color: BLACK,
      });
    }
  };

  for (const [key, field] of Object.entries(config.fields)) {
    const value = values[key];
    if (value === undefined || value === '' || value === false) continue;
    const page = pages[field.page - 1];
    if (!page) continue;
    drawField(page, key, field, value, font);
  }

  // Row groups: each entry is row 1's columns shifted down by rowStride per
  // row. Entries beyond the printed row count don't fit the page and are
  // dropped (the editor caps input at count, so this is belt-and-suspenders).
  for (const [gkey, group] of Object.entries(config.rowGroups ?? {})) {
    const page = pages[group.page - 1];
    if (!page) continue;
    (rows[gkey] ?? []).slice(0, group.count).forEach((row, i) => {
      for (const [ckey, col] of Object.entries(group.columns)) {
        const value = row[ckey];
        if (value === undefined || value === '' || value === false) continue;
        drawField(page, `${gkey}.${i}.${ckey}`, col, value, font, i * group.rowStride);
      }
    });
  }

  return doc.save();
}
