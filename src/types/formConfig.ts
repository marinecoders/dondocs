/**
 * Declarative form configuration (issue #28 / tier 3): a NAVMC form described
 * entirely as data. `form.json` lives beside the form's template pages under
 * public/templates/<directory>/ — produced by scripts/harvest-fields.py and
 * reviewed by a human — and drives the generic renderer, store, and editor
 * section. Adding a config-driven form requires no TypeScript.
 */

export type FormFieldType = 'text' | 'checkbox' | 'radio' | 'date' | 'choice' | 'signature';

export interface FormFieldBox {
  /** PDF points, origin at bottom-left; top is the Y of the box's TOP edge. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FormFieldConfig {
  type: FormFieldType;
  /** Human label shown in the editor; harvested from the widget tooltip. */
  label: string;
  /** 1-based index into `pages`. */
  page: number;
  box: FormFieldBox;
  /** Wrap text across lines inside the box instead of a single line. */
  multiline?: boolean;
  /** Options for a `choice` dropdown (harvested from the PDF's /Opt list). */
  options?: string[];
  /** Radio fields sharing a `group` are mutually exclusive — picking one
   *  clears its siblings. Harvested from the shared parent field name. */
  group?: string;
  /** Optional human question for a radio group, shown as the group's heading.
   *  When absent the editor derives one from `group` via humanizeGroup(). */
  groupLabel?: string;
  /** The form author marked this field mandatory (AcroForm required bit);
   *  feeds the readiness meter and section error dots. */
  required?: boolean;
}

/** Which editor module renders a section. 'checklist' is a compact yes/no list
 *  for mostly-checkbox sections; 'list' is the default label-over-field stack. */
export type SectionEditor = 'list' | 'checklist';

export interface FormSectionConfig {
  title: string;
  fields: string[];
  /** Editor module; the harvester stamps 'checklist' for checkbox-heavy sections. */
  editor?: SectionEditor;
}

/** Which editor module renders a row group. 'grid' is a spreadsheet where you
 *  tab across columns — the right shape for a roster; 'cards' is a stacked
 *  per-row form for the rare narrow group. Defaults to 'grid'. */
export type RowGroupEditor = 'grid' | 'cards';

/** A repeated-row region (roster forms like the PFT/CFT worksheet): one set of
 *  columns whose boxes describe ROW 1, stamped `count` times down the page,
 *  each row's boxes `rowStride` points lower than the last. */
export interface FormRowGroupConfig {
  title: string;
  page: number;
  /** Rows printed on the template page — the hard cap on entries. */
  count: number;
  /** Vertical distance between consecutive rows, in points (positive = down). */
  rowStride: number;
  columns: Record<string, FormFieldConfig>;
  /** Editor module for this group; the harvester stamps 'grid'. */
  editor?: RowGroupEditor;
}

export interface FormConfig {
  id: string;
  label: string;
  /** Folder under public/templates/ holding pages and this config. */
  directory: string;
  pages: string[];
  sections: FormSectionConfig[];
  fields: Record<string, FormFieldConfig>;
  rowGroups?: Record<string, FormRowGroupConfig>;
}

/** A config-driven form's field values, keyed by field key. */
export type FormValues = Record<string, string | boolean>;

/** Row entries per row group: rows[groupKey][rowIndex][columnKey]. */
export type FormRows = Record<string, FormValues[]>;

/** Runtime shape check for a fetched form.json — the file is hand-edited data,
 *  so a typo should fail loudly at load, not render a silently wrong PDF. */
export function assertFormConfig(data: unknown, source: string): FormConfig {
  const cfg = data as FormConfig;
  const fail = (msg: string): never => {
    throw new Error(`Invalid form config ${source}: ${msg}`);
  };
  if (!cfg || typeof cfg !== 'object') fail('not an object');
  if (!cfg.id || !cfg.label || !cfg.directory) fail('missing id/label/directory');
  if (!Array.isArray(cfg.pages) || cfg.pages.length === 0) fail('missing pages');
  if (!cfg.fields || typeof cfg.fields !== 'object') fail('missing fields');
  // A rowGroup-only form (roster with no labeled sections) is valid, but the
  // outline and editor call config.sections.map unguarded — normalize a missing
  // sections key to [] here so a valid config can never white-screen the editor.
  if (cfg.sections === undefined) cfg.sections = [];
  else if (!Array.isArray(cfg.sections)) fail('sections is not an array');
  for (const [key, f] of Object.entries(cfg.fields)) {
    if (!f.box || [f.box.left, f.box.top, f.box.width, f.box.height].some((n) => typeof n !== 'number')) {
      fail(`field "${key}" has a malformed box`);
    }
    if (typeof f.page !== 'number' || f.page < 1 || f.page > cfg.pages.length) {
      fail(`field "${key}" page ${f.page} is outside 1..${cfg.pages.length}`);
    }
  }
  for (const s of cfg.sections ?? []) {
    if (s.editor && s.editor !== 'list' && s.editor !== 'checklist') {
      fail(`section "${s.title}" has unknown editor "${s.editor}"`);
    }
    for (const key of s.fields) {
      if (!cfg.fields[key]) fail(`section "${s.title}" references unknown field "${key}"`);
    }
  }
  for (const [gkey, g] of Object.entries(cfg.rowGroups ?? {})) {
    if (typeof g.count !== 'number' || g.count < 1) fail(`row group "${gkey}" has no count`);
    if (typeof g.rowStride !== 'number' || g.rowStride <= 0) fail(`row group "${gkey}" has no rowStride`);
    if (typeof g.page !== 'number' || g.page < 1 || g.page > cfg.pages.length) {
      fail(`row group "${gkey}" page ${g.page} is outside 1..${cfg.pages.length}`);
    }
    if (g.editor && g.editor !== 'grid' && g.editor !== 'cards') fail(`row group "${gkey}" has unknown editor "${g.editor}"`);
    if (!g.columns || Object.keys(g.columns).length === 0) fail(`row group "${gkey}" has no columns`);
    for (const [ckey, c] of Object.entries(g.columns)) {
      if (!c.box || [c.box.left, c.box.top, c.box.width, c.box.height].some((n) => typeof n !== 'number')) {
        fail(`row group "${gkey}" column "${ckey}" has a malformed box`);
      }
      // The renderer draws every column on the group's page; a column claiming
      // a different page would silently render somewhere its author didn't
      // intend, so refuse the mismatch outright.
      if (c.page !== g.page) {
        fail(`row group "${gkey}" column "${ckey}" page ${c.page} differs from the group's page ${g.page}`);
      }
    }
  }
  return cfg;
}
