import JSZip from 'jszip';
import type { StationeryGeometry } from '@/lib/stationery';
import { applyBodyTableLayouts } from './bodyTables';
import type { BodyTable } from '@/lib/bodyTable';

/** The companion's system Pandoc cannot set custom DOCX paper sizes from TeX.
 * Qualify its small-stock geometry without loading browser WASM infrastructure. */
export async function formatSmallStationery(bytes: Uint8Array, stock: StationeryGeometry, tables: readonly BodyTable[]): Promise<Uint8Array> {
  if (!stock.small) return bytes;
  const zip = await JSZip.loadAsync(bytes), document = zip.file('word/document.xml');
  if (!document) throw new Error('Word output is missing its document part.');
  const width = Math.round(stock.textWidth * 1440);
  let xml = (await document.async('string')).replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, table => {
    const grid = table.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
    if (!grid) return table;
    const original = [...grid[1].matchAll(/<w:gridCol w:w="(\d+)"\s*\/>/g)].map(match => Number(match[1]));
    const total = original.reduce((sum, value) => sum + value, 0);
    if (!total) throw new Error('The small-stock Word table has invalid column widths.');
    const columns = original.map(value => Math.round(value * width / total));
    columns[columns.indexOf(Math.max(...columns))] += width - columns.reduce((sum, value) => sum + value, 0);
    let cell = 0;
    const margins = '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
    table = table.replace(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/g, '').replace(/<w:tblPr>/g, `$&${margins}`);
    return table.replace(grid[0], `<w:tblGrid>${columns.map(value => `<w:gridCol w:w="${value}"/>`).join('')}</w:tblGrid>`)
      .replace(/<w:tblW\b[^>]*\/>/g, `<w:tblW w:w="${width}" w:type="dxa"/>`)
      .replace(/<w:tcW\b[^>]*\/>/g, () => `<w:tcW w:w="${columns[cell++ % columns.length]}" w:type="dxa"/>`);
  });
  const size = `<w:pgSz w:w="${Math.round(stock.width * 1440)}" w:h="${Math.round(stock.height * 1440)}"/>`;
  const margins = '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
  xml = xml.replace(/<w:pgSz\b[^>]*\/>/g, '').replace(/<w:pgMar\b[^>]*\/>/g, '')
    .replace(/<w:sectPr\b[^>]*>/g, `$&${size}${margins}`);
  zip.file('word/document.xml', applyBodyTableLayouts(xml, tables, width));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
