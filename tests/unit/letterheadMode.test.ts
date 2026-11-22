import { describe, expect, it } from 'vitest';
import { resolveLetterheadMode, supportsLetterheadModes } from '@/lib/letterheadMode';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { getSectionError } from '@/components/layout/editorSections';
import { documentTextFields } from '@/lib/documentFields';
import { generateLetterheadTex } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { parseSavedSession } from '@/lib/savedSession';
import { validateBackupSession } from '@/lib/backupValidation';
import { buildBaseline } from '../_helpers/compileMatrix';

describe('letterhead ownership', () => {
  it('preserves legacy output when full is explicit and ignores stale preferences on joint letters', () => {
    const store = buildBaseline('naval_letter');
    const baseline = generateFlatLatex(store);
    store.formData.letterheadMode = 'full';
    expect(generateFlatLatex(store)).toBe(baseline);
    for (const type of ['joint_letter', 'joint_memorandum', 'moa', 'sl3', 'standard_letter']) {
      expect(supportsLetterheadModes(DOC_TYPE_CONFIG[type])).toBe(false);
      expect(resolveLetterheadMode(DOC_TYPE_CONFIG[type], { letterheadMode: 'preprinted' })).toBe('full');
    }
  });
  it('rejects malformed modes before draft load or backup restore', () => {
    for (const value of ['unknown', false, ['preprinted'], { mode: 'preprinted' }]) {
      const session = { docType: 'naval_letter', formData: { letterheadMode: value }, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] };
      expect(() => parseSavedSession(session)).toThrow();
      expect(() => validateBackupSession(session)).toThrow();
    }
  });
  it('requires a title, but does not require an unprinted unit on preprinted stock', () => {
    const config = DOC_TYPE_CONFIG.naval_letter;
    expect(getSectionError('letterhead', { letterheadMode: 'title-only' }, [], config)).toBe(true);
    expect(getSectionError('letterhead', { letterheadMode: 'preprinted' }, [], config)).toBe(false);
  });
  it.each(['title-only', 'preprinted'] as const)('omits inactive fields from findings/search while retaining saved data: %s', mode => {
    const source = { docType: 'naval_letter', formData: { letterheadMode: mode, unitLine1: 'VISIBLE-TITLE', unitLine2: 'HIDDEN-UNIT', unitAddress: 'HIDDEN-ADDRESS' } };
    const search = documentTextFields(source, 'search').map(field => field.text);
    expect(search).not.toContain('HIDDEN-UNIT');
    expect(search).not.toContain('HIDDEN-ADDRESS');
    expect(search.includes('VISIBLE-TITLE')).toBe(mode === 'title-only');
    expect(documentTextFields(source, 'draft').map(field => field.text)).toContain('HIDDEN-ADDRESS');
    const store = buildBaseline('naval_letter');
    Object.assign(store.formData, source.formData);
    expect(generateLetterheadTex(store)).toContain(`\\setLetterheadMode{${mode}}`);
    const flat = generateFlatLatex(store);
    expect(flat).not.toContain('HIDDEN-ADDRESS');
    expect(flat).not.toContain('dow-seal');
    expect(flat.includes('VISIBLE-TITLE')).toBe(mode === 'title-only');
  });
});
