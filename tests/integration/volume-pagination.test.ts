import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import { volumeFixture } from '../_helpers/volumeFixture';

it.skipIf(!hasPdfToolchain)('uses body page labels when contents and change records are omitted', async () => {
  const source = volumeFixture();
  source.formData.volume!.includeContents = false;
  source.formData.volume!.changes = [];
  source.formData.volume!.glossary = [];
  const compiled = await compileFixture(source);
  expect(compiled.ok, formatFailure('volume without front matter', compiled)).toBe(true);
  const task = getDocument({ data: new Uint8Array(await resolvePublicationDestinations(compiled.pdfBytes!)), useSystemFonts: false });
  try {
    const reader = await task.promise;
    expect(await reader.getPageLabels()).toEqual(['Cover', '1', '2', 'A-1']);
  } finally { await task.destroy(); }
}, 60_000);
