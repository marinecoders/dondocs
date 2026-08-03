/**
 * The SSIC / serial / date block must sit at the RIGHT margin in Word.
 *
 * Reported from the field: it was landing in the middle of the page. The cause
 * was a contract between two files that is easy to break by reading either one
 * alone — `dondocs.lua` classifies a 2-column table by its *second column's
 * alignment*, and only AlignRight reaches the SSIC branch (75/25). The flat
 * generator emitted `l`, so the table fell through to `has_empty_first_column()`
 * and was formatted as a **signature block**: an even 50/50 split that starts
 * the text at dead centre.
 *
 * That is invisible to a source-level assertion — the LaTeX looked plausible
 * either way, and the text extracts identically. Only the compiled DOCX's
 * column geometry tells you where the words actually are, so this test reads
 * `w:gridCol` out of the real document.xml.
 *
 * The signature-block assertion is not incidental: it is the control that keeps
 * a future "just right-align everything" fix from moving the signature too.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

// Synchronous toolchain check at module load — see `docx-compile.test.ts` for
// the rationale. Marks tests SKIPPED (not falsely PASSED) when pandoc is gone.
const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn(
    '[docx-ssic-alignment] pandoc not found on PATH — the alignment checks below will be SKIPPED.'
  );
}

interface DocxTable {
  /** Column widths in twips, in document order. */
  grid: number[];
  /** Justification of each cell that actually carries text. */
  textCellJustifications: string[];
  text: string;
}

const cellText = (cell: string) =>
  [...cell.matchAll(/<w:t[^>]*>([^<]*)</g)].map(m => m[1]).join('').trim();

/**
 * Tables, bounded at `</w:tbl>` — an unbounded split runs each chunk on to the
 * next table and drags in the justification of whatever paragraphs follow.
 *
 * Only cells with text are reported. The empty spacer cell and the table's own
 * `w:jc` are deliberately ignored: pandoc labels them `left` or `start`
 * depending on its version, and neither says anything about where the SSIC
 * lands. Asserting over every `w:jc` in the region passed locally and failed in
 * CI for exactly that reason.
 */
function parseTables(documentXml: string): DocxTable[] {
  return (documentXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).map(table => {
    const cells = table.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    return {
      grid: [...table.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => Number(m[1])),
      textCellJustifications: cells
        .filter(cell => cellText(cell) !== '')
        .map(cell => cell.match(/<w:jc w:val="(\w+)"/)?.[1] ?? '(none)'),
      text: cells.map(cellText).join(' '),
    };
  });
}

describe.skipIf(!pandocAvailable)('DOCX SSIC block alignment', () => {
  it('right-aligns SSIC, serial and date instead of centring them', async () => {
    const store = buildBaseline('naval_letter');
    store.formData.ssic = '5216';
    store.formData.serial = 'Ser N1/0042';
    store.formData.date = '3 Aug 26';

    const result = await compileDocxFixture(store);
    expect(result.ok, formatDocxFailure('ssic-alignment', result)).toBe(true);

    const zip = await JSZip.loadAsync(result.docxBytes!);
    const documentXml = await zip.file('word/document.xml')!.async('string');
    const tables = parseTables(documentXml);

    const ssic = tables.find(t => t.text.includes('Ser N1/0042'));
    expect(ssic, 'no table carries the serial — the SSIC block did not render').toBeDefined();
    expect(ssic!.grid).toHaveLength(2);

    // The spacer column must dominate. An even split is the exact bug reported:
    // it puts the text at the middle of the page.
    const [spacer, content] = ssic!.grid;
    expect(
      spacer,
      `SSIC columns are ${spacer}/${content} twips — an even split places the ` +
        'block mid-page, which is the field-reported defect'
    ).toBeGreaterThan(content * 2);

    // Width alone is not enough: the text must also hug the right edge of its
    // own column rather than sit left inside a narrow one.
    expect(
      ssic!.textCellJustifications,
      'every cell carrying SSIC text must be right-justified',
    ).not.toHaveLength(0);
    for (const jc of ssic!.textCellJustifications) {
      expect(jc).toBe('right');
    }

    // Control: the signature block is a legitimate 50/50, and must stay one.
    const signature = tables.find(t => t.text.includes('J. A. DOE'));
    expect(signature, 'no table carries the signature name').toBeDefined();
    expect(signature!.grid).toHaveLength(2);
    expect(signature!.grid[0]).toBe(signature!.grid[1]);
  }, 120_000);
});
