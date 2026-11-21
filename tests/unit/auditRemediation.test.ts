import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { withoutTableFootnote } from '@/lib/tableFootnotes';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';
import { taggedCorrespondenceIssues } from '@/services/pdf/accessibility/preflight';
import type { TaggedCorrespondenceSource } from '@/services/pdf/accessibility/correspondence';
import { itemFrom } from '../../.github/scripts/tracker-sync.mjs';

describe('audit remediation regressions', () => {
  it('withoutTableFootnote throws RangeError on out-of-range paragraph index', () => {
    expect(() => withoutTableFootnote([], {}, 0, 0)).toThrow(RangeError);
    expect(() => withoutTableFootnote([], {}, -1, 0)).toThrow(RangeError);
    expect(() => withoutTableFootnote([{ level: 0, text: '' }], {}, 0.5, 0)).toThrow(RangeError);
    expect(() => withoutTableFootnote([{ level: 0, text: '' }], {}, NaN, 0)).toThrow(RangeError);
  });

  it('resolvePublicationDestinations skips malformed annotations lacking a valid Rect', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const malformedAnnot = doc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Text'),
      NM: PDFString.of('sl4.section.1'),
      // Intentionally omit Rect
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj([malformedAnnot]));
    const input = await doc.save();

    await expect(resolvePublicationDestinations(input)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('taggedCorrespondenceIssues handles an empty bodyTable.rows array without throwing', () => {
    const source: TaggedCorrespondenceSource = {
      docType: 'naval_letter',
      formData: {
        subject: 'TEST SUBJECT',
        from: 'Commanding Officer',
        to: 'All Hands',
        date: '19 Nov 26',
      } as TaggedCorrespondenceSource['formData'],
      paragraphs: [
        {
          id: 'p1',
          level: 0,
          text: '',
          bodyTable: { headerRows: 1, rows: [] },
        },
      ],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    };
    const issues = taggedCorrespondenceIssues(source);
    expect(issues.some((msg) => msg.includes('valid rectangular body'))).toBe(true);
  });

  it('tracker-sync itemFrom rejects undefined payload cleanly', () => {
    expect(() => itemFrom(undefined)).toThrow(/expected an issue or pull_request payload/i);
  });

  it('units.json has no stray inverted question mark on SUB-UNIT 6 ALASKA', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src/data/units.json'), 'utf8');
    expect(raw).not.toContain('SUB-UNIT 6 ALASKA¿');
    expect(raw).toContain('SUB-UNIT 6 ALASKA');
  });

});
