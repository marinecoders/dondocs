/**
 * The tables an I-Type carries, and the paragraphs they belong to.
 *
 * MIL-STD-38784C fixes these as it fixes the paragraph titles: an author fills
 * rows in and removes the tables that do not apply, but does not invent
 * columns. Six of the eight share one shape, so they are described here as
 * data and rendered by one routine rather than eight.
 *
 * Widths are proportions: the generator scales them to the text block less
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
  columns: PublicationTableColumn[];
  /** Parts lists nest: an item may consist of others, indented beneath it. */
  nestable?: boolean;
}

/** Item · Description · NSN · PN · Qty — the materiel and tooling shape. */
const MATERIEL_COLUMNS: PublicationTableColumn[] = [
  { key: 'item', label: 'Item', width: '0.5in' },
  { key: 'description', label: 'Description', width: '2.6in' },
  { key: 'nsn', label: 'NSN', width: '1.4in' },
  { key: 'pn', label: 'PN', width: '1.3in' },
  { key: 'qty', label: 'Qty', width: '0.4in' },
];

export const I_TYPE_TABLES: PublicationTableSpec[] = [
  {
    key: 'majorItems',
    columns: [
      { key: 'description', label: 'Description', width: '2.8in' },
      { key: 'nsn', label: 'NSN', width: '1.5in' },
      { key: 'tamcn', label: 'TAMCN', width: '1.1in' },
      { key: 'id', label: 'I.D. No.', width: '1.0in' },
    ],
  },
  {
    key: 'components',
    columns: [
      { key: 'item', label: 'Item', width: '0.5in' },
      { key: 'description', label: 'Description', width: '2.9in' },
      { key: 'nsn', label: 'NSN', width: '1.5in' },
      { key: 'pn', label: 'PN', width: '1.5in' },
    ],
    nestable: true,
  },
  { key: 'materielRequired', columns: MATERIEL_COLUMNS, nestable: true },
  { key: 'materielDiscarded', columns: MATERIEL_COLUMNS },
  { key: 'materielRetained', columns: MATERIEL_COLUMNS },
  { key: 'materielBulk', columns: MATERIEL_COLUMNS },
  { key: 'specialTools', columns: MATERIEL_COLUMNS },
  { key: 'jigsFixtures', columns: MATERIEL_COLUMNS },
];

export const tableSpec = (key: string): PublicationTableSpec | undefined =>
  I_TYPE_TABLES.find((t) => t.key === key);
