import { bodyTableSchema, type BodyTable } from '@/lib/bodyTable';
import { wordAttribute, wordChildren, wordDescendants } from './archive';

/** Preserve supported column-level layout; report anything the native model cannot represent. */
export function readTableLayout(element: Element, input: BodyTable, notice: (message: string) => void): BodyTable {
  const table = { ...input };
  const count = input.rows[0].length;
  const grid = wordChildren(element, 'tblGrid')[0];
  const widths = grid ? wordChildren(grid, 'gridCol').map(column => Number(wordAttribute(column, 'w'))) : [];
  if (widths.length) {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (widths.length === count && widths.every(width => Number.isFinite(width) && width > 0) && total > 0) {
      const percentages = widths.map(width => width / total * 100);
      if (percentages.some(width => width < 5)) notice('Very narrow Word table columns use equal native widths; the original file retains their layout.');
      else if (widths.some(width => Math.abs(width - widths[0]) > 1)) table.columnWidths = percentages;
    } else notice('This Word table has incomplete column widths; native columns use equal widths.');
  }
  const rows = wordChildren(element, 'tr');
  const wrapping = rows.flatMap(row => wordChildren(row, 'tc').map(cell => {
    const properties = wordChildren(cell, 'tcPr')[0];
    if (!properties) return false;
    return ['noWrap', 'tcFitText'].some(name => {
      const option = wordChildren(properties, name)[0];
      return option && !['0', 'off', 'false'].includes(wordAttribute(option, 'val') ?? '');
    });
  }));
  if (wrapping.length && wrapping.every(Boolean)) table.wrap = false;
  else if (wrapping.some(Boolean)) notice('Mixed Word cell wrapping uses the native table default; the original file retains individual cell settings.');
  const alignments = Array.from({ length: count }, (_, column) => rows.map(row => {
    const cell = wordChildren(row, 'tc')[column];
    return cell ? wordChildren(cell, 'p').map(paragraph => {
      const props = wordChildren(paragraph, 'pPr')[0];
      const align = props && wordChildren(props, 'jc')[0];
      return align ? wordAttribute(align, 'val') ?? 'left' : 'left';
    }) : ['left'];
  }).flat());
  if (alignments.every(column => column.every(align => ['left', 'center', 'right', 'start', 'end'].includes(align))
    && column.every(align => align === column[0]))) {
    const supported = alignments.map(column => column[0] === 'start' ? 'left' : column[0] === 'end' ? 'right' : column[0]) as NonNullable<BodyTable['columnAlignments']>;
    if (supported.some(align => align !== 'left')) table.columnAlignments = supported;
  } else notice('Mixed or unsupported table-cell alignment uses native column defaults; the original file retains the complete formatting.');
  const properties = wordChildren(element, 'tblPr')[0];
  const borders = properties && wordChildren(properties, 'tblBorders')[0];
  if (borders) {
    const values = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => {
      const border = wordChildren(borders, side)[0];
      return border ? wordAttribute(border, 'val') ?? 'single' : undefined;
    });
    const off = (value: string | undefined) => value === 'none' || value === 'nil';
    if (values.every(off)) table.borders = 'none';
    else if (values.slice(0, 4).every(value => value === 'single') && values.slice(4).every(off)) table.borders = 'outline';
    else if (values.slice(0, 4).every(value => value === 'single') && off(values[4]) && values[5] === 'single') table.borders = 'columns';
    else if (!values.every(value => value === 'single')) notice('Custom table borders use the native grid; the original file retains their exact line styles.');
  }
  const runs = wordDescendants(element, 'r').filter(run => wordDescendants(run, 't').some(text => text.textContent));
  const sizes = runs.map(run => {
    const properties = wordChildren(run, 'rPr')[0], size = properties && wordChildren(properties, 'sz')[0];
    return size ? Number(wordAttribute(size, 'val')) / 2 : undefined;
  });
  const firstSize = sizes[0];
  if (typeof firstSize === 'number' && sizes.every(size => size === firstSize) && [10, 11, 12].includes(firstSize)) table.fontSize = firstSize as 10 | 11 | 12;
  else if (sizes.some(size => size !== undefined)) notice('Mixed, inherited or unsupported table text sizes use the document size; the original file retains their exact typography.');
  const heights = rows.map(row => {
    const props = wordChildren(row, 'trPr')[0], height = props && wordChildren(props, 'trHeight')[0];
    const rule = height && wordAttribute(height, 'hRule');
    return height && rule !== 'auto' ? { points: Number(wordAttribute(height, 'val')) / 20, rule } : undefined;
  });
  if (heights.some(height => height && (height.rule === 'exact' || !Number.isFinite(height.points) || height.points < 0 || height.points > 144))) {
    notice('Fixed or unsupported Word row heights become content-expanding native rows; the original file retains their geometry.');
  } else if (heights.length && heights.every(height => height && height.points === heights[0]?.points && height.points > 0)) {
    table.minimumRowHeight = heights[0]!.points;
  } else if (heights.some(height => height !== undefined)) {
    table.rowHeights = heights.map(height => height?.points ?? null);
  }
  return bodyTableSchema.parse(table);
}
