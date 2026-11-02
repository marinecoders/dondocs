import { pdfRules } from './pdfRules';
import type { PdfTextBox } from './pdfTextLayout';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Poppler separates words that PDF.js can combine across adjacent cells. */
export function pdfWordBoxes(bytes: Uint8Array): PdfTextBox[] {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const directory = mkdtempSync(join(tmpdir(), 'dondocs-pdf-words-'));
  let xml: string;
  try {
    // Poppler can stall on piped PDF input during concurrent render tests.
    // A file supplies a definite EOF; a timeout also bounds native-tool stalls.
    const path = join(directory, 'input.pdf');
    writeFileSync(path, bytes);
    const result = spawnSync('pdftotext', ['-bbox', path, '-'], { encoding: 'utf8', maxBuffer: 10_000_000, timeout: 15_000 });
    if (result.status !== 0) throw new Error(`Could not measure PDF words: ${result.stderr || result.error?.message}`);
    xml = result.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return xml.split('</page>').filter((p) => p.includes('<page ')).flatMap((p, i) => {
    const height = Number(p.match(/<page [^>]*height="([\d.]+)"/)![1]);
    return [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({
      page: i + 1, left: +m[1], right: +m[3], top: height - +m[2], bottom: height - +m[4],
      text: m[5].replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => entities[key]),
    }));
  });
}

/** Measure text against the painted inner edges, rather than column settings. */
export async function pdfTableInsets(bytes: Uint8Array, page: number, boxes?: PdfTextBox[]) {
  const textBoxes = boxes ?? pdfWordBoxes(bytes);
  const rules = await pdfRules(bytes, page);
  const vertical = rules.filter((r) => Math.abs(r.right - r.left) < 0.01 && r.top - r.bottom > 3);
  const horizontal = rules.filter((r) => Math.abs(r.top - r.bottom) < 0.01 && r.right - r.left > 10);
  const columns = [...new Set(vertical.map((r) => r.left))].sort((a,b) => a-b);
  const cells = textBoxes.filter((b) => b.page === page).flatMap((box) => {
    const sides = vertical.filter((r) => r.bottom <= box.bottom + 0.01 && r.top >= box.top - 0.01);
    const left = sides.filter((r) => r.left <= box.left).sort((a,b) => b.left-a.left)[0];
    const right = sides.filter((r) => r.right >= box.right).sort((a,b) => a.right-b.right)[0];
    if (!left || !right || left === right) return [];
    const crossing = sides.filter((r) => r.left > box.left && r.left < box.right);
    const boundaries = horizontal.filter((r) => r.left <= box.left && r.right >= box.right);
    const above = boundaries.filter((r) => r.bottom >= box.top).sort((a,b) => a.bottom-b.bottom)[0];
    const below = boundaries.filter((r) => r.top <= box.bottom).sort((a,b) => b.top-a.top)[0];
    return [{ ...box, column: columns.indexOf(left.left), spans: columns.indexOf(right.left)-columns.indexOf(left.left),
      leftInset: box.left-left.left-left.weight/2,
      rightInset: right.right-right.weight/2-box.right,
      topInset: above ? above.bottom-above.weight/2-box.top : null,
      bottomInset: below ? box.bottom-below.top-below.weight/2 : null,
      crossingRules: crossing.length }];
  });
  return { columns, cells };
}
