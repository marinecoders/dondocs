import { useMemo } from 'react';
import { FORM_TYPE_LABELS, type FormType } from '@/types/document';
import { useConfigForms, type ConfigFormEntry } from '@/services/formRegistry';

/**
 * Unified catalog of every selectable form — the two hand-built editors plus
 * all config-driven registry forms — with the metadata the picker and catalog
 * view sort, group, and search on. One derivation so the compact picker and
 * the browse-all modal can never disagree about what exists.
 */

export interface CatalogForm {
  /** The FormType value the app selects (built-in ids keep their underscores). */
  formType: FormType;
  /** Display name, e.g. "NAVMC 10132 - Unit Punishment Book". */
  name: string;
  /** Just the number part for tight UI ("NAVMC 10132"). */
  number: string;
  /** Title part without the number. */
  title: string;
  category: string;
  keywords: string[];
  verified: boolean;
  /** % of fields that render onto their declared page; low = badly detected. */
  fieldLanding?: number;
  /** Template folder (for the catalog thumbnail); built-ins included. */
  directory?: string;
}

/** Metadata for the two built-in forms; their editors are hand-written, so
 *  their catalog rows are too. */
const BUILTIN_FORMS: CatalogForm[] = [
  {
    formType: 'navmc_10274',
    name: FORM_TYPE_LABELS.navmc_10274,
    number: 'NAVMC 10274',
    title: 'Administrative Action',
    category: 'Legal & Discipline',
    keywords: ['6105', 'counseling', 'administrative action', 'AA form', 'adverse'],
    verified: true,
    directory: 'NAVMC10274 - Administrative Action',
  },
  {
    formType: 'navmc_118_11',
    name: FORM_TYPE_LABELS.navmc_118_11,
    number: 'NAVMC 118 (11)',
    title: 'Administrative Remarks (Page 11)',
    category: 'Personnel & Records',
    keywords: ['page 11', 'administrative remarks', '1070', 'page eleven'],
    verified: true,
    directory: 'NAVMC11811 - Administrative Remarks',
  },
];

function fromEntry(e: ConfigFormEntry): CatalogForm {
  const [number, ...rest] = e.name.split(' - ');
  return {
    formType: e.id,
    name: e.name,
    number: number ?? e.name,
    title: rest.join(' - ') || e.name,
    category: e.category,
    keywords: e.keywords,
    verified: e.verified,
    fieldLanding: e.fieldLanding,
    directory: e.directory,
  };
}

/** Every selectable form, built-ins first, then registry forms by name.
 *  Memoized on the (stable) config-form entries so the ~700-item map+sort runs
 *  once per data change, not on every unrelated re-render of the picker/catalog
 *  — both of which key their own filter/sort memos off this array's identity. */
export function useFormCatalog(): CatalogForm[] {
  const configForms = useConfigForms();
  return useMemo(
    () => [
      ...BUILTIN_FORMS,
      ...configForms.map(fromEntry).sort((a, b) => a.title.localeCompare(b.title)),
    ],
    [configForms],
  );
}

/** Categories present in the catalog, alphabetical. */
export function catalogCategories(forms: CatalogForm[]): string[] {
  return [...new Set(forms.map((f) => f.category))].sort();
}
