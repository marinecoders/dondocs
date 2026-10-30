import { describe, it, expect } from 'vitest';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { sl3ExportErrors } from '@/lib/sl3Preflight';
import { DOC_TYPE_CONFIG, DOC_TYPE_CATEGORIES } from '@/types/document';
import { getEditorSections } from '@/lib/editorSections';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { generateSl3Body } from '@/services/latex/sl3Generator';

describe('SL-3 document authoring', () => {
  it('is available in the document picker with dedicated inventory and illustration sections', () => {
    expect(
      DOC_TYPE_CATEGORIES.find((c) => c.category === 'Technical Publications')
        ?.types,
    ).toContain('sl3');
    expect(DOC_TYPE_CONFIG.sl3.pdfOnly).toBe(true);
    expect(
      getEditorSections(DOC_TYPE_CONFIG.sl3, 'sl3').map((s) => s.id),
    ).toContain('sl3-inventory');
  });
  it('accepts an SL-3 without applying MI section or short-title rules', () => {
    expect(publicationExportErrors(sl3Fixture())).toEqual([]);
  });
  it('rejects orphaned and noncontiguous components', () => {
    const s = sl3Fixture();
    s.formData.sl3!.components[2].parentId = 'missing';
    expect(sl3ExportErrors(s).join('\n')).toContain('parent must precede');
    s.formData.sl3!.components[2].parentId = 'component-0';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'directly after their parent',
    );
  });
  it('rejects a grandchild separated from its immediate parent group', () => {
    const s = sl3Fixture(4);
    const items = s.formData.sl3!.components;
    items[1].parentId = items[0].id;
    items[2].parentId = items[0].id;
    items[3].parentId = items[1].id;
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'directly after their parent',
    );
    s.formData.sl3!.components = [items[0], items[1], items[3], items[2]];
    expect(sl3ExportErrors(s)).toEqual([]);
  });
  it('includes sequencing explanations in classification checks and prints their marking', () => {
    const s = sl3Fixture();
    s.formData.sl3!.sequencingNote = 'Demonstration sequence rationale.';
    s.formData.sl3!.sequencingPortion = 'S';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'highest component, note or technical-data marking',
    );
    expect(generateSl3Body(s)).toContain(
      '(S) Demonstration sequence rationale.',
    );
  });
  it('requires a sequencing explanation for nonalphabetical top-level items', () => {
    const s = sl3Fixture();
    s.formData.sl3!.components.reverse();
    expect(sl3ExportErrors(s).join('\n')).toContain('alphabetically');
    s.formData.sl3!.sequencingNote = 'Listed in assembly order.';
    expect(sl3ExportErrors(s)).toEqual([]);
  });
  it('rejects missing note and illustration references', () => {
    const s = sl3Fixture();
    Object.assign(s.formData.sl3!.components[0], {
      noteIds: ['missing'],
      figureId: 'missing',
    });
    const errors = sl3ExportErrors(s).join('\n');
    expect(errors).toContain('special note is missing');
    expect(errors).toContain('illustration is missing');
  });
});
