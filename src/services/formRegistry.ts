import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadDefinition } from '@/services/forms/packages';
import type { FormDefinition } from '@/services/forms/model';
import { useDocumentStore } from '@/stores/documentStore';
import type { FormConfig } from '@/types/formConfig';

/**
 * Registry of config-driven forms (issue #28 / tier 3). Entries come from
 * published public/templates/index.json rows with `"config": true`. The registry is what lets the Forms
 * dropdown, editor, preview, and export discover a new form without any
 * TypeScript changes.
 */

export interface ConfigFormEntry {
  id: string;
  name: string;
  directory: string;
  sourceDirectory?: string;
  /** Human category for the picker/catalog (SSIC-derived at import, curated later). */
  category: string;
  /** Search aliases in Marine vocabulary ("page 11", "6105", "UPB"). */
  keywords: string[];
  /** Hand-checked against the official form, vs. straight off the pipeline. */
  verified: boolean;
}

let entriesPromise: Promise<ConfigFormEntry[]> | null = null;
type CatalogState = { status: 'idle' | 'loading' | 'ready' | 'error'; entries: ConfigFormEntry[] };
let catalogState: CatalogState = { status: 'idle', entries: [] };
const listeners = new Set<() => void>();
const publish = (state: CatalogState) => { catalogState = state; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useFormCatalogStatus() {
  const state = useSyncExternalStore(subscribe, () => catalogState);
  useEffect(() => { if (catalogState.status === 'idle') void loadConfigFormEntries(); }, []);
  return { ...state, retry: () => { void loadConfigFormEntries(); } };
}


export function loadConfigFormEntries(): Promise<ConfigFormEntry[]> {
  if (!entriesPromise) publish({ ...catalogState, status: 'loading' });
  entriesPromise ??= fetch('/templates/index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`templates index: ${res.status}`);
      return res.json();
    })
    .then((data: { templates: Array<Partial<ConfigFormEntry> & { id: string; name: string; directory: string; config?: boolean; status?: string }> }) =>
      data.templates
        .filter((t) => t.config && t.status === 'published')
        .map((t) => ({
          id: t.id,
          name: t.name,
          directory: t.directory,
          sourceDirectory: t.sourceDirectory,
          category: t.category ?? 'General',
          keywords: t.keywords ?? [],
          verified: t.verified ?? false,
        }))
    )
    .then(entries => { publish({ status: 'ready', entries }); return entries; })
    .catch(() => {
      // A missing or unreadable index just means no config forms; the
      // built-in forms are unaffected.
      entriesPromise = null;
      publish({ ...catalogState, status: 'error' });
      return [];
    });
  return entriesPromise;
}

/** The config-form entries, loaded once per session. */
export function useConfigForms(): ConfigFormEntry[] {
  return useFormCatalogStatus().entries;
}

/** Resolve a formType to its loaded config, or null for built-in forms. */
export async function configForFormType(formType: string): Promise<FormDefinition | null> {
  const entries = await loadConfigFormEntries();
  const entry = entries.find((e) => e.id === formType);
  return entry ? loadDefinition(entry.directory) : null;
}

/**
 * The loaded config for a formType, or null while loading / for built-in
 * forms. Shared by the editor section and the sidebar outline so both see the
 * same config at the same time. Staleness is handled by keying the loaded
 * value to its formType rather than resetting state in the effect.
 */
export function useFormResource(formType: string): { config: FormDefinition | null; error: string | null; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt(value => value + 1);
  const pinned = useDocumentStore(s => s.genericForm?.definition);
  const [loaded, setLoaded] = useState<{ type: string; cfg: FormDefinition | null; error: string | null }>({ type: formType, cfg: null, error: null });
  useEffect(() => {
    let alive = true;
    if (pinned?.formId === formType) return;
    configForFormType(formType).then(cfg => {
      if (alive) setLoaded({ type: formType, cfg, error: cfg || formType === 'navmc_10274' || formType === 'navmc_118_11' ? null : 'This form is unavailable. Reconnect and try again.' });
    }).catch(error => {
      if (alive) setLoaded({ type: formType, cfg: null, error: String(error) });
    });
    return () => { alive = false; };
  }, [formType, pinned, attempt]);
  return { ...(pinned?.formId === formType ? { config: pinned, error: null } : loaded.type === formType ? { config: loaded.cfg, error: loaded.error } : { config: null, error: null }), retry };
}

export function useFormConfigFor(formType: string): FormDefinition | null {
  return useFormResource(formType).config;
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

export function configFormOutline(config: FormConfig | FormDefinition): ConfigOutlineEntry[] {
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
      id: 'id' in s ? s.id : idFor(s.title), label: relabel(s.title), kind: 'section' as const, index: i, key: s.title,
    })),
    ...Object.entries(config.rowGroups ?? {}).map(([gkey, g], i) => ({
      id: 'schemaVersion' in config ? gkey : idFor(gkey), label: g.title, kind: 'rowGroup' as const, index: i, key: gkey,
    })),
  ];
}
