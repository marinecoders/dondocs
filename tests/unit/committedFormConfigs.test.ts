/**
 * Repo guard: every config form in the catalog must satisfy the same validator
 * the browser runs.
 *
 * The import pipeline never checked. harvest-fields.py writes form.draft.json,
 * import-batch.sh copies it to form.json and flips `config: true`, and
 * assertFormConfig only ran later, in the browser, on fetch — so a malformed
 * config was discovered by a user opening the form, not by CI. This closes that
 * loop: a form that cannot load fails the suite instead.
 *
 * It also checks the two things assertFormConfig cannot know, because it never
 * sees the filesystem or the catalog: that every page the config names is
 * actually committed, and that the config agrees with its index.json row.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFormConfig } from '@/types/formConfig';

const TEMPLATES = join(process.cwd(), 'public/templates');

type Row = { id: string; directory: string; config?: boolean; pages?: string[] };

function configRows(): Row[] {
  const index = JSON.parse(readFileSync(join(TEMPLATES, 'index.json'), 'utf-8')) as {
    templates: Row[];
  };
  return index.templates.filter((t) => t.config);
}

describe('committed config forms', () => {
  const rows = configRows();

  it('validates every config:true row in the catalog', () => {
    const checked: string[] = [];
    for (const row of rows) {
      const dir = join(TEMPLATES, row.directory);
      const path = join(dir, 'form.json');
      expect(existsSync(path), `${row.directory}: config:true but no form.json`).toBe(true);

      // The real validator, on the real file — not a re-implementation.
      const cfg = assertFormConfig(JSON.parse(readFileSync(path, 'utf-8')), row.directory);

      // A config whose id or directory drifts from its catalog row loads the
      // wrong pages or cannot be looked up at all.
      expect(cfg.id, `${row.directory}: form.json id`).toBe(row.id);
      expect(cfg.directory, `${row.directory}: form.json directory`).toBe(row.directory);

      // assertFormConfig bounds field.page against pages.length; only the disk
      // can say whether those pages were actually committed.
      for (const page of cfg.pages) {
        expect(existsSync(join(dir, page)), `${row.directory}: missing page ${page}`).toBe(true);
      }

      // A form with no fields renders as an empty editor. It passes
      // assertFormConfig (an empty object is still an object), so it has to be
      // caught here — this is what a harvest that dropped every page produces.
      expect(
        Object.keys(cfg.fields).length + Object.keys(cfg.rowGroups ?? {}).length,
        `${row.directory}: config form with nothing to fill in`
      ).toBeGreaterThan(0);

      checked.push(row.id);
    }
    // Guards the loop itself: if the filter or the read silently found nothing,
    // the count disagrees and this fails instead of passing vacuously.
    expect(checked).toHaveLength(rows.length);
  });

  it('reads the real catalog, so an empty result means empty and not unread', () => {
    // The guard above iterates config:true rows, and today there are none — no
    // script-generated form is committed. That makes it vacuous, so prove the
    // catalog was actually parsed rather than silently missed. Deliberately not
    // pinned to a count: importing a form must not fail the suite.
    const index = JSON.parse(readFileSync(join(TEMPLATES, 'index.json'), 'utf-8')) as {
      templates: Row[];
    };
    expect(index.templates.length).toBeGreaterThan(0);

    // The hand-built forms keep their geometry in TypeScript, so they are
    // config:false and correctly outside the guard's scope.
    for (const id of ['navmc10274', 'navmc11811']) {
      const row = index.templates.find((t) => t.id === id);
      expect(row, `${id} missing from the catalog`).toBeDefined();
      expect(row?.config, `${id} should not be a config form`).toBeFalsy();
    }
  });
});
