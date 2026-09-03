/**
 * The tables an I-Type carries, and the paragraphs they belong to.
 *
 * MIL-STD-38784C fixes these as it fixes the paragraph titles: an author fills
 * rows in and removes the tables that do not apply, but does not invent
 * columns. Six of the eight share one shape, so they are described here as
 * data and rendered by one routine rather than eight.
 *
 * Widths are the template's own column grids, measured from the document,
 * and serve as proportions: the generator scales them to the text block less
 * the padding each column adds, so a table ends at the right margin.
 */

export interface PublicationTableColumn {
  key: string;
  label: string;
  /** LaTeX p{} width. */
  width: string;
}

export interface PublicationTableSpec {
  /** Store key, and the value a paragraph names to carry this table. */
  key: string;
  /** The paragraph title the template pairs this table with. The editor
   *  offers it by this name, and titles the paragraph with it. */
  name: string;
  columns: PublicationTableColumn[];
  /** Parts lists nest: an item may consist of others, indented beneath it. */
  nestable?: boolean;
}

/** Item · Description · NSN · PN · Qty — the materiel and tooling shape. */
const MATERIEL_COLUMNS: PublicationTableColumn[] = [
  { key: 'item', label: 'Item', width: '0.37in' },
  { key: 'description', label: 'Description', width: '2.43in' },
  { key: 'nsn', label: 'NSN', width: '1.44in' },
  { key: 'pn', label: 'PN', width: '1.62in' },
  { key: 'qty', label: 'Qty', width: '0.50in' },
];

/** Materiel Required is drawn a little differently in the template. */
const REQUIRED_COLUMNS: PublicationTableColumn[] = [
  { key: 'item', label: 'Item', width: '0.36in' },
  { key: 'description', label: 'Description', width: '2.20in' },
  { key: 'nsn', label: 'NSN', width: '1.60in' },
  { key: 'pn', label: 'PN', width: '1.80in' },
  { key: 'qty', label: 'Qty', width: '0.52in' },
];

export const I_TYPE_TABLES: PublicationTableSpec[] = [
  {
    key: 'majorItems',
    name: 'Major Items Affected',
    columns: [
      { key: 'description', label: 'Description', width: '2.60in' },
      { key: 'nsn', label: 'NSN', width: '1.71in' },
      { key: 'tamcn', label: 'TAMCN', width: '1.12in' },
      { key: 'id', label: 'I.D. No.', width: '1.16in' },
    ],
  },
  {
    key: 'components',
    name: 'Components Affected',
    columns: [
      { key: 'item', label: 'Item', width: '0.35in' },
      { key: 'description', label: 'Description', width: '2.25in' },
      { key: 'nsn', label: 'NSN', width: '1.56in' },
      { key: 'pn', label: 'PN', width: '1.81in' },
    ],
    nestable: true,
  },
  { key: 'materielRequired', name: 'Materiel Required', columns: REQUIRED_COLUMNS, nestable: true },
  { key: 'materielDiscarded', name: 'Materiel Discarded', columns: MATERIEL_COLUMNS },
  { key: 'materielRetained', name: 'Materiel Retained', columns: MATERIEL_COLUMNS },
  { key: 'materielBulk', name: 'Bulk and Consumable Materiel', columns: MATERIEL_COLUMNS },
  { key: 'specialTools', name: 'Special Tools', columns: MATERIEL_COLUMNS },
  { key: 'jigsFixtures', name: 'Jigs and Fixtures', columns: MATERIEL_COLUMNS },
];

export const tableSpec = (key: string): PublicationTableSpec | undefined =>
  I_TYPE_TABLES.find((t) => t.key === key);
