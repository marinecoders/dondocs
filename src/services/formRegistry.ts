import { useEffect, useState } from 'react';
import { loadFormConfig } from '@/services/pdf/genericFormRenderer';
import type { FormConfig } from '@/types/formConfig';

/**
 * Registry of config-driven forms (issue #28 / tier 3). Entries come from
 * public/templates/index.json rows that carry `"config": true` — meaning the
 * folder holds a reviewed form.json. The registry is what lets the Forms
 * dropdown, editor, preview, and export discover a new form without any
 * TypeScript changes.
 */

export interface ConfigFormEntry {
  id: string;
  name: string;
  directory: string;
  /** Human category for the picker/catalog (SSIC-derived at import, curated later). */
  category: string;
  /** Search aliases in Marine vocabulary ("page 11", "6105", "UPB"). */
  keywords: string[];
  /** Hand-checked against the official form, vs. straight off the pipeline. */
  verified: boolean;
  /** % of fields that render onto their declared page (fill-smoke measure).
   *  Low values mean the form's boxes were badly detected. undefined = unmeasured. */
  fieldLanding?: number;
}

let entriesPromise: Promise<ConfigFormEntry[]> | null = null;

export function loadConfigFormEntries(): Promise<ConfigFormEntry[]> {
  entriesPromise ??= fetch('/templates/index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`templates index: ${res.status}`);
      return res.json();
    })
    .then((data: { templates: Array<Partial<ConfigFormEntry> & { id: string; name: string; directory: string; config?: boolean }> }) =>
      data.templates
        .filter((t) => t.config)
        .map((t) => ({
          id: t.id,
          name: t.name,
          directory: t.directory,
          category: t.category ?? 'General',
          keywords: t.keywords ?? [],
          verified: t.verified ?? false,
          fieldLanding: t.fieldLanding,
        }))
    )
    .catch(() => {
      // A missing or unreadable index just means no config forms; the
      // built-in forms are unaffected.
      entriesPromise = null;
      return [];
    });
  return entriesPromise;
}

/** The config-form entries, loaded once per session. */
export function useConfigForms(): ConfigFormEntry[] {
  const [entries, setEntries] = useState<ConfigFormEntry[]>([]);
  useEffect(() => {
    let alive = true;
    loadConfigFormEntries().then((e) => {
      if (alive) setEntries(e);
    });
    return () => {
      alive = false;
    };
  }, []);
  return entries;
}

/** Resolve a formType to its loaded config, or null for built-in forms. */
export async function configForFormType(formType: string): Promise<FormConfig | null> {
  const entries = await loadConfigFormEntries();
  const entry = entries.find((e) => e.id === formType);
  return entry ? loadFormConfig(entry.directory) : null;
}

/**
 * The loaded config for a formType, or null while loading / for built-in
 * forms. Shared by the editor section and the sidebar outline so both see the
 * same config at the same time. Staleness is handled by keying the loaded
 * value to its formType rather than resetting state in the effect.
 */
export function useFormConfigFor(formType: string): FormConfig | null {
  const [loaded, setLoaded] = useState<{ type: string; cfg: FormConfig | null }>({
    type: formType,
    cfg: null,
  });
  useEffect(() => {
    let alive = true;
    configForFormType(formType)
      .catch((err) => {
        // A missing or malformed form.json degrades to "no config" (the form
        // renders nothing and the rail shows only Document Type) instead of an
        // unhandled rejection. The error still surfaces for the fix.
        console.error(`Form config for ${formType} failed to load:`, err);
        return null;
      })
      .then((cfg) => {
        if (alive) setLoaded({ type: formType, cfg });
      });
    return () => {
      alive = false;
    };
  }, [formType]);
  return loaded.type === formType ? loaded.cfg : null;
}

/** One outline row per editable group of a config form: its sections in order,
 *  then its row groups. Ids are slugged titles, deduped deterministically —
 *  the single source for both the sidebar rail and the editor's `#sec-` scroll
 *  anchors, so the two can't disagree on where a click should land. */
export interface ConfigOutlineEntry {
  id: string;
  label: string;
  kind: 'section' | 'rowGroup';
  /** Index into config.sections, or the rowGroups key, per kind. */
  index: number;
  key: string;
}

export function configFormOutline(config: FormConfig): ConfigOutlineEntry[] {
  const used = new Set<string>();
  const idFor = (title: string): string => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    let id = slug;
    for (let n = 2; used.has(id); n++) id = `${slug}-${n}`;
    used.add(id);
    return id;
  };
  // A single auto-named "Page 1" section is redundant chrome — the whole form
  // IS that section. Show "Form fields" instead, but keep the id/key from the
  // raw title so `#sec-` anchors and dedupe stay stable. Multi-page forms keep
  // their "Page N" labels (they distinguish real pages).
  const relabel = (title: string): string =>
    config.sections.length === 1 && /^Page \d+$/.test(title) ? 'Form fields' : title;
  return [
    ...config.sections.map((s, i) => ({
      id: idFor(s.title), label: relabel(s.title), kind: 'section' as const, index: i, key: s.title,
    })),
    ...Object.entries(config.rowGroups ?? {}).map(([gkey, g], i) => ({
      id: idFor(gkey), label: g.title, kind: 'rowGroup' as const, index: i, key: gkey,
    })),
  ];
}
