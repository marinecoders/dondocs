import { describe, it, expect } from 'vitest';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { sl3ExportErrors } from '@/lib/sl3Preflight';
import { DOC_TYPE_CONFIG, DOC_TYPE_CATEGORIES } from '@/types/document';
import { getEditorSections } from '@/lib/editorSections';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { SL3_INVENTORY_GRID, sl3InventoryGeometry } from '@/data/techpub/sl3';
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
  it('requires the authentication address and authority title', () => {
    const store = sl3Fixture();
    store.formData.unitAddress = '';
    store.formData.sigTitle = '';
    expect(sl3ExportErrors(store)).toEqual(
      expect.arrayContaining([
        'Command address is required.',
        'Signing authority title is required.',
      ]),
    );
  });
  it('rejects authentication by direction through either the flag or signature title', () => {
    const s = sl3Fixture();
    s.formData.byDirection = true;
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'cannot be signed by direction',
    );
    s.formData.byDirection = false;
    s.formData.sigTitle = 'By direction';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'cannot be signed by direction',
    );
  });
  it('requires the source manual and unit of issue separately from unit of measure', () => {
    const s = sl3Fixture();
    s.formData.sl3!.sourceManual = '';
    s.formData.sl3!.components[0].unitOfIssue = '';
    const errors = sl3ExportErrors(s).join('\n');
    expect(errors).toContain('source technical manual');
    expect(errors).toContain('unit of issue');
  });
  it('requires traceable primary TAMCN associations and a positive configuration ratio', () => {
    const s = sl3Fixture();
    const item = s.formData.sl3!.components[0];
    item.tamcn = 'B12345G';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'TFSMS configuration source',
    );
    s.formData.sl3!.configurationReference =
      'Synthetic configuration record, 30 October 2026';
    item.primaryTamcn = 'A12345G';
    item.configurationRatio = '1:0';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'primary-to-component configuration ratio',
    );
    item.configurationRatio = '1:2';
    expect(sl3ExportErrors(s)).toEqual([]);
    const body = generateSl3Body(s);
    expect(body).toContain('Primary TAMCN A12345G; ratio 1:2');
    item.primaryTamcn = 'C12345G';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'primary end item TAMCN on the cover',
    );
    item.tamcn = '';
    expect(sl3ExportErrors(s).join('\n')).toContain(
      'associated component TAMCN',
    );
  });
  it('requires a Fielding Plan reference for the optional columns', () => {
    const store = sl3Fixture();
    store.formData.sl3!.showModel = true;
    expect(sl3ExportErrors(store).join(' ')).toContain('Fielding Plan');
    store.formData.sl3!.fieldingPlanReference = 'Training Fielding Plan';
    expect(sl3ExportErrors(store)).toEqual([]);
    expect(generateSl3Body(store)).toContain(
      'Fielding Plan: Training Fielding Plan',
    );
  });
  it('accepts the order’s five-position TAMCN example without inventing suffixes', () => {
    const s = sl3Fixture();
    s.endItems[0].tamcn = 'B2565';
    const item = s.formData.sl3!.components[0];
    item.tamcn = 'B2483';
    item.primaryTamcn = 'B2565';
    item.configurationRatio = '1:1';
    s.formData.sl3!.configurationReference = 'MCO example used only for validation';
    expect(sl3ExportErrors(s)).toEqual([]);
    expect(generateSl3Body(s)).toContain('Primary TAMCN B2565; ratio 1:1');
    s.endItems[0].tamcn = 'B25657G';
    expect(sl3ExportErrors(s)).toEqual([]);
    item.primaryTamcn = 'B25658G';
    expect(sl3ExportErrors(s).join('\n')).toContain('primary end item TAMCN');
    item.tamcn = 'BAD';
    expect(sl3ExportErrors(s).join('\n')).toContain('assigned five-position TAMCN');
  });
  it.each(['portrait', 'landscape'] as const)(
    'preserves every %s source cell when optional columns are added',
    (orientation) => {
      for (const [showModel, showFigureReference] of [
        [false, true],
        [true, false],
        [true, true],
      ]) {
        const geometry = sl3InventoryGeometry({
          orientation,
          showModel,
          showFigureReference,
        });
        expect(geometry.widths.slice(0, 18)).toEqual(
          SL3_INVENTORY_GRID[orientation].map((value) => value / 20),
        );
        expect(geometry.left).toBeGreaterThanOrEqual(18);
        expect(geometry.right).toBeGreaterThanOrEqual(18 - 0.001);
      }
    },
  );
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

describe('SL-3 audit export safeguards', () => {
  it('requires an explicit lettering review and complete positioned labels', () => {
    const s = sl3Fixture();
    const figureId = 'drawing';
    s.formData.sl3!.endItemFigureId = figureId;
    s.paragraphs = [
      {
        referenceId: figureId,
        level: 0,
        text: 'Training artwork',
        figure: {
          fileRef: {
            id: 'file',
            name: 'drawing.png',
            type: 'image/png',
            size: 100,
          },
        },
      },
    ];
    expect(sl3ExportErrors(s).join(' ')).toContain('Review the lettering');
    s.formData.sl3!.artwork = [{ figureId, lettering: 'none', labels: [] }];
    expect(sl3ExportErrors(s)).toEqual([]);
    s.formData.sl3!.artwork[0].lettering = 'labels';
    expect(sl3ExportErrors(s).join(' ')).toContain(
      'single line of searchable text',
    );
    s.formData.sl3!.artwork[0].labels = [
      { id: 'label', text: 'VALVE INLET', x: 50, y: 50 },
    ];
    expect(sl3ExportErrors(s)).toEqual([]);
    s.formData.sl3!.artwork[0].labels[0].x = 101;
    expect(sl3ExportErrors(s).join(' ')).toContain('inventory data is invalid');
  });
  it('rejects conflicting and incomplete custom definitions and derives their classification', () => {
    const s = sl3Fixture();
    s.formData.sl3!.definitions = [
      {
        id: 'term',
        term: 'PAE',
        meaning: 'Different meaning',
        portionMarking: 'U',
      },
    ];
    expect(sl3ExportErrors(s).join(' ')).toContain(
      'conflicts with a standard definition',
    );
    s.formData.sl3!.definitions[0].term = 'ZED';
    s.formData.sl3!.definitions[0].meaning = '';
    expect(sl3ExportErrors(s).join(' ')).toContain('empty abbreviation');
    s.formData.sl3!.definitions[0].meaning = 'Synthetic custom definition';
    expect(sl3ExportErrors(s)).toEqual([]);
    s.formData.sl3!.definitions[0].portionMarking = 'S';
    expect(sl3ExportErrors(s).join(' ')).toContain('highest component');
  });
});
