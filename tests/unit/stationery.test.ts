import { describe, expect, it } from 'vitest';
import { correspondenceStationery, stationeryIssues } from '@/lib/stationery';
import { parseSavedSession } from '@/lib/savedSession';
import { createBlankSession } from '@/stores/documentStore';
import { createSharedPayload, draftEnvelope, parseSharedSession } from '@/lib/sharedSession';
import { validateBackupSession } from '@/lib/backupValidation';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { buildBaseline } from '../_helpers/compileMatrix';
import { validateLetter } from '../../companion/validateLetter';

describe('executive stationery boundaries', () => {
  it('retains custom stock choices while using Letter on other document families', () => {
    expect(correspondenceStationery('executive_correspondence', { stationerySize: '5x7' })).toMatchObject({ width: 5, height: 7, textWidth: 3, small: true });
    expect(correspondenceStationery('naval_letter', { stationerySize: '5x7' })).toMatchObject({ width: 8.5, height: 11, small: false });
    expect(stationeryIssues('naval_letter', { stationerySize: '5x7' })).toEqual([]);
    expect(validateLetter({ docType: 'naval_letter', subject: 'Test', unit: { stationerySize: '5x7' } })).toEqual([expect.stringContaining('only for executive_correspondence')]);
  });
  it('blocks full-seal small stock and incompatible fonts in both renderers', () => {
    const source = buildBaseline('executive_correspondence');
    Object.assign(source.formData, { stationerySize: '5x7', letterheadMode: 'full' });
    expect(() => generateAllLatexFiles(source)).toThrow(/preprinted or title-only/);
    expect(() => generateFlatLatex(source)).toThrow(/preprinted or title-only/);
    Object.assign(source.formData, { letterheadMode: 'preprinted', fontFamily: 'courier' });
    expect(() => generateAllLatexFiles(source)).toThrow(/12pt Times/);
    Object.assign(source.formData, { fontFamily: 'times', classLevel: 'custom', customClassification: 'Long custom banner' });
    expect(() => generateAllLatexFiles(source)).toThrow(/Custom classification/);
    source.formData.classLevel = 'unclassified';
    expect(() => generateAllLatexFiles(source, 'custom')).toThrow(/Custom classification/);
    expect(() => generateFlatLatex(source, 'custom')).toThrow(/Custom classification/);
    expect(validateLetter({ docType: 'executive_correspondence', subject: 'Test', unit: { stationerySize: '5x7' } })).toEqual([expect.stringContaining('preprinted or title-only')]);
  });
  it('preserves exact size in local, draft and shared sessions and rejects invalid sizes', () => {
    const source = { ...createBlankSession(), docType: 'executive_correspondence', formData: { stationerySize: '7x9' as const, letterheadMode: 'preprinted' as const } };
    expect(parseSavedSession(source).formData.stationerySize).toBe('7x9');
    expect(draftEnvelope(source)).toMatchObject({ version: 8 });
    const share = createSharedPayload(source);
    expect(share.version).toBe(13);
    expect(parseSharedSession(share).formData.stationerySize).toBe('7x9');
    for (const invalid of ['a4', 5, {}, null]) {
      const forged = { ...source, formData: { ...source.formData, stationerySize: invalid } };
      expect(() => parseSavedSession(forged)).toThrow();
      expect(() => parseSharedSession(forged)).toThrow();
      expect(() => validateBackupSession(forged)).toThrow();
    }
  });
});
