import { describe, it, expect } from 'vitest';
import { buildBaseline, applyFlags } from '../_helpers/compileMatrix';
import { compileFixture } from '../_helpers/compileLatex';
import type { TestStore } from '../_helpers/compileMatrix';
import { useDocumentStore } from '@/stores/documentStore';

// A Marine who has just picked the I-Type has typed nothing yet. The cover
// must still compile with every field blank, or the preview dies before the
// first keystroke. The populated fixture in i-type-render.test.ts cannot see
// this; only an empty document can.

async function compileWith(mutate: (s: Record<string, unknown>) => void) {
  const store = buildBaseline('i_type' as never) as unknown as Record<string, unknown>;
  mutate(store);
  return compileFixture(store as unknown as TestStore);
}

describe('I-Type compiles before anything is filled in', () => {
  it('empty subject (fresh document)', async () => {
    const r = await compileWith((s) => {
      Object.assign(s.formData as Record<string, unknown>, { subject: '' });
    });
    expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  });

  it('every cover field blank, no end items, no paragraphs', async () => {
    const r = await compileWith((s) => {
      Object.assign(s.formData as Record<string, unknown>, {
        subject: '', nomenclature: '', shortTitle: '', pcn: '', supersedure: '', date: '',
      });
      if ('endItems' in s) s.endItems = [];
      if ('paragraphs' in s) s.paragraphs = [];
      if ('publicationTables' in s) s.publicationTables = {};
    });
    expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  });

  it('CUI with no point of contact', async () => {
    // The cover's CUI block ends with the POC line; a blank one must not leave
    // a line break with nothing in front of it.
    const base = buildBaseline('i_type' as never);
    const store = applyFlags(base, { classLevel: 'cui' }) as unknown as Record<string, unknown>;
    Object.assign(store.formData as Record<string, unknown>, { pocEmail: '' });
    const r = await compileFixture(store as unknown as TestStore);
    expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  });

  it('the store exactly as a user first sees it', async () => {
    // Not a fixture: the live store after Reset and picking the type. Fixtures
    // fill in what they need, which is how an empty-line failure hid.
    useDocumentStore.getState().resetForm();
    useDocumentStore.getState().setDocType('i_type');
    const r = await compileFixture(useDocumentStore.getState() as unknown as TestStore);
    expect(r.ok, r.errors.slice(0, 4).join('\n')).toBe(true);
  });
});
