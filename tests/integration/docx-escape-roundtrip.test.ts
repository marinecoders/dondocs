/**
 * Every escape the DOCX generator emits has to survive pandoc.
 *
 * `$` did not. The table escaped it as `{\char36}` — carried over from the PDF
 * escaper, where that form dodges SwiftLaTeX's TS1 font encoding requirement —
 * and pandoc drops the primitive silently. A dollar sign in the subject, a
 * reference, an enclosure title or any other non-body field was simply absent
 * from the Word export. The document opened, nothing errored, and
 * `FY25 $5M BUDGET` read `FY25 5M BUDGET`.
 *
 * Body text was unaffected because its table already used `\$` — which is
 * exactly why this hid: every DOCX test in the suite exercises body text.
 *
 * So the first block below drives pandoc over each escape sequence directly.
 * It is deliberately not written in terms of `$`: the bug was one entry in a
 * table, and the next one will be a different entry. Testing the table as a
 * whole is what makes that visible.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

/**
 * What flat-generator's two tables emit, mirrored here.
 *
 * A copy rather than an import: the tables are module-private, and a test that
 * reads the implementation it is checking would pass whatever the code does.
 * These are the strings a reader can compare against the source by eye.
 */
const NON_BODY_ESCAPES: Array<[string, string]> = [
  ['\\', '\\textbackslash{}'],
  ['&', '\\&'],
  ['%', '\\%'],
  ['#', '\\#'],
  ['_', '\\_'],
  ['$', '\\$'],
  ['~', '\\textasciitilde{}'],
  ['^', '\\textasciicircum{}'],
  ['{', '\\{'],
  ['}', '\\}'],
];

const BODY_ESCAPES = NON_BODY_ESCAPES.filter(([ch]) => ch !== '_');

/** LaTeX sets ~ and ^ as these glyphs; that is correct typography, not an escape fault. */
function foldGlyphs(s: string): string {
  return s.replace(/˜/g, '~').replace(/ˆ/g, '^');
}

/** Run one escape sequence through pandoc and return what a reader would see. */
function throughPandoc(latex: string): string {
  const dir = spawnSync('mktemp', ['-d'], { encoding: 'utf-8' }).stdout.trim();
  const file = join(dir, 'probe.tex');
  spawnSync('sh', ['-c',
    `cat > ${file} <<'TEX'\n\\documentclass{article}\\begin{document}\nSTART ${latex} END\n\\end{document}\nTEX`]);
  const { stdout } = spawnSync('pandoc', ['-f', 'latex', '-t', 'plain', file], { encoding: 'utf-8' });
  const m = /START(.*?)END/s.exec(stdout ?? '');
  return foldGlyphs((m?.[1] ?? '').trim());
}

describeToolchainRequirement('DOCX escape sequences');

describe.skipIf(!toolchain)('every escape the DOCX generator emits survives pandoc', () => {
  it.each(NON_BODY_ESCAPES)('non-body table: %s round-trips', (ch, escaped) => {
    expect(throughPandoc(escaped)).toBe(ch);
  });

  it.each(BODY_ESCAPES)('body table: %s round-trips', (ch, escaped) => {
    expect(throughPandoc(escaped)).toBe(ch);
  });

  it('rejects the form that lost the dollar sign', () => {
    // Pins the actual mechanism, so the reason for `\$` cannot be "improved" back.
    expect(throughPandoc('{\\char36}')).toBe('');
    expect(throughPandoc('\\$')).toBe('$');
  });
});

function store(fields: { subject?: string; reference?: string; enclosure?: string; body?: string }) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times',
      pageNumbering: 'none', department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow', letterheadColor: 'blue',
      ssic: '7000', serial: '0123', date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: fields.subject ?? 'DOLLAR RENDER CHECK',
      sigFirst: 'John', sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel', sigTitle: 'Commanding Officer',
      classLevel: 'unclassified',
    },
    references: fields.reference ? [{ letter: 'a', title: fields.reference }] : [],
    enclosures: fields.enclosure ? [{ title: fields.enclosure }] : [],
    paragraphs: [{ text: fields.body ?? 'Routine body text.', level: 0 }],
    copyTos: [], distributions: [],
  } as never;
}

async function docxText(fields: Parameters<typeof store>[0]): Promise<string> {
  const result = await compileDocxFixture(store(fields));
  expect(result.ok, result.log.slice(0, 400)).toBe(true);
  return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
}

async function pdfText(fields: Parameters<typeof store>[0]): Promise<string> {
  const result = await compileFixture(store(fields));
  expect(result.ok, `compile failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-dollar-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
  expect(stdout.trim().length, 'pdftotext returned nothing').toBeGreaterThan(0);
  return stdout;
}

describe.skipIf(!toolchain)('a dollar sign in a non-body field', () => {
  const MONEY = 'FY25 $5M BUDGET REQUEST';

  it('reaches Word from the subject line', async () => {
    expect(await docxText({ subject: MONEY })).toContain('$5M');
  }, 180_000);

  it('reaches Word from a reference title', async () => {
    expect(await docxText({ reference: `Contract for ${MONEY}` })).toContain('$5M');
  }, 180_000);

  it('reaches Word from an enclosure title', async () => {
    expect(await docxText({ enclosure: `Estimate ${MONEY}` })).toContain('$5M');
  }, 180_000);

  it('still reaches Word from body text', async () => {
    // The path that always worked — pinned so the fix cannot regress it.
    expect(await docxText({ body: `The total is ${MONEY} this year.` })).toContain('$5M');
  }, 180_000);

  it('still renders in the PDF, which was never affected', async () => {
    const text = await pdfText({ subject: MONEY, enclosure: `Estimate ${MONEY}` });
    expect(text).toContain('$5M');
  }, 180_000);
});
