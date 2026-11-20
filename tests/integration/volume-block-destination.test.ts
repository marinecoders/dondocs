import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { volumeFixture } from '../_helpers/volumeFixture';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';

for (const kind of ['paragraph', 'table'] as const) it.skipIf(!hasPdfToolchain)(`keeps a ${kind} destination above its first printed line after a page break`, async () => {
  const source = volumeFixture();
  source.paragraphs[0].text = 'Prefix prose retained. '.repeat(240);
  source.paragraphs.push({ id: 'following', volumeSectionId: 'section-intro', text: 'FOLLOWINGMARKER', level: 0,
    ...(kind === 'table' ? { bodyTable: { rows: [['Heading'], ['Retain this table body.']], headerRows: 1 } } : {}),
  });
  const result = await compileFixture(source);
  expect(result.ok, formatFailure(`${kind} destination`, result)).toBe(true);
  const bytes = await resolvePublicationDestinations(result.pdfBytes!);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const reader = await task.promise;
    const destination = await reader.getDestination('volume.node.following');
    const targetPage = await reader.getPageIndex(destination![0]);
    const marker = (await pdfTextLayout(bytes)).boxes.find(box => box.text.includes('FOLLOWINGMARKER'))!;
    expect(targetPage + 1).toBe(marker.page);
    expect(Number(destination![3])).toBeGreaterThanOrEqual(marker.top - 1);
    expect(Number(destination![3]) - marker.top).toBeLessThan(20);
  } finally { await task.destroy(); }
});
