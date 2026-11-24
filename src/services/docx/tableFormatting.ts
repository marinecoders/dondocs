import type { BodyTable } from '@/lib/bodyTable';

const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const;

function border(side: typeof sides[number], visible: boolean): string {
  return `<w:${side} w:val="${visible ? 'single' : 'nil'}" w:sz="4" w:color="000000"/>`;
}

export function wordTableBorders(mode: BodyTable['borders'] = 'grid'): string {
  const rules = sides.map(side => border(side, mode !== 'none'
    && (side === 'insideH' ? mode === 'grid' : side !== 'insideV' || mode !== 'outline')));
  return `<w:tblBorders>${rules.join('')}</w:tblBorders>`;
}

/** Cell properties must follow OOXML's ordered tcPr sequence. */
export function wordTableCellFormatting(mode: BodyTable['borders'], row: number, headerRows: number, rowCount: number, wrap?: boolean): string {
  const headerRule = mode === 'columns' && row === headerRows - 1 && row < rowCount - 1;
  return (headerRule ? `<w:tcBorders>${border('bottom', true)}</w:tcBorders>` : '')
    + (wrap === false ? '<w:noWrap/><w:tcFitText/>' : '');
}
